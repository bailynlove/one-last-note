import { randomUUID } from 'node:crypto';
import {
  AuthService,
  createToken,
  hashToken,
  KnowledgeBaseService,
  LifecycleService,
  NoteService,
  RelationService,
} from '@oln/application';
import {
  createAuthStore,
  createAuthThrottle,
  createDevelopmentScanner,
  createKnowledgeBaseStore,
  createLifecycleStore,
  createNoteStore,
  createRelationStore,
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

let stack: TestStack;
let app: FastifyInstance;
let notes: NoteService;

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
  const relations = new RelationService({ store: createRelationStore(stack.database), notes });
  const lifecycle = new LifecycleService({ store: createLifecycleStore(stack.database) });
  app = startTestApi(testReadiness(stack), { auth, notes, knowledgeBases, relations, lifecycle });
});

afterAll(async () => {
  await app.close();
  await stack.close();
});

async function createUser(label: string): Promise<{ id: string; email: string; token: string }> {
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
  return { id: user.id, email, token };
}

function auth(token: string) {
  return { authorization: `Bearer ${token}` };
}

async function createKnowledgeBase(token: string, name = `Relations ${randomUUID()}`) {
  const response = await app.inject({
    method: 'POST',
    url: '/knowledge-bases',
    headers: auth(token),
    payload: { name, description: 'Relation test' },
  });
  expect(response.statusCode).toBe(201);
  return response.json() as { id: string; name: string };
}

async function addMember(knowledgeBaseId: string, userId: string, role: 'manager' | 'viewer') {
  await stack.database.db.insert(knowledgeBaseMemberships).values({
    knowledgeBaseId,
    userId,
    role,
  });
}

function multipart(bytes: Uint8Array, filename: string, mediaType: string, title: string) {
  const boundary = `----oln-${randomUUID()}`;
  const chunks = [
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="title"\r\n\r\n${title}\r\n`,
    ),
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${mediaType}\r\n\r\n`,
    ),
    Buffer.from(bytes),
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ];
  return {
    payload: Buffer.concat(chunks),
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}

async function upload(
  token: string,
  knowledgeBaseId: string,
  input: { body: string; filename: string; mediaType: string; title: string },
) {
  const bytes = new TextEncoder().encode(input.body);
  const body = multipart(bytes, input.filename, input.mediaType, input.title);
  const response = await app.inject({
    method: 'POST',
    url: `/knowledge-bases/${knowledgeBaseId}/notes`,
    headers: { ...auth(token), 'content-type': body.contentType },
    payload: body.payload,
  });
  expect(response.statusCode).toBe(201);
  return response.json() as {
    id: string;
    title: string;
    currentRevisionId: string;
    revisions: { id: string; revisionNumber: number }[];
  };
}

async function graph(token: string, knowledgeBaseId: string, query = '') {
  return app.inject({
    method: 'GET',
    url: `/knowledge-bases/${knowledgeBaseId}/relations${query}`,
    headers: auth(token),
  });
}

describe('Note relations and content references', () => {
  it('derives references only within the Knowledge Base and exposes the graph to viewers', async () => {
    const owner = await createUser('owner');
    const viewer = await createUser('viewer');
    const kb = await createKnowledgeBase(owner.token);
    await addMember(kb.id, viewer.id, 'viewer');

    const target = await upload(owner.token, kb.id, {
      body: '<p>A target</p>',
      filename: 'target.html',
      mediaType: 'text/html',
      title: 'Target page',
    });
    const isolated = await upload(owner.token, kb.id, {
      body: 'No links here.',
      filename: 'isolated.txt',
      mediaType: 'text/plain',
      title: 'Isolated page',
    });
    const source = await upload(owner.token, kb.id, {
      body: `<p><a href="/notes/${target.id}">Target</a> and <a href="https://example.com/notes/${isolated.id}">outside</a></p>`,
      filename: 'source.html',
      mediaType: 'text/html',
      title: 'Source page',
    });

    const response = await graph(viewer.token, kb.id);
    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      notes: { id: string; title: string }[];
      relations: unknown[];
      references: { sourceNoteId: string; targetNoteId: string; path: string }[];
    };
    expect(body.notes.map((note) => note.title).sort()).toEqual([
      'Isolated page',
      'Source page',
      'Target page',
    ]);
    expect(body.relations).toEqual([]);
    expect(body.references).toHaveLength(1);
    expect(body.references[0]).toMatchObject({
      sourceNoteId: source.id,
      targetNoteId: target.id,
      path: `/notes/${target.id}`,
    });

    expect((await graph(viewer.token, kb.id, '?q=Source')).json()).toMatchObject({
      notes: [{ id: source.id }],
      relations: [],
    });
    expect((await graph(viewer.token, kb.id, '?origin=manual')).json()).toMatchObject({
      relations: [],
      references: [],
    });
    expect((await graph(viewer.token, kb.id, '?origin=content')).json()).toMatchObject({
      relations: [],
      references: [{ targetNoteId: target.id }],
    });
    expect((await graph(viewer.token, kb.id, '?type=related')).json()).toMatchObject({
      references: [],
    });
  });

  it('rejects self, duplicates, cross-Knowledge Base targets, and viewer mutations', async () => {
    const owner = await createUser('owner');
    const viewer = await createUser('viewer');
    const kb = await createKnowledgeBase(owner.token);
    const otherKb = await createKnowledgeBase(owner.token, 'Other');
    await addMember(kb.id, viewer.id, 'viewer');

    const first = await upload(owner.token, kb.id, {
      body: 'first',
      filename: 'first.txt',
      mediaType: 'text/plain',
      title: 'First',
    });
    const second = await upload(owner.token, kb.id, {
      body: 'second',
      filename: 'second.txt',
      mediaType: 'text/plain',
      title: 'Second',
    });
    const foreign = await upload(owner.token, otherKb.id, {
      body: 'foreign',
      filename: 'foreign.txt',
      mediaType: 'text/plain',
      title: 'Foreign',
    });

    async function create(token: string, sourceNoteId: string, targetNoteId: string) {
      return app.inject({
        method: 'POST',
        url: `/knowledge-bases/${kb.id}/relations`,
        headers: auth(token),
        payload: { sourceNoteId, targetNoteId, type: 'related' },
      });
    }

    expect((await create(owner.token, first.id, first.id)).statusCode).toBe(422);
    expect((await create(owner.token, first.id, foreign.id)).statusCode).toBe(422);
    const created = await create(owner.token, first.id, second.id);
    expect(created.statusCode).toBe(201);
    expect((await create(owner.token, second.id, first.id)).statusCode).toBe(409);
    expect((await create(viewer.token, first.id, second.id)).statusCode).toBe(403);

    // Different labels and directed cycles are valid.
    const directed = await app.inject({
      method: 'POST',
      url: `/knowledge-bases/${kb.id}/relations`,
      headers: auth(owner.token),
      payload: { sourceNoteId: first.id, targetNoteId: second.id, type: 'references' },
    });
    expect(directed.statusCode).toBe(201);
    const cycle = await app.inject({
      method: 'POST',
      url: `/knowledge-bases/${kb.id}/relations`,
      headers: auth(owner.token),
      payload: { sourceNoteId: second.id, targetNoteId: first.id, type: 'references' },
    });
    expect(cycle.statusCode).toBe(201);

    const relationId = (created.json() as { relation: { id: string } }).relation.id;

    const trashed = await app.inject({
      method: 'DELETE',
      url: `/knowledge-bases/${kb.id}/notes/${first.id}/association`,
      headers: auth(owner.token),
    });
    expect(trashed.statusCode).toBe(204);
    expect((await graph(owner.token, kb.id)).json()).toMatchObject({ relations: [] });
    const restored = await app.inject({
      method: 'POST',
      url: `/knowledge-bases/${kb.id}/notes/${first.id}/restore`,
      headers: auth(owner.token),
    });
    expect(restored.statusCode).toBe(200);
    expect(
      ((await graph(owner.token, kb.id)).json() as { relations: unknown[] }).relations,
    ).toHaveLength(3);
    const removed = await app.inject({
      method: 'DELETE',
      url: `/knowledge-bases/${kb.id}/relations/${relationId}`,
      headers: auth(viewer.token),
    });
    expect(removed.statusCode).toBe(403);
  });

  it('keeps manual relations across revisions and scopes references to their source revision', async () => {
    const owner = await createUser('owner');
    const kb = await createKnowledgeBase(owner.token);
    const target = await upload(owner.token, kb.id, {
      body: 'target',
      filename: 'target.txt',
      mediaType: 'text/plain',
      title: 'Target',
    });
    const source = await upload(owner.token, kb.id, {
      body: `<a href="/notes/${target.id}">target</a>`,
      filename: 'source.html',
      mediaType: 'text/html',
      title: 'Source',
    });

    const relation = await app.inject({
      method: 'POST',
      url: `/knowledge-bases/${kb.id}/relations`,
      headers: auth(owner.token),
      payload: { sourceNoteId: source.id, targetNoteId: target.id, type: 'references' },
    });
    expect(relation.statusCode).toBe(201);
    const oldRevisionId = source.currentRevisionId;

    const replacement = multipart(
      new TextEncoder().encode('<p>No links now</p>'),
      'source.html',
      'text/html',
      'Source',
    );
    const replaced = await app.inject({
      method: 'POST',
      url: `/notes/${source.id}/revisions`,
      headers: { ...auth(owner.token), 'content-type': replacement.contentType },
      payload: replacement.payload,
    });
    expect(replaced.statusCode).toBe(201);

    expect((await graph(owner.token, kb.id)).json()).toMatchObject({
      references: [],
      relations: [{ type: 'references' }],
    });
    expect((await graph(owner.token, kb.id, `?revision=${oldRevisionId}`)).json()).toMatchObject({
      references: [{ sourceRevisionId: oldRevisionId, targetNoteId: target.id }],
    });
  });

  it('keeps relations isolated between Knowledge Bases and hides them from outsiders', async () => {
    const owner = await createUser('owner');
    const outsider = await createUser('outsider');
    const kb = await createKnowledgeBase(owner.token);
    const other = await createKnowledgeBase(owner.token, 'Other');
    const first = await upload(owner.token, kb.id, {
      body: 'first',
      filename: 'first.txt',
      mediaType: 'text/plain',
      title: 'First',
    });
    const second = await upload(owner.token, kb.id, {
      body: 'second',
      filename: 'second.txt',
      mediaType: 'text/plain',
      title: 'Second',
    });
    await app.inject({
      method: 'POST',
      url: `/knowledge-bases/${kb.id}/relations`,
      headers: auth(owner.token),
      payload: { sourceNoteId: first.id, targetNoteId: second.id, type: 'supersedes' },
    });

    expect((await graph(outsider.token, kb.id)).statusCode).toBe(404);
    expect((await graph(owner.token, other.id)).json()).toMatchObject({
      notes: [],
      relations: [],
    });
  });
});
