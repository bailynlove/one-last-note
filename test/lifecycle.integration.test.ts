import { randomUUID } from 'node:crypto';
import {
  AuthService,
  createToken,
  hashToken,
  LifecycleService,
  NoteService,
} from '@oln/application';
import { TRASH_RETENTION_MS } from '@oln/domain';
import {
  createAuthStore,
  createAuthThrottle,
  createLifecycleStore,
  createNoteStore,
  storageAdapter,
} from '@oln/infrastructure';
import { and, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  auditEvents,
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
let lifecycle: LifecycleService;
let now = new Date('2026-01-01T00:00:00.000Z');
let owner: { id: string; token: string };
let viewer: { id: string; token: string };

async function createUser(label: string) {
  const [user] = await stack.database.db
    .insert(users)
    .values({
      email: `${label}-${randomUUID()}@example.com`,
      displayName: label,
      emailVerifiedAt: new Date(),
    })
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

async function createKnowledgeBase(name: string, withViewer = true) {
  const [row] = await stack.database.db
    .insert(knowledgeBases)
    .values({ name, ownerId: owner.id })
    .returning();
  if (!row) throw new Error('kb insert failed');
  const members = [{ knowledgeBaseId: row.id, userId: owner.id, role: 'owner' }];
  if (withViewer) members.push({ knowledgeBaseId: row.id, userId: viewer.id, role: 'viewer' });
  await stack.database.db.insert(knowledgeBaseMemberships).values(members);
  return row.id;
}

async function createNote(knowledgeBaseIds: string[]) {
  const [note] = await stack.database.db
    .insert(notes)
    .values({ title: `Note ${randomUUID()}`, createdByUserId: owner.id })
    .returning();
  if (!note) throw new Error('note insert failed');
  await stack.database.db.insert(noteAssociations).values(
    knowledgeBaseIds.map((knowledgeBaseId) => ({
      noteId: note.id,
      knowledgeBaseId,
      createdByUserId: owner.id,
    })),
  );
  const key = `notes/${note.id}/revisions/${randomUUID()}/original`;
  const [revision] = await stack.database.db
    .insert(noteRevisions)
    .values({
      noteId: note.id,
      revisionNumber: 1,
      originalFilename: 'note.txt',
      mediaType: 'text/plain',
      byteSize: 4,
      contentHash: 'a'.repeat(64),
      storageKey: key,
      status: 'ready',
      uploadedByUserId: owner.id,
      processedAt: new Date(),
    })
    .returning();
  if (!revision) throw new Error('revision insert failed');
  await stack.database.db
    .update(notes)
    .set({ currentRevisionId: revision.id })
    .where(eq(notes.id, note.id));
  await stack.storage.putObject(key, Buffer.from('note'), 'text/plain');
  return { noteId: note.id, key };
}

function auth(token: string) {
  return { authorization: `Bearer ${token}` };
}

async function purge() {
  return lifecycle.purgeDue(async (keys) => {
    for (const key of keys) await stack.storage.deleteObject(key);
  });
}

beforeAll(async () => {
  stack = await startTestStack();
  lifecycle = new LifecycleService({
    store: createLifecycleStore(stack.database),
    now: () => now,
  });
  const notesService = new NoteService({
    store: createNoteStore(stack.database),
    storage: storageAdapter(stack.storage),
    scanner: { scan: async () => ({ clean: true }) },
    queue: { enqueueRevision: async () => {} },
    processInline: true,
  });
  const authService = new AuthService({
    store: createAuthStore(stack.database),
    email: { async sendMagicLink() {} },
    throttle: createAuthThrottle(stack.redis),
    webAppUrl: 'http://localhost:3000',
  });
  app = startTestApi(testReadiness(stack), {
    auth: authService,
    lifecycle,
    notes: notesService,
  });
  owner = await createUser('owner');
  viewer = await createUser('viewer');
});

afterAll(async () => {
  await app.close();
  await stack.close();
});

describe('sharing lifecycle', () => {
  it('removes an association for one Knowledge Base and restores it', async () => {
    const alpha = await createKnowledgeBase('Alpha');
    const beta = await createKnowledgeBase('Beta');
    const { noteId } = await createNote([alpha, beta]);

    const forbiddenRemove = await app.inject({
      method: 'DELETE',
      url: `/knowledge-bases/${alpha}/notes/${noteId}/association`,
      headers: auth(viewer.token),
    });
    expect(forbiddenRemove.statusCode).toBe(404);

    const removed = await app.inject({
      method: 'DELETE',
      url: `/knowledge-bases/${alpha}/notes/${noteId}/association`,
      headers: auth(owner.token),
    });
    expect(removed.statusCode).toBe(204);

    const hidden = await app.inject({
      method: 'GET',
      url: `/knowledge-bases/${alpha}/notes`,
      headers: auth(owner.token),
    });
    expect(hidden.json()).toEqual([]);
    const stillShared = await app.inject({
      method: 'GET',
      url: `/knowledge-bases/${beta}/notes`,
      headers: auth(owner.token),
    });
    expect((stillShared.json() as unknown[]).length).toBe(1);

    const forbiddenTrash = await app.inject({
      method: 'GET',
      url: `/knowledge-bases/${alpha}/trash`,
      headers: auth(viewer.token),
    });
    expect(forbiddenTrash.statusCode).toBe(403);

    const trash = await app.inject({
      method: 'GET',
      url: `/knowledge-bases/${alpha}/trash`,
      headers: auth(owner.token),
    });
    expect(trash.statusCode).toBe(200);
    expect((trash.json() as { associations: unknown[] }).associations).toHaveLength(1);

    const restored = await app.inject({
      method: 'POST',
      url: `/knowledge-bases/${alpha}/notes/${noteId}/restore`,
      headers: auth(owner.token),
    });
    expect(restored.statusCode).toBe(200);
    expect((restored.json() as { noteId: string }).noteId).toBe(noteId);
  });

  it('requires Owner to delete a Knowledge Base and keeps shared Notes available', async () => {
    const alpha = await createKnowledgeBase('Delete Alpha');
    const beta = await createKnowledgeBase('Keep Beta');
    const shared = await createNote([alpha, beta]);
    const exclusive = await createNote([alpha]);

    const forbidden = await app.inject({
      method: 'DELETE',
      url: `/knowledge-bases/${alpha}`,
      headers: auth(viewer.token),
    });
    expect(forbidden.statusCode).toBe(403);

    const deleted = await app.inject({
      method: 'DELETE',
      url: `/knowledge-bases/${alpha}`,
      headers: auth(owner.token),
    });
    expect(deleted.statusCode).toBe(204);

    const deletedList = await app.inject({
      method: 'GET',
      url: '/knowledge-bases/deleted',
      headers: auth(owner.token),
    });
    expect(deletedList.statusCode).toBe(200);
    expect(
      (deletedList.json() as { knowledgeBases: Array<{ id: string }> }).knowledgeBases.map(
        (row) => row.id,
      ),
    ).toContain(alpha);

    const sharedNote = await app.inject({
      method: 'GET',
      url: `/notes/${shared.noteId}`,
      headers: auth(owner.token),
    });
    expect(sharedNote.statusCode).toBe(200);
    const exclusiveNote = await app.inject({
      method: 'GET',
      url: `/notes/${exclusive.noteId}`,
      headers: auth(owner.token),
    });
    expect(exclusiveNote.statusCode).toBe(404);

    const restored = await app.inject({
      method: 'POST',
      url: `/knowledge-bases/${alpha}/restore`,
      headers: auth(owner.token),
    });
    expect(restored.statusCode).toBe(200);
    const [restoredRow] = await stack.database.db
      .select()
      .from(knowledgeBases)
      .where(eq(knowledgeBases.id, alpha));
    expect(restoredRow?.deletedAt).toBeNull();
  });

  it('purges only after 30 days, releasing objects when the last reference goes', async () => {
    const alpha = await createKnowledgeBase('Purge Alpha');
    const beta = await createKnowledgeBase('Purge Beta');
    const shared = await createNote([alpha, beta]);

    await app.inject({
      method: 'DELETE',
      url: `/knowledge-bases/${alpha}`,
      headers: auth(owner.token),
    });
    now = new Date(now.getTime() + TRASH_RETENTION_MS + 1);
    const tooLate = await app.inject({
      method: 'POST',
      url: `/knowledge-bases/${alpha}/restore`,
      headers: auth(owner.token),
    });
    expect(tooLate.statusCode).toBe(404);
    const first = await purge();
    expect(first.knowledgeBases).toBeGreaterThanOrEqual(1);

    const [stillThere] = await stack.database.db
      .select()
      .from(notes)
      .where(eq(notes.id, shared.noteId));
    expect(stillThere).toBeTruthy();
    const object = await stack.storage.getObject(shared.key);
    expect(Buffer.from(object).toString()).toBe('note');

    await app.inject({
      method: 'DELETE',
      url: `/knowledge-bases/${beta}`,
      headers: auth(owner.token),
    });
    now = new Date(now.getTime() + TRASH_RETENTION_MS + 1);
    const second = await purge();
    expect(second.notes).toBeGreaterThanOrEqual(1);
    expect(second.objects).toBeGreaterThanOrEqual(1);
    const [gone] = await stack.database.db.select().from(notes).where(eq(notes.id, shared.noteId));
    expect(gone).toBeUndefined();
    await expect(stack.storage.getObject(shared.key)).rejects.toThrow();
  });

  it('does not delete rows when object storage fails, then retries', async () => {
    const alpha = await createKnowledgeBase('Retry Alpha');
    const { noteId, key } = await createNote([alpha]);
    await app.inject({
      method: 'DELETE',
      url: `/knowledge-bases/${alpha}`,
      headers: auth(owner.token),
    });
    now = new Date(now.getTime() + TRASH_RETENTION_MS + 1);

    await expect(
      lifecycle.purgeDue(async () => {
        throw new Error('storage down');
      }),
    ).rejects.toThrow('storage down');
    const [stillThere] = await stack.database.db.select().from(notes).where(eq(notes.id, noteId));
    expect(stillThere).toBeTruthy();
    expect(Buffer.from(await stack.storage.getObject(key)).toString()).toBe('note');

    const retried = await purge();
    expect(retried.knowledgeBases).toBeGreaterThanOrEqual(1);
    const auditRows = await stack.database.db
      .select()
      .from(auditEvents)
      .where(and(eq(auditEvents.action, 'knowledge_base.purge')));
    expect(auditRows.length).toBeGreaterThan(0);
  });
});
