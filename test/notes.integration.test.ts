import { randomUUID } from 'node:crypto';
import {
  AuthService,
  createToken,
  hashToken,
  KnowledgeBaseService,
  NoteService,
} from '@oln/application';
import {
  createAuthStore,
  createAuthThrottle,
  createDevelopmentScanner,
  createKnowledgeBaseStore,
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

let stack: TestStack;
let app: FastifyInstance;

beforeAll(async () => {
  stack = await startTestStack();
  await stack.storage.ensureBucket();
  const auth = new AuthService({
    store: createAuthStore(stack.database),
    email: { async sendMagicLink() {} },
    throttle: createAuthThrottle(stack.redis),
    webAppUrl: 'http://localhost:3000',
  });
  const notes = new NoteService({
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
  app = startTestApi(testReadiness(stack), { auth, notes, knowledgeBases });
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
  if (!user) {
    throw new Error('user insert failed');
  }
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

async function createKnowledgeBase(token: string, name = `Research ${randomUUID()}`) {
  const response = await app.inject({
    method: 'POST',
    url: '/knowledge-bases',
    headers: auth(token),
    payload: { name, description: 'Sources' },
  });
  expect(response.statusCode).toBe(201);
  return response.json() as { id: string; name: string };
}

const PDF = new TextEncoder().encode('%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF\n');

function multipart(input: {
  bytes: Uint8Array;
  filename: string;
  mediaType: string;
  fields?: Record<string, string>;
}) {
  const boundary = `----oln-${randomUUID()}`;
  const chunks: Buffer[] = [];
  for (const [name, value] of Object.entries(input.fields ?? {})) {
    chunks.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`,
      ),
    );
  }
  chunks.push(
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${input.filename}"\r\nContent-Type: ${input.mediaType}\r\n\r\n`,
    ),
    Buffer.from(input.bytes),
    Buffer.from(`\r\n--${boundary}--\r\n`),
  );
  return {
    payload: Buffer.concat(chunks),
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}

async function upload(
  token: string,
  knowledgeBaseId: string,
  input: { bytes: Uint8Array; filename: string; mediaType: string; title?: string },
) {
  const body = multipart({
    ...input,
    fields: input.title ? { title: input.title } : undefined,
  });
  return app.inject({
    method: 'POST',
    url: `/knowledge-bases/${knowledgeBaseId}/notes`,
    headers: { ...auth(token), 'content-type': body.contentType },
    payload: body.payload,
  });
}

describe('Note upload and revisions', () => {
  it('uploads an original, releases it, and allows download', async () => {
    const owner = await createUser('owner');
    const knowledgeBase = await createKnowledgeBase(owner.token);

    const response = await upload(owner.token, knowledgeBase.id, {
      bytes: PDF,
      filename: 'paper.pdf',
      mediaType: 'application/pdf',
      title: 'A paper',
    });
    expect(response.statusCode).toBe(201);
    const note = response.json() as {
      id: string;
      title: string;
      status: string;
      currentRevisionId: string;
      revisions: Array<{ id: string; status: string; byteSize: number }>;
      associations: Array<{ knowledgeBaseId: string }>;
    };
    expect(note.title).toBe('A paper');
    expect(note.revisions).toHaveLength(1);
    expect(note.revisions[0]?.status).toBe('ready');
    expect(note.revisions[0]?.byteSize).toBe(PDF.length);
    expect(note.associations[0]?.knowledgeBaseId).toBe(knowledgeBase.id);
    expect(JSON.stringify(note)).not.toContain('storageKey');

    const list = await app.inject({
      method: 'GET',
      url: `/knowledge-bases/${knowledgeBase.id}/notes`,
      headers: auth(owner.token),
    });
    expect(list.statusCode).toBe(200);
    expect(list.json()).toHaveLength(1);

    const download = await app.inject({
      method: 'GET',
      url: `/notes/${note.id}/revisions/${note.revisions[0]?.id}/original`,
      headers: auth(owner.token),
    });
    expect(download.statusCode).toBe(200);
    expect(download.headers['content-type']).toBe('application/pdf');
    expect(download.rawPayload.equals(Buffer.from(PDF))).toBe(true);
  });

  it('keeps every Revision when replaced and exposes the latest as current', async () => {
    const owner = await createUser('replace');
    const knowledgeBase = await createKnowledgeBase(owner.token);
    const first = (
      await upload(owner.token, knowledgeBase.id, {
        bytes: PDF,
        filename: 'first.pdf',
        mediaType: 'application/pdf',
      })
    ).json() as { id: string; currentRevisionId: string; revisions: Array<{ id: string }> };

    const replacementBody = multipart({
      bytes: new TextEncoder().encode('%PDF-1.7\nreplacement\n%%EOF'),
      filename: 'second.pdf',
      mediaType: 'application/pdf',
      fields: { title: 'Replacement' },
    });
    const replacement = await app.inject({
      method: 'POST',
      url: `/notes/${first.id}/revisions`,
      headers: { ...auth(owner.token), 'content-type': replacementBody.contentType },
      payload: replacementBody.payload,
    });
    expect(replacement.statusCode).toBe(201);
    const second = replacement.json() as {
      currentRevisionId: string;
      revisions: Array<{ id: string; revisionNumber: number; status: string }>;
    };
    expect(second.revisions).toHaveLength(2);
    expect(second.currentRevisionId).not.toBe(first.currentRevisionId);
    expect(second.revisions.map((revision) => revision.revisionNumber)).toEqual([2, 1]);
    expect(second.revisions[0]?.status).toBe('ready');

    const oldDownload = await app.inject({
      method: 'GET',
      url: `/notes/${first.id}/revisions/${first.currentRevisionId}/original`,
      headers: auth(owner.token),
    });
    expect(oldDownload.statusCode).toBe(200);
  });

  it('associates a Note with another Knowledge Base and updates both lists', async () => {
    const owner = await createUser('associate');
    const source = await createKnowledgeBase(owner.token, 'Source');
    const target = await createKnowledgeBase(owner.token, 'Target');
    const note = (
      await upload(owner.token, source.id, {
        bytes: PDF,
        filename: 'shared.pdf',
        mediaType: 'application/pdf',
      })
    ).json() as { id: string };

    const attached = await app.inject({
      method: 'POST',
      url: `/notes/${note.id}/associations`,
      headers: auth(owner.token),
      payload: { sourceKnowledgeBaseId: source.id, targetKnowledgeBaseId: target.id },
    });
    expect(attached.statusCode).toBe(200);
    expect((attached.json() as { associations: unknown[] }).associations).toHaveLength(2);

    const targetNotes = await app.inject({
      method: 'GET',
      url: `/knowledge-bases/${target.id}/notes`,
      headers: auth(owner.token),
    });
    expect(targetNotes.statusCode).toBe(200);
    expect(targetNotes.json()).toHaveLength(1);
  });

  it('retains rejected attempts without releasing them', async () => {
    const owner = await createUser('reject');
    const knowledgeBase = await createKnowledgeBase(owner.token);

    const archived = await upload(owner.token, knowledgeBase.id, {
      bytes: new TextEncoder().encode('PK\u0003\u0004archive'),
      filename: 'bundle.pdf',
      mediaType: 'application/pdf',
    });
    expect(archived.statusCode).toBe(201);
    const note = archived.json() as {
      id: string;
      status: string;
      revisions: Array<{ id: string; status: string; statusDetail: string | null }>;
    };
    expect(note.revisions[0]?.status).toBe('rejected');
    expect(note.revisions[0]?.statusDetail).toBe('archive_not_allowed');

    const download = await app.inject({
      method: 'GET',
      url: `/notes/${note.id}/revisions/${note.revisions[0]?.id}/original`,
      headers: auth(owner.token),
    });
    expect(download.statusCode).toBe(409);

    const encrypted = await upload(owner.token, knowledgeBase.id, {
      bytes: new TextEncoder().encode('%PDF-1.7\n1 0 obj\n<< /Encrypt 1 >>\nendobj\n%%EOF'),
      filename: 'locked.pdf',
      mediaType: 'application/pdf',
    });
    expect(encrypted.statusCode).toBe(201);
    const encryptedNote = encrypted.json() as {
      revisions: Array<{ status: string; statusDetail: string | null }>;
    };
    expect(encryptedNote.revisions[0]?.status).toBe('rejected');
    expect(encryptedNote.revisions[0]?.statusDetail).toBe('encrypted_pdf');
  });

  it('queues a Revision, keeps it quarantined, and releases it after scanning', async () => {
    const owner = await createUser('queued');
    const knowledgeBase = await createKnowledgeBase(owner.token);
    const queued: string[] = [];
    const service = new NoteService({
      store: createNoteStore(stack.database),
      storage: storageAdapter(stack.storage),
      scanner: createDevelopmentScanner(),
      processInline: false,
      queue: {
        async enqueueRevision(revisionId) {
          queued.push(revisionId);
        },
      },
    });

    const note = await service.upload(owner.id, [knowledgeBase.id], {
      filename: 'queued.pdf',
      mediaType: 'application/pdf',
      bytes: PDF,
    });
    expect(note.revisions[0]?.status).toBe('quarantined');
    expect(queued).toHaveLength(1);

    await service.processRevision(queued[0] as string);
    const released = await service.getNote(owner.id, note.id);
    expect(released.revisions[0]?.status).toBe('ready');
    expect(released.currentRevisionId).toBe(queued[0]);
  });

  it('rejects uploads over the Knowledge Base quota', async () => {
    const owner = await createUser('quota');
    const knowledgeBase = await createKnowledgeBase(owner.token);
    const service = new NoteService({
      store: createNoteStore(stack.database),
      storage: storageAdapter(stack.storage),
      scanner: createDevelopmentScanner(),
      processInline: true,
      quotaBytes: PDF.length - 1,
    });

    await expect(
      service.upload(owner.id, [knowledgeBase.id], {
        filename: 'over.pdf',
        mediaType: 'application/pdf',
        bytes: PDF,
      }),
    ).rejects.toMatchObject({ status: 413, title: 'Storage quota exceeded' });

    const list = await app.inject({
      method: 'GET',
      url: `/knowledge-bases/${knowledgeBase.id}/notes`,
      headers: auth(owner.token),
    });
    expect(list.json()).toEqual([]);
  });

  it('assigns distinct Revision numbers under concurrent replacements', async () => {
    const owner = await createUser('concurrent');
    const knowledgeBase = await createKnowledgeBase(owner.token);
    const note = (
      await upload(owner.token, knowledgeBase.id, {
        bytes: PDF,
        filename: 'base.pdf',
        mediaType: 'application/pdf',
      })
    ).json() as { id: string };

    const bodies = ['one', 'two'].map((label) =>
      multipart({
        bytes: new TextEncoder().encode(`%PDF-1.7\n${label}\n%%EOF`),
        filename: `${label}.pdf`,
        mediaType: 'application/pdf',
      }),
    );
    const responses = await Promise.all(
      bodies.map((body) =>
        app.inject({
          method: 'POST',
          url: `/notes/${note.id}/revisions`,
          headers: { ...auth(owner.token), 'content-type': body.contentType },
          payload: body.payload,
        }),
      ),
    );
    expect(responses.map((response) => response.statusCode)).toEqual([201, 201]);

    const loaded = await app.inject({
      method: 'GET',
      url: `/notes/${note.id}`,
      headers: auth(owner.token),
    });
    const revisions = (loaded.json() as { revisions: Array<{ revisionNumber: number }> }).revisions;
    expect(revisions).toHaveLength(3);
    expect(new Set(revisions.map((revision) => revision.revisionNumber)).size).toBe(3);
    expect(revisions.map((revision) => revision.revisionNumber)).toEqual([3, 2, 1]);
  });

  it('denies Viewers, non-members, and unauthenticated uploads', async () => {
    const owner = await createUser('owner');
    const viewer = await createUser('viewer');
    const outsider = await createUser('outsider');
    const knowledgeBase = await createKnowledgeBase(owner.token);
    await stack.database.db.insert(knowledgeBaseMemberships).values({
      knowledgeBaseId: knowledgeBase.id,
      userId: viewer.id,
      role: 'viewer',
    });

    for (const token of [viewer.token, outsider.token]) {
      const response = await upload(token, knowledgeBase.id, {
        bytes: PDF,
        filename: 'nope.pdf',
        mediaType: 'application/pdf',
      });
      expect(response.statusCode).toBe(403);
    }

    const anonymous = await app.inject({
      method: 'GET',
      url: `/knowledge-bases/${knowledgeBase.id}/notes`,
    });
    expect(anonymous.statusCode).toBe(401);
    expect(anonymous.headers['content-type']).toContain('application/problem+json');
  });
});
