import { randomUUID } from 'node:crypto';
import {
  AuthService,
  CaptureService,
  createToken,
  hashToken,
  KnowledgeBaseService,
  LifecycleService,
  NoteService,
} from '@oln/application';
import {
  createAuthStore,
  createAuthThrottle,
  createCaptureStore,
  createDevelopmentScanner,
  createKnowledgeBaseStore,
  createLifecycleStore,
  createNoteStore,
  storageAdapter,
} from '@oln/infrastructure';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  knowledgeBaseMemberships,
  sessions,
  users,
} from '../packages/infrastructure/src/db/schema';
import { startTestApi, startTestStack, type TestStack, testReadiness } from './fixtures';

const PAGE = `<!doctype html><html><head><title>Fallback</title>
<link rel="canonical" href="/canonical"><meta property="og:site_name" content="Example"></head>
<body><article><h1>Captured story</h1><p>Enough readable text for the extraction parser to keep this article body intact.</p>
<img src="/photo.png" onerror="alert(1)"><script>alert(1)</script><a href="/next">Next</a></article></body></html>`;

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=',
  'base64',
);

class FakeFetcher {
  pages = new Map<string, { contentType: string; bytes: Uint8Array }>();
  fail = new Set<string>();

  async fetch(url: string) {
    if (this.fail.has(url)) throw new Error('fetch failed');
    const resource = this.pages.get(url);
    if (!resource) throw new Error(`missing fixture ${url}`);
    return { url, ...resource };
  }
}

let stack: TestStack;
let app: FastifyInstance;
let captures: CaptureService;
let notes: NoteService;
const fetcher = new FakeFetcher();

beforeAll(async () => {
  stack = await startTestStack();
  await stack.storage.ensureBucket();
  const auth = new AuthService({
    store: createAuthStore(stack.database),
    email: { async sendMagicLink() {} },
    throttle: createAuthThrottle(stack.redis),
    webAppUrl: 'http://localhost:3000',
  });
  notes = new NoteService({
    store: createNoteStore(stack.database),
    storage: storageAdapter(stack.storage),
    scanner: createDevelopmentScanner(),
    processInline: true,
  });
  const knowledgeBases = new KnowledgeBaseService({
    store: createKnowledgeBaseStore(stack.database),
    email: { async sendInvitation() {} },
    webAppUrl: 'http://localhost:3000',
  });
  captures = new CaptureService({
    store: createCaptureStore(stack.database),
    fetcher,
    notes,
    queue: { async enqueueCapture() {} },
    storage: storageAdapter(stack.storage),
    scanner: createDevelopmentScanner(),
  });
  app = startTestApi(testReadiness(stack), {
    auth,
    notes,
    knowledgeBases,
    captures,
    lifecycle: new LifecycleService({ store: createLifecycleStore(stack.database) }),
  });
});

afterAll(async () => {
  await app.close();
  await stack.close();
});

async function createUser(label: string) {
  const email = `${label}-${randomUUID()}@example.com`;
  const [user] = await stack.database.db
    .insert(users)
    .values({ email, displayName: label, emailVerifiedAt: new Date() })
    .returning();
  if (!user) throw new Error('user insert failed');
  const token = createToken();
  await stack.database.db.insert(sessions).values({
    userId: user.id,
    tokenHash: hashToken(token),
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    lastSeenAt: new Date(),
  });
  return { id: user.id, token };
}

function auth(token: string) {
  return { authorization: `Bearer ${token}` };
}

async function createKnowledgeBase(token: string) {
  const response = await app.inject({
    method: 'POST',
    url: '/knowledge-bases',
    headers: auth(token),
    payload: { name: `Capture ${randomUUID()}` },
  });
  expect(response.statusCode).toBe(201);
  return response.json() as { id: string };
}

async function startCapture(token: string, knowledgeBaseId: string, body: object) {
  return app.inject({
    method: 'POST',
    url: `/knowledge-bases/${knowledgeBaseId}/captures`,
    headers: auth(token),
    payload: body,
  });
}

describe('web capture ingestion', () => {
  it('captures a sanitized page, copies media, and exposes the source', async () => {
    const owner = await createUser('capture-owner');
    const knowledgeBase = await createKnowledgeBase(owner.token);
    const pageUrl = `https://example.com/${randomUUID()}`;
    fetcher.pages.set(pageUrl, {
      contentType: 'text/html; charset=utf-8',
      bytes: Buffer.from(PAGE),
    });
    fetcher.pages.set('https://example.com/photo.png', { contentType: 'image/png', bytes: PNG });

    const response = await startCapture(owner.token, knowledgeBase.id, { url: pageUrl });
    expect(response.statusCode).toBe(202);
    const { attempt } = response.json() as { attempt: { id: string } };
    await captures.process(attempt.id);

    const status = await app.inject({
      method: 'GET',
      url: `/captures/${attempt.id}`,
      headers: auth(owner.token),
    });
    expect(status.statusCode).toBe(200);
    const ready = status.json() as { status: string; noteId: string; revisionId: string };
    expect(ready.status).toBe('ready');
    const noteResponse = await app.inject({
      method: 'GET',
      url: `/notes/${ready.noteId}`,
      headers: auth(owner.token),
    });
    expect(noteResponse.statusCode).toBe(200);
    const note = noteResponse.json() as {
      title: string;
      source: { canonicalUrl: string; siteName: string };
      revisions: Array<{ id: string }>;
    };
    expect(note.title).toBe('Captured story');
    expect(note.source.canonicalUrl).toBe('https://example.com/canonical');
    expect(note.source.siteName).toBe('Example');
    const original = await notes.download(owner.id, ready.noteId, ready.revisionId);
    const html = new TextDecoder().decode(original.bytes);
    expect(html).toContain('Captured story');
    expect(html).toContain('Captured from');
    expect(html).toContain('data-capture-source');
    expect(html).toContain('/capture-media/');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('onerror');

    const mediaPath = html.match(/src="(\/capture-media\/[^"]+)"/)?.[1];
    expect(mediaPath).toBeTruthy();
    const media = await app.inject({
      method: 'GET',
      url: mediaPath ?? '',
      headers: auth(owner.token),
    });
    expect(media.statusCode).toBe(200);
    expect(media.headers['content-type']).toBe('image/png');

    const viewer = await createUser('capture-media-viewer');
    await stack.database.db.insert(knowledgeBaseMemberships).values({
      knowledgeBaseId: knowledgeBase.id,
      userId: viewer.id,
      role: 'viewer',
    });
    const viewerMedia = await app.inject({
      method: 'GET',
      url: mediaPath ?? '',
      headers: auth(viewer.token),
    });
    expect(viewerMedia.statusCode).toBe(200);
  });

  it('concurrently processes one attempt into one Note', async () => {
    const owner = await createUser('capture-concurrent');
    const knowledgeBase = await createKnowledgeBase(owner.token);
    const pageUrl = `https://example.com/${randomUUID()}`;
    fetcher.pages.set(pageUrl, { contentType: 'text/html', bytes: Buffer.from(PAGE) });
    const response = await startCapture(owner.token, knowledgeBase.id, { url: pageUrl });
    const { attempt } = response.json() as { attempt: { id: string } };
    await Promise.all([captures.process(attempt.id), captures.process(attempt.id)]);
    const notesResponse = await app.inject({
      method: 'GET',
      url: `/knowledge-bases/${knowledgeBase.id}/notes`,
      headers: auth(owner.token),
    });
    expect(notesResponse.json() as unknown[]).toHaveLength(1);
  });

  it('scopes idempotency keys to a Knowledge Base', async () => {
    const owner = await createUser('capture-idempotency');
    const firstKb = await createKnowledgeBase(owner.token);
    const secondKb = await createKnowledgeBase(owner.token);
    const first = await startCapture(owner.token, firstKb.id, {
      url: `https://example.com/${randomUUID()}`,
      idempotencyKey: 'shared-key',
    });
    const second = await startCapture(owner.token, secondKb.id, {
      url: `https://example.com/${randomUUID()}`,
      idempotencyKey: 'shared-key',
    });
    expect((first.json() as { attempt: { id: string } }).attempt.id).not.toBe(
      (second.json() as { attempt: { id: string } }).attempt.id,
    );
  });

  it('fails the attempt when the queue is unavailable', async () => {
    const owner = await createUser('capture-queue');
    const knowledgeBase = await createKnowledgeBase(owner.token);
    const failing = new CaptureService({
      store: createCaptureStore(stack.database),
      fetcher,
      notes,
      queue: {
        async enqueueCapture() {
          throw new Error('queue down');
        },
      },
      storage: storageAdapter(stack.storage),
      scanner: createDevelopmentScanner(),
    });
    const result = await failing.create(owner.id, knowledgeBase.id, {
      url: `https://example.com/${randomUUID()}`,
    });
    expect(result.attempt.status).toBe('failed');
    expect(result.attempt.errorCode).toBe('queue_unavailable');
  });

  it('deletes captured media when the Note is purged', async () => {
    const owner = await createUser('capture-media-purge');
    const knowledgeBase = await createKnowledgeBase(owner.token);
    const pageUrl = `https://example.com/${randomUUID()}`;
    fetcher.pages.set(pageUrl, { contentType: 'text/html', bytes: Buffer.from(PAGE) });
    fetcher.pages.set('https://example.com/photo.png', { contentType: 'image/png', bytes: PNG });
    const response = await startCapture(owner.token, knowledgeBase.id, { url: pageUrl });
    const { attempt } = response.json() as { attempt: { id: string } };
    await captures.process(attempt.id);
    const status = await app.inject({
      method: 'GET',
      url: `/captures/${attempt.id}`,
      headers: auth(owner.token),
    });
    const ready = status.json() as { noteId: string; revisionId: string };
    const original = await notes.download(owner.id, ready.noteId, ready.revisionId);
    const mediaPath = new TextDecoder()
      .decode(original.bytes)
      .match(/src="\/capture-media\/[^"]+"/)?.[0]
      ?.slice(6, -1);
    expect(mediaPath).toBeTruthy();
    const mediaKey = `captures/${attempt.id}/${mediaPath?.split('/').pop() ?? ''}`;
    expect((await stack.storage.getObject(mediaKey)).length).toBeGreaterThan(0);

    const trashed = await app.inject({
      method: 'DELETE',
      url: `/knowledge-bases/${knowledgeBase.id}/notes/${ready.noteId}/association`,
      headers: auth(owner.token),
    });
    expect(trashed.statusCode).toBe(204);
    const future = new Date(Date.now() + 31 * 24 * 60 * 60 * 1000);
    const lifecycle = new LifecycleService({
      store: createLifecycleStore(stack.database),
      now: () => future,
    });
    await lifecycle.purgeDue(async (keys) => {
      for (const key of keys) await stack.storage.deleteObject(key);
    });
    await expect(stack.storage.getObject(mediaKey)).rejects.toThrow();
  });

  it('captures a selected passage without large or hostile media', async () => {
    const owner = await createUser('capture-selection');
    const knowledgeBase = await createKnowledgeBase(owner.token);
    const pageUrl = `https://example.com/${randomUUID()}`;
    fetcher.pages.set(pageUrl, { contentType: 'text/html', bytes: Buffer.from(PAGE) });
    fetcher.pages.set('https://example.com/photo.png', {
      contentType: 'image/png',
      bytes: Buffer.concat([PNG, Buffer.alloc(10 * 1024 * 1024)]),
    });
    const response = await startCapture(owner.token, knowledgeBase.id, {
      url: pageUrl,
      selectionHtml: '<p>Selected <strong>passage</strong><script>alert(1)</script></p>',
    });
    const { attempt } = response.json() as { attempt: { id: string } };
    await captures.process(attempt.id);
    const status = await app.inject({
      method: 'GET',
      url: `/captures/${attempt.id}`,
      headers: auth(owner.token),
    });
    const ready = status.json() as { status: string; noteId: string; revisionId: string };
    expect(ready.status).toBe('ready');
    const original = await notes.download(owner.id, ready.noteId, ready.revisionId);
    const html = new TextDecoder().decode(original.bytes);
    expect(html).toContain('Selected');
    expect(html).not.toContain('Enough readable text');
    expect(html).not.toContain('/capture-media/');
    expect(html).not.toContain('<script');
  });

  it('warns about duplicates and reuses idempotency keys', async () => {
    const owner = await createUser('capture-duplicate');
    const knowledgeBase = await createKnowledgeBase(owner.token);
    const pageUrl = `https://example.com/${randomUUID()}`;
    fetcher.pages.set(pageUrl, { contentType: 'text/html', bytes: Buffer.from(PAGE) });
    const first = await startCapture(owner.token, knowledgeBase.id, {
      url: pageUrl,
      idempotencyKey: 'same',
    });
    const firstBody = first.json() as { attempt: { id: string } };
    const repeated = await startCapture(owner.token, knowledgeBase.id, {
      url: pageUrl,
      idempotencyKey: 'same',
    });
    expect((repeated.json() as { attempt: { id: string } }).attempt.id).toBe(firstBody.attempt.id);
    await captures.process(firstBody.attempt.id);
    const duplicateWarning = await startCapture(owner.token, knowledgeBase.id, { url: pageUrl });
    expect(duplicateWarning.statusCode).toBe(409);
    expect(
      (duplicateWarning.json() as { duplicate: { noteId: string } }).duplicate.noteId,
    ).toBeTruthy();
    const confirmed = await startCapture(owner.token, knowledgeBase.id, {
      url: pageUrl,
      confirmDuplicate: true,
    });
    expect(confirmed.statusCode).toBe(202);
    const duplicateBody = confirmed.json() as { attempt: { id: string } };
    await captures.process(duplicateBody.attempt.id);
    const duplicateStatus = await app.inject({
      method: 'GET',
      url: `/captures/${duplicateBody.attempt.id}`,
      headers: auth(owner.token),
    });
    const duplicateAttempt = duplicateStatus.json() as { duplicateOf: { noteId: string } | null };
    expect(duplicateAttempt.duplicateOf?.noteId).toBeTruthy();
  });

  it('lets an owner retry the same failed attempt', async () => {
    const owner = await createUser('capture-retry');
    const knowledgeBase = await createKnowledgeBase(owner.token);
    const pageUrl = `https://example.com/${randomUUID()}`;
    fetcher.fail.add(pageUrl);
    const response = await startCapture(owner.token, knowledgeBase.id, { url: pageUrl });
    const { attempt } = response.json() as { attempt: { id: string } };
    await expect(captures.process(attempt.id)).rejects.toThrow('fetch failed');
    const failed = await app.inject({
      method: 'GET',
      url: `/captures/${attempt.id}`,
      headers: auth(owner.token),
    });
    expect((failed.json() as { status: string }).status).toBe('failed');
    fetcher.fail.delete(pageUrl);
    fetcher.pages.set(pageUrl, { contentType: 'text/html', bytes: Buffer.from(PAGE) });
    const retry = await app.inject({
      method: 'POST',
      url: `/captures/${attempt.id}/retry`,
      headers: auth(owner.token),
    });
    expect(retry.statusCode).toBe(200);
    await captures.process(attempt.id);
    const ready = await app.inject({
      method: 'GET',
      url: `/captures/${attempt.id}`,
      headers: auth(owner.token),
    });
    expect((ready.json() as { status: string }).status).toBe('ready');
  });

  it('rejects private targets and limits active captures', async () => {
    const owner = await createUser('capture-limits');
    const knowledgeBase = await createKnowledgeBase(owner.token);
    const privateUrl = await startCapture(owner.token, knowledgeBase.id, {
      url: 'http://127.0.0.1/',
    });
    expect(privateUrl.statusCode).toBe(400);
    for (let index = 0; index < 2; index += 1) {
      const response = await startCapture(owner.token, knowledgeBase.id, {
        url: `https://example.com/${randomUUID()}`,
      });
      expect(response.statusCode).toBe(202);
    }
    const limited = await startCapture(owner.token, knowledgeBase.id, {
      url: `https://example.com/${randomUUID()}`,
    });
    expect(limited.statusCode).toBe(429);
  });

  it('only lets managers start captures', async () => {
    const owner = await createUser('capture-manager');
    const viewer = await createUser('capture-viewer');
    const knowledgeBase = await createKnowledgeBase(owner.token);
    await stack.database.db.insert(knowledgeBaseMemberships).values({
      knowledgeBaseId: knowledgeBase.id,
      userId: viewer.id,
      role: 'viewer',
    });
    const response = await startCapture(viewer.token, knowledgeBase.id, {
      url: `https://example.com/${randomUUID()}`,
    });
    expect(response.statusCode).toBe(403);
  });
});
