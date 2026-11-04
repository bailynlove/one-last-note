import type { AnnotationStore } from '@oln/application';
import type { Annotation, KnowledgeBaseRole } from '@oln/domain';
import { and, asc, eq, isNull, notExists } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { Database } from '../db/client';
import {
  annotations,
  knowledgeBaseMemberships,
  noteAssociations,
  noteRevisions,
  users,
} from '../db/schema';

type AnnotationRow = typeof annotations.$inferSelect;
type UserRow = typeof users.$inferSelect;

function toAnnotation(row: AnnotationRow, author: UserRow): Annotation {
  return {
    id: row.id,
    knowledgeBaseId: row.knowledgeBaseId,
    noteId: row.noteId,
    revisionId: row.revisionId,
    originalRevisionId: row.originalRevisionId,
    parentId: row.parentId,
    author: {
      id: author.id,
      displayName: author.displayName,
      avatarUrl: author.avatarUrl,
    },
    kind: row.kind === 'mark' ? 'mark' : 'comment',
    markType: row.markType,
    body: row.body,
    anchor: row.anchor,
    needsReview: row.needsReview,
    deleted: row.deletedAt !== null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    replies: [],
  };
}

export function createAnnotationStore(database: Database): AnnotationStore {
  const { db } = database;

  async function findOne(
    knowledgeBaseId: string,
    noteId: string,
    annotationId: string,
  ): Promise<Annotation | null> {
    const [row] = await db
      .select({ annotation: annotations, author: users })
      .from(annotations)
      .innerJoin(users, eq(annotations.authorUserId, users.id))
      .where(
        and(
          eq(annotations.id, annotationId),
          eq(annotations.knowledgeBaseId, knowledgeBaseId),
          eq(annotations.noteId, noteId),
        ),
      )
      .limit(1);
    return row ? toAnnotation(row.annotation, row.author) : null;
  }

  return {
    async findAccess(knowledgeBaseId, noteId, userId) {
      const [row] = await db
        .select({ role: knowledgeBaseMemberships.role })
        .from(knowledgeBaseMemberships)
        .innerJoin(
          noteAssociations,
          and(
            eq(noteAssociations.knowledgeBaseId, knowledgeBaseMemberships.knowledgeBaseId),
            eq(noteAssociations.noteId, noteId),
          ),
        )
        .where(
          and(
            eq(knowledgeBaseMemberships.knowledgeBaseId, knowledgeBaseId),
            eq(knowledgeBaseMemberships.userId, userId),
          ),
        )
        .limit(1);
      return row ? { role: row.role as KnowledgeBaseRole } : null;
    },

    async hasRevision(noteId, revisionId) {
      const [row] = await db
        .select({ id: noteRevisions.id })
        .from(noteRevisions)
        .where(
          and(
            eq(noteRevisions.id, revisionId),
            eq(noteRevisions.noteId, noteId),
            eq(noteRevisions.status, 'ready'),
          ),
        )
        .limit(1);
      return Boolean(row);
    },

    async list(knowledgeBaseId, noteId) {
      const rows = await db
        .select({ annotation: annotations, author: users })
        .from(annotations)
        .innerJoin(users, eq(annotations.authorUserId, users.id))
        .where(
          and(eq(annotations.knowledgeBaseId, knowledgeBaseId), eq(annotations.noteId, noteId)),
        )
        .orderBy(asc(annotations.createdAt))
        .limit(200);
      return rows.map((row) => toAnnotation(row.annotation, row.author));
    },

    find: findOne,

    async create(input) {
      const [row] = await db
        .insert(annotations)
        .values({
          knowledgeBaseId: input.knowledgeBaseId,
          noteId: input.noteId,
          revisionId: input.revisionId,
          originalRevisionId: input.revisionId,
          parentId: input.parentId,
          authorUserId: input.authorUserId,
          kind: input.kind,
          markType: input.markType,
          body: input.body,
          anchor: input.anchor,
          createdAt: input.now,
          updatedAt: input.now,
        })
        .returning({ id: annotations.id });
      if (!row) throw new Error('Annotation insert returned no row.');
      const annotation = await findOne(input.knowledgeBaseId, input.noteId, row.id);
      if (!annotation) throw new Error('Annotation was not found after insert.');
      return annotation;
    },

    async updateBody(knowledgeBaseId, noteId, annotationId, body, now) {
      const [row] = await db
        .update(annotations)
        .set({ body, updatedAt: now })
        .where(
          and(
            eq(annotations.id, annotationId),
            eq(annotations.knowledgeBaseId, knowledgeBaseId),
            eq(annotations.noteId, noteId),
            isNull(annotations.deletedAt),
          ),
        )
        .returning({ id: annotations.id });
      return row ? findOne(knowledgeBaseId, noteId, annotationId) : null;
    },

    async softDelete(knowledgeBaseId, noteId, annotationId, now) {
      await db
        .update(annotations)
        .set({ deletedAt: now, updatedAt: now })
        .where(
          and(
            eq(annotations.id, annotationId),
            eq(annotations.knowledgeBaseId, knowledgeBaseId),
            eq(annotations.noteId, noteId),
          ),
        );
    },

    async hardDeleteIfUnthreaded(knowledgeBaseId, noteId, annotationId) {
      const replies = alias(annotations, 'replies');
      const deleted = await db
        .delete(annotations)
        .where(
          and(
            eq(annotations.id, annotationId),
            eq(annotations.knowledgeBaseId, knowledgeBaseId),
            eq(annotations.noteId, noteId),
            notExists(
              db.select({ id: replies.id }).from(replies).where(eq(replies.parentId, annotationId)),
            ),
          ),
        )
        .returning({ id: annotations.id });
      return deleted.length > 0;
    },
  };
}
