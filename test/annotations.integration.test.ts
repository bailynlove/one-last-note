import { randomUUID } from 'node:crypto';
import { AnnotationService, AuthService, createToken, hashToken } from '@oln/application';
import { createAnnotationStore, createAuthStore, createAuthThrottle } from '@oln/infrastructure';
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
const revisionTexts = new Map<string, string>();
let app: FastifyInstance;
let owner: { id: string; token: string };
let viewer: { id: string; token: string };
let manager: { id: string; token: string };
let outsider: { id: string; token: string };
let knowledgeBaseId: string;
let otherKnowledgeBaseId: string;
let noteId: string;
let revisionId: string;

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

async function createKnowledgeBase(name: string) {
  const [row] = await stack.database.db
    .insert(knowledgeBases)
    .values({ name, ownerId: owner.id })
    .returning();
  if (!row) throw new Error('knowledge base insert failed');
  await stack.database.db.insert(knowledgeBaseMemberships).values([
    { knowledgeBaseId: row.id, userId: owner.id, role: 'owner' },
    { knowledgeBaseId: row.id, userId: viewer.id, role: 'viewer' },
    { knowledgeBaseId: row.id, userId: manager.id, role: 'manager' },
  ]);
  return row.id;
}

async function createRevision(number: number, text: string) {
  const [revision] = await stack.database.db
    .insert(noteRevisions)
    .values({
      noteId,
      revisionNumber: number,
      originalFilename: 'note.txt',
      mediaType: 'text/plain',
      byteSize: Buffer.byteLength(text),
      contentHash: `${number}`.repeat(64).slice(0, 64),
      storageKey: `notes/${noteId}/revisions/${randomUUID()}/original`,
      status: 'ready',
      uploadedByUserId: owner.id,
      processedAt: new Date(),
    })
    .returning();
  if (!revision) throw new Error('revision insert failed');
  revisionTexts.set(revision.id, text);
  await stack.database.db
    .update(notes)
    .set({ currentRevisionId: revision.id })
    .where(eq(notes.id, noteId));
  return revision.id;
}

function auth(token: string) {
  return { authorization: `Bearer ${token}` };
}

async function createAnnotation(
  token: string,
  input: {
    revisionId?: string;
    kind?: 'comment' | 'mark';
    body?: string;
    markType?: string;
    exact?: string;
    knowledgeBase?: string;
  } = {},
) {
  const exact = input.exact ?? 'shared phrase';
  return app.inject({
    method: 'POST',
    url: `/knowledge-bases/${input.knowledgeBase ?? knowledgeBaseId}/notes/${noteId}/annotations`,
    headers: auth(token),
    payload: {
      revisionId: input.revisionId ?? revisionId,
      kind: input.kind ?? 'comment',
      body: (input.kind ?? 'comment') === 'comment' ? (input.body ?? 'A thought') : input.body,
      markType: input.markType,
      anchor: {
        kind: 'text',
        exact,
        prefix: '',
        suffix: '',
        startOffset: 0,
        endOffset: exact.length,
        path: 'body:nth-child(1)',
      },
    },
  });
}

beforeAll(async () => {
  stack = await startTestStack();
  const authService = new AuthService({
    store: createAuthStore(stack.database),
    email: { async sendMagicLink() {} },
    throttle: createAuthThrottle(stack.redis),
    webAppUrl: 'http://localhost:3000',
  });
  app = startTestApi(testReadiness(stack), {
    auth: authService,
    annotations: new AnnotationService({
      store: createAnnotationStore(stack.database),
      noteText: async (_userId, _noteId, revisionId) => revisionTexts.get(revisionId) ?? null,
    }),
  });
  owner = await createUser('owner');
  viewer = await createUser('viewer');
  manager = await createUser('manager');
  outsider = await createUser('outsider');
  knowledgeBaseId = await createKnowledgeBase('Alpha');
  otherKnowledgeBaseId = await createKnowledgeBase('Beta');

  const [note] = await stack.database.db
    .insert(notes)
    .values({ title: 'Shared note', createdByUserId: owner.id })
    .returning();
  if (!note) throw new Error('note insert failed');
  noteId = note.id;
  await stack.database.db.insert(noteAssociations).values([
    { noteId, knowledgeBaseId, createdByUserId: owner.id },
    { noteId, knowledgeBaseId: otherKnowledgeBaseId, createdByUserId: owner.id },
  ]);
  revisionId = await createRevision(1, 'A shared phrase in the first revision.');
});

afterAll(async () => {
  await app.close();
  await stack.close();
});

describe('annotations', () => {
  it('lets Viewers comment, reply, and read; rejects Marks with text', async () => {
    const created = await createAnnotation(viewer.token);
    expect(created.statusCode).toBe(201);
    const comment = created.json() as { id: string; kind: string; replies: unknown[] };
    expect(comment.kind).toBe('comment');

    const reply = await app.inject({
      method: 'POST',
      url: `/knowledge-bases/${knowledgeBaseId}/notes/${noteId}/annotations/${comment.id}/replies`,
      headers: auth(owner.token),
      payload: { body: 'A reply' },
    });
    expect(reply.statusCode).toBe(201);

    const list = await app.inject({
      method: 'GET',
      url: `/knowledge-bases/${knowledgeBaseId}/notes/${noteId}/annotations`,
      headers: auth(viewer.token),
    });
    expect(list.statusCode).toBe(200);
    const rows = list.json() as Array<{ replies: Array<{ body: string }> }>;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.replies[0]?.body).toBe('A reply');

    const mark = await createAnnotation(viewer.token, { kind: 'mark', body: 'not allowed' });
    expect(mark.statusCode).toBe(400);
    expect(mark.json()).toMatchObject({ title: 'Invalid annotation' });
  });

  it('keeps annotations scoped to their Knowledge Base', async () => {
    await createAnnotation(viewer.token, { exact: 'scoped phrase' });
    const other = await app.inject({
      method: 'GET',
      url: `/knowledge-bases/${otherKnowledgeBaseId}/notes/${noteId}/annotations`,
      headers: auth(viewer.token),
    });
    expect(other.statusCode).toBe(200);
    expect(other.json()).toEqual([]);

    const forbidden = await app.inject({
      method: 'GET',
      url: `/knowledge-bases/${knowledgeBaseId}/notes/${noteId}/annotations`,
      headers: auth(outsider.token),
    });
    expect(forbidden.statusCode).toBe(404);
  });

  it('re-anchors unique passages and marks ambiguous ones for review', async () => {
    const unique = await createAnnotation(viewer.token, {
      exact: 'moves with revision',
      body: 'Still here?',
    });
    expect(unique.statusCode).toBe(201);
    const annotation = unique.json() as { id: string };
    const nextRevision = await createRevision(2, 'Intro. The moves with revision text stays.');
    const list = await app.inject({
      method: 'GET',
      url: `/knowledge-bases/${knowledgeBaseId}/notes/${noteId}/annotations?revisionId=${nextRevision}`,
      headers: auth(viewer.token),
    });
    expect(list.statusCode).toBe(200);
    const moved = (
      list.json() as Array<{ id: string; needsReview: boolean; anchor: { startOffset: number } }>
    ).find((row) => row.id === annotation.id);
    expect(moved).toMatchObject({ needsReview: false, anchor: { startOffset: 11 } });

    const ambiguous = await createAnnotation(viewer.token, { exact: 'repeat me' });
    expect(ambiguous.statusCode).toBe(201);
    const ambiguousRevision = await createRevision(3, 'repeat me then repeat me');
    const after = await app.inject({
      method: 'GET',
      url: `/knowledge-bases/${knowledgeBaseId}/notes/${noteId}/annotations?revisionId=${ambiguousRevision}`,
      headers: auth(viewer.token),
    });
    const marked = (after.json() as Array<{ id: string; needsReview: boolean }>).find(
      (row) => row.id === (ambiguous.json() as { id: string }).id,
    );
    expect(marked?.needsReview).toBe(true);
  });

  it('keeps the authored anchor when re-anchoring for display', async () => {
    const created = await createAnnotation(viewer.token, { exact: 'display only' });
    expect(created.statusCode).toBe(201);
    const annotation = created.json() as { id: string; anchor: { startOffset: number } };
    const nextRevision = await createRevision(4, 'Intro. The display only text stays.');
    const moved = await app.inject({
      method: 'GET',
      url: `/knowledge-bases/${knowledgeBaseId}/notes/${noteId}/annotations?revisionId=${nextRevision}`,
      headers: auth(viewer.token),
    });
    expect(
      (moved.json() as Array<{ id: string; anchor: { startOffset: number } }>).find(
        (row) => row.id === annotation.id,
      )?.anchor.startOffset,
    ).toBe(11);

    const original = await app.inject({
      method: 'GET',
      url: `/knowledge-bases/${knowledgeBaseId}/notes/${noteId}/annotations`,
      headers: auth(viewer.token),
    });
    expect(
      (original.json() as Array<{ id: string; anchor: { startOffset: number } }>).find(
        (row) => row.id === annotation.id,
      )?.anchor.startOffset,
    ).toBe(annotation.anchor.startOffset);
  });

  it('allows author edits, moderator deletion, and tombstones threaded roots', async () => {
    const created = await createAnnotation(viewer.token, { exact: 'moderated', body: 'Original' });
    const comment = created.json() as { id: string };
    const edited = await app.inject({
      method: 'PATCH',
      url: `/knowledge-bases/${knowledgeBaseId}/notes/${noteId}/annotations/${comment.id}`,
      headers: auth(viewer.token),
      payload: { body: 'Edited' },
    });
    expect(edited.statusCode).toBe(200);
    expect(edited.json()).toMatchObject({ body: 'Edited' });

    const otherEdit = await app.inject({
      method: 'PATCH',
      url: `/knowledge-bases/${knowledgeBaseId}/notes/${noteId}/annotations/${comment.id}`,
      headers: auth(owner.token),
      payload: { body: 'Not mine' },
    });
    expect(otherEdit.statusCode).toBe(403);

    await app.inject({
      method: 'POST',
      url: `/knowledge-bases/${knowledgeBaseId}/notes/${noteId}/annotations/${comment.id}/replies`,
      headers: auth(owner.token),
      payload: { body: 'Reply that survives' },
    });
    const removed = await app.inject({
      method: 'DELETE',
      url: `/knowledge-bases/${knowledgeBaseId}/notes/${noteId}/annotations/${comment.id}`,
      headers: auth(manager.token),
    });
    expect(removed.statusCode).toBe(204);

    const list = await app.inject({
      method: 'GET',
      url: `/knowledge-bases/${knowledgeBaseId}/notes/${noteId}/annotations`,
      headers: auth(viewer.token),
    });
    const tombstone = (
      list.json() as Array<{ id: string; deleted: boolean; replies: unknown[] }>
    ).find((row) => row.id === comment.id);
    expect(tombstone).toMatchObject({ deleted: true, body: null });
    expect(tombstone?.replies).toHaveLength(1);
  });

  it('returns overlapping Marks separately so either can be selected', async () => {
    const first = await createAnnotation(viewer.token, { kind: 'mark', exact: 'overlap' });
    const second = await createAnnotation(owner.token, { kind: 'mark', exact: 'overlap' });
    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);
    const list = await app.inject({
      method: 'GET',
      url: `/knowledge-bases/${knowledgeBaseId}/notes/${noteId}/annotations`,
      headers: auth(viewer.token),
    });
    const overlaps = (list.json() as Array<{ id: string; anchor: { exact: string } }>).filter(
      (row) => row.anchor.exact === 'overlap',
    );
    expect(overlaps.map((row) => row.id).sort()).toEqual(
      [first.json<{ id: string }>().id, second.json<{ id: string }>().id].sort(),
    );
  });

  it('accepts normalized PDF regions and rejects out-of-range rectangles', async () => {
    const created = await app.inject({
      method: 'POST',
      url: `/knowledge-bases/${knowledgeBaseId}/notes/${noteId}/annotations`,
      headers: auth(viewer.token),
      payload: {
        revisionId,
        kind: 'mark',
        anchor: { kind: 'pdf', page: 1, rect: { x: 0.1, y: 0.2, width: 0.3, height: 0.1 } },
      },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({
      kind: 'mark',
      markType: 'core/highlight',
      anchor: { kind: 'pdf', page: 1 },
    });

    const invalid = await app.inject({
      method: 'POST',
      url: `/knowledge-bases/${knowledgeBaseId}/notes/${noteId}/annotations`,
      headers: auth(viewer.token),
      payload: {
        revisionId,
        kind: 'mark',
        anchor: { kind: 'pdf', page: 1, rect: { x: 0.9, y: 0.2, width: 0.3, height: 0.1 } },
      },
    });
    expect(invalid.statusCode).toBe(400);
  });

  it('rejects unknown Mark types, nested replies, and outsider writes', async () => {
    const unknownMark = await createAnnotation(viewer.token, {
      kind: 'mark',
      exact: 'typed mark',
      markType: 'not-namespaced',
    });
    expect(unknownMark.statusCode).toBe(400);

    const root = await createAnnotation(viewer.token, { exact: 'thread root' });
    const reply = await app.inject({
      method: 'POST',
      url: `/knowledge-bases/${knowledgeBaseId}/notes/${noteId}/annotations/${(root.json() as { id: string }).id}/replies`,
      headers: auth(viewer.token),
      payload: { body: 'first level' },
    });
    expect(reply.statusCode).toBe(201);
    const nested = await app.inject({
      method: 'POST',
      url: `/knowledge-bases/${knowledgeBaseId}/notes/${noteId}/annotations/${(reply.json() as { id: string }).id}/replies`,
      headers: auth(viewer.token),
      payload: { body: 'too deep' },
    });
    expect(nested.statusCode).toBe(400);

    const outsiderWrite = await app.inject({
      method: 'POST',
      url: `/knowledge-bases/${knowledgeBaseId}/notes/${noteId}/annotations`,
      headers: auth(outsider.token),
      payload: {
        revisionId,
        kind: 'comment',
        body: 'not allowed',
        anchor: {
          kind: 'text',
          exact: 'nope',
          prefix: '',
          suffix: '',
          startOffset: 0,
          endOffset: 4,
          path: 'body',
        },
      },
    });
    expect(outsiderWrite.statusCode).toBe(404);
  });

  it('requires authentication', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/knowledge-bases/${knowledgeBaseId}/notes/${noteId}/annotations`,
    });
    expect(response.statusCode).toBe(401);
  });
});
