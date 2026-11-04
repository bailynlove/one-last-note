import { randomUUID } from 'node:crypto';
import {
  AnnotationService,
  AppExtensionService,
  AuthService,
  createToken,
  hashToken,
  KnowledgeBaseService,
} from '@oln/application';
import {
  createAnnotationStore,
  createAppExtensionStore,
  createAuthStore,
  createAuthThrottle,
  createKnowledgeBaseStore,
} from '@oln/infrastructure';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  knowledgeBaseMemberships,
  knowledgeBases,
  noteAssociations,
  noteRevisions,
  notes,
  sessions,
  users,
} from '../packages/infrastructure/src/db/schema';
import { startTestApi, startTestStack, type TestStack, testReadiness } from './fixtures';

let stack: TestStack;
let app: FastifyInstance;

beforeAll(async () => {
  stack = await startTestStack();
  const auth = new AuthService({
    store: createAuthStore(stack.database),
    email: { async sendMagicLink() {} },
    throttle: createAuthThrottle(stack.redis),
    webAppUrl: 'http://localhost:3000',
  });
  const knowledgeBases = new KnowledgeBaseService({
    store: createKnowledgeBaseStore(stack.database),
    email: { async sendInvitation() {} },
    webAppUrl: 'http://localhost:3000',
  });
  const appExtensions = new AppExtensionService({
    store: createAppExtensionStore(stack.database),
  });
  const annotations = new AnnotationService({
    store: createAnnotationStore(stack.database),
    markTypes: appExtensions,
  });
  app = startTestApi(testReadiness(stack), { auth, knowledgeBases, appExtensions, annotations });
});

afterAll(async () => {
  await app.close();
  await stack.close();
});

async function createUser(label: string): Promise<{ id: string; token: string }> {
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

async function createKnowledgeBase(userId: string, label: string): Promise<string> {
  const [kb] = await stack.database.db
    .insert(knowledgeBases)
    .values({ name: `${label} ${randomUUID()}`, ownerId: userId })
    .returning();
  if (!kb) throw new Error('KB insert failed');
  await stack.database.db
    .insert(knowledgeBaseMemberships)
    .values({ knowledgeBaseId: kb.id, userId, role: 'owner' });
  return kb.id;
}

async function createNote(userId: string, knowledgeBaseId: string) {
  const [note] = await stack.database.db
    .insert(notes)
    .values({ title: 'Mark test', createdByUserId: userId })
    .returning();
  if (!note) throw new Error('note insert failed');
  const [revision] = await stack.database.db
    .insert(noteRevisions)
    .values({
      noteId: note.id,
      revisionNumber: 1,
      originalFilename: 'note.txt',
      mediaType: 'text/plain',
      byteSize: 5,
      contentHash: 'hash',
      storageKey: 'test/original',
      status: 'ready',
      uploadedByUserId: userId,
      processedAt: new Date(),
    })
    .returning();
  if (!revision) throw new Error('revision insert failed');
  await stack.database.db
    .update(notes)
    .set({ currentRevisionId: revision.id })
    .where(eq(notes.id, note.id));
  await stack.database.db
    .insert(noteAssociations)
    .values({ noteId: note.id, knowledgeBaseId, createdByUserId: userId });
  return { noteId: note.id, revisionId: revision.id };
}

function auth(token: string) {
  return { authorization: `Bearer ${token}` };
}

function manifest(version = '1.0.0') {
  return {
    id: 'acme.reader',
    name: 'Acme Reader',
    version,
    apiVersion: 1,
    publisher: 'Acme',
    renderers: [
      {
        id: 'reader',
        label: 'Acme Reader',
        extensions: ['acme'],
        mediaTypes: ['application/x-acme'],
        entry: 'renderer.js',
      },
    ],
    marks: [
      {
        type: 'acme.reader:rating',
        label: 'Rating',
        description: 'A one-to-five rating.',
        schema: {
          type: 'object',
          additionalProperties: false,
          required: ['value'],
          properties: { value: { type: 'integer', minimum: 1, maximum: 5 } },
        },
        defaultPayload: { value: 3 },
      },
    ],
    permissions: ['read-revision'],
  };
}

const files = { 'renderer.js': 'oln.root.textContent = oln.revision.filename;' };

async function install(token: string, knowledgeBaseId: string, version = '1.0.0') {
  return app.inject({
    method: 'POST',
    url: `/knowledge-bases/${knowledgeBaseId}/extensions`,
    headers: auth(token),
    payload: { manifest: manifest(version), files, source: 'test' },
  });
}

async function toggle(token: string, knowledgeBaseId: string, id: string, enabled: boolean) {
  return app.inject({
    method: 'PATCH',
    url: `/knowledge-bases/${knowledgeBaseId}/extensions/${id}`,
    headers: auth(token),
    payload: { enabled },
  });
}

describe('App Extension packages', () => {
  it('installs a pinned package for one KB and exposes it to viewers', async () => {
    const owner = await createUser('owner');
    const viewer = await createUser('viewer');
    const kb = await createKnowledgeBase(owner.id, 'Extensions');
    const other = await createKnowledgeBase(owner.id, 'Other');
    await stack.database.db
      .insert(knowledgeBaseMemberships)
      .values({ knowledgeBaseId: kb, userId: viewer.id, role: 'viewer' });

    const response = await install(owner.token, kb);
    expect(response.statusCode).toBe(201);
    const body = response.json() as {
      installation: { id: string; packageHash: string; enabled: boolean };
    };
    expect(body.installation.packageHash).toHaveLength(64);
    expect(body.installation.enabled).toBe(false);

    const listed = await app.inject({
      method: 'GET',
      url: `/knowledge-bases/${kb}/extensions`,
      headers: auth(viewer.token),
    });
    expect(listed.statusCode).toBe(200);
    expect((listed.json() as { installations: unknown[] }).installations).toHaveLength(1);
    expect(
      (
        await app.inject({
          method: 'GET',
          url: `/knowledge-bases/${other}/extensions`,
          headers: auth(owner.token),
        })
      ).json(),
    ).toMatchObject({ installations: [] });
  });

  it('rejects viewer management and duplicate versions', async () => {
    const owner = await createUser('owner');
    const viewer = await createUser('viewer');
    const kb = await createKnowledgeBase(owner.id, 'Extensions');
    await stack.database.db
      .insert(knowledgeBaseMemberships)
      .values({ knowledgeBaseId: kb, userId: viewer.id, role: 'viewer' });
    expect((await install(owner.token, kb)).statusCode).toBe(201);
    expect((await install(owner.token, kb)).statusCode).toBe(409);
    expect((await install(viewer.token, kb, '1.1.0')).statusCode).toBe(403);
    expect((await toggle(viewer.token, kb, randomUUID(), true)).statusCode).toBe(403);
  });

  it('exposes permitted Mark types only while enabled in that Knowledge Base', async () => {
    const owner = await createUser('owner');
    const viewer = await createUser('viewer');
    const kb = await createKnowledgeBase(owner.id, 'Extensions');
    const other = await createKnowledgeBase(owner.id, 'Other');
    await stack.database.db
      .insert(knowledgeBaseMemberships)
      .values({ knowledgeBaseId: kb, userId: viewer.id, role: 'viewer' });
    const installed = (await install(owner.token, kb)).json() as {
      installation: { id: string };
    };
    await toggle(owner.token, kb, installed.installation.id, true);

    const enabled = await app.inject({
      method: 'GET',
      url: `/knowledge-bases/${kb}/mark-types`,
      headers: auth(viewer.token),
    });
    expect(enabled.statusCode).toBe(200);
    const markTypes = (
      enabled.json() as {
        markTypes: { type: string; source: string; extensionId?: string }[];
      }
    ).markTypes;
    expect(markTypes.find((item) => item.type === 'core/highlight')?.source).toBe('builtin');
    expect(markTypes.find((item) => item.type === 'acme.reader:rating')).toMatchObject({
      source: 'extension',
      extensionId: 'acme.reader',
    });

    await toggle(owner.token, kb, installed.installation.id, false);
    const disabled = await app.inject({
      method: 'GET',
      url: `/knowledge-bases/${kb}/mark-types`,
      headers: auth(viewer.token),
    });
    expect(
      (disabled.json() as { markTypes: { type: string }[] }).markTypes.map((item) => item.type),
    ).toEqual(['core/highlight']);
    const isolated = await app.inject({
      method: 'GET',
      url: `/knowledge-bases/${other}/mark-types`,
      headers: auth(owner.token),
    });
    expect(
      (isolated.json() as { markTypes: { type: string }[] }).markTypes.map((item) => item.type),
    ).toEqual(['core/highlight']);
  });

  it('switches enabled versions and supports rollback and removal', async () => {
    const owner = await createUser('owner');
    const kb = await createKnowledgeBase(owner.id, 'Extensions');
    const first = (await install(owner.token, kb, '1.0.0')).json() as {
      installation: { id: string };
    };
    const second = (await install(owner.token, kb, '1.1.0')).json() as {
      installation: { id: string };
    };
    expect((await toggle(owner.token, kb, first.installation.id, true)).statusCode).toBe(200);
    expect((await toggle(owner.token, kb, second.installation.id, true)).json()).toMatchObject({
      installation: { enabled: true, version: '1.1.0' },
    });
    const listed = (
      await app.inject({
        method: 'GET',
        url: `/knowledge-bases/${kb}/extensions`,
        headers: auth(owner.token),
      })
    ).json() as { installations: { id: string; enabled: boolean }[] };
    expect(listed.installations.find((item) => item.id === first.installation.id)?.enabled).toBe(
      false,
    );
    expect((await toggle(owner.token, kb, first.installation.id, true)).statusCode).toBe(200);
    expect(
      (
        await app.inject({
          method: 'DELETE',
          url: `/knowledge-bases/${kb}/extensions/${second.installation.id}`,
          headers: auth(owner.token),
        })
      ).statusCode,
    ).toBe(204);
  });

  it('validates custom Mark payloads and preserves them after the type is disabled', async () => {
    const owner = await createUser('owner');
    const kb = await createKnowledgeBase(owner.id, 'Extensions');
    const note = await createNote(owner.id, kb);
    const installed = (await install(owner.token, kb)).json() as {
      installation: { id: string };
    };
    await toggle(owner.token, kb, installed.installation.id, true);
    const anchor = {
      kind: 'text',
      exact: 'quote',
      prefix: '',
      suffix: '',
      startOffset: 0,
      endOffset: 5,
      path: 'p',
    };
    const create = await app.inject({
      method: 'POST',
      url: `/knowledge-bases/${kb}/notes/${note.noteId}/annotations`,
      headers: auth(owner.token),
      payload: {
        revisionId: note.revisionId,
        kind: 'mark',
        markType: 'acme.reader:rating',
        payload: { value: 4 },
        anchor,
      },
    });
    expect(create.statusCode).toBe(201);
    expect(create.json()).toMatchObject({
      markType: 'acme.reader:rating',
      payload: { value: 4 },
    });
    const invalid = await app.inject({
      method: 'POST',
      url: `/knowledge-bases/${kb}/notes/${note.noteId}/annotations`,
      headers: auth(owner.token),
      payload: {
        revisionId: note.revisionId,
        kind: 'mark',
        markType: 'acme.reader:rating',
        payload: { value: 9 },
        anchor,
      },
    });
    expect(invalid.statusCode).toBe(422);

    await toggle(owner.token, kb, installed.installation.id, false);
    const blocked = await app.inject({
      method: 'POST',
      url: `/knowledge-bases/${kb}/notes/${note.noteId}/annotations`,
      headers: auth(owner.token),
      payload: {
        revisionId: note.revisionId,
        kind: 'mark',
        markType: 'acme.reader:rating',
        anchor,
      },
    });
    expect(blocked.statusCode).toBe(422);
    const listed = await app.inject({
      method: 'GET',
      url: `/knowledge-bases/${kb}/notes/${note.noteId}/annotations`,
      headers: auth(owner.token),
    });
    expect(listed.json()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ markType: 'acme.reader:rating', payload: { value: 4 } }),
      ]),
    );
  });
});
