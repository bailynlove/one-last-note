import type { KnowledgeBaseRole, NoteRelation, RelationNote, RelationType } from '@oln/domain';
import { and, asc, count, eq, inArray, isNull } from 'drizzle-orm';
import type { Database } from '../db/client';
import {
  knowledgeBaseMemberships,
  knowledgeBases,
  noteAssociations,
  noteRelations,
  noteRevisions,
  notes,
  users,
} from '../db/schema';

export function createRelationStore(database: Database) {
  const { db } = database;
  return {
    async findAccess(knowledgeBaseId: string, userId: string): Promise<KnowledgeBaseRole | null> {
      const [row] = await db
        .select({ role: knowledgeBaseMemberships.role })
        .from(knowledgeBaseMemberships)
        .innerJoin(knowledgeBases, eq(knowledgeBases.id, knowledgeBaseMemberships.knowledgeBaseId))
        .where(
          and(
            eq(knowledgeBaseMemberships.knowledgeBaseId, knowledgeBaseId),
            eq(knowledgeBaseMemberships.userId, userId),
            isNull(knowledgeBases.deletedAt),
          ),
        )
        .limit(1);
      return (row?.role as KnowledgeBaseRole | undefined) ?? null;
    },

    async listNotes(knowledgeBaseId: string, revision?: string): Promise<RelationNote[]> {
      const rows = await db
        .select({
          id: notes.id,
          title: notes.title,
          currentRevisionId: notes.currentRevisionId,
        })
        .from(noteAssociations)
        .innerJoin(notes, eq(notes.id, noteAssociations.noteId))
        .innerJoin(knowledgeBases, eq(knowledgeBases.id, noteAssociations.knowledgeBaseId))
        .where(
          and(
            eq(noteAssociations.knowledgeBaseId, knowledgeBaseId),
            isNull(noteAssociations.trashedAt),
            isNull(knowledgeBases.deletedAt),
          ),
        )
        .orderBy(asc(notes.title), asc(notes.id))
        .limit(200);
      if (rows.length === 0) return [];
      const revisionFilter =
        revision && revision !== 'all'
          ? revision === 'current'
            ? inArray(
                noteRevisions.id,
                rows.map((row) => row.currentRevisionId).filter((id): id is string => Boolean(id)),
              )
            : eq(noteRevisions.id, revision)
          : undefined;
      const revisions = await db
        .select({
          id: noteRevisions.id,
          noteId: noteRevisions.noteId,
          number: noteRevisions.revisionNumber,
        })
        .from(noteRevisions)
        .where(
          and(
            inArray(
              noteRevisions.noteId,
              rows.map((row) => row.id),
            ),
            eq(noteRevisions.status, 'ready'),
            revisionFilter,
          ),
        )
        .orderBy(asc(noteRevisions.revisionNumber));
      const byNote = new Map<string, { id: string; number: number }[]>();
      for (const revision of revisions) {
        const list = byNote.get(revision.noteId) ?? [];
        list.push({ id: revision.id, number: revision.number });
        byNote.set(revision.noteId, list);
      }
      return rows.map((row) => ({
        ...row,
        revisions: (byNote.get(row.id) ?? []).reverse(),
      }));
    },

    async countNotes(knowledgeBaseId: string): Promise<number> {
      const [row] = await db
        .select({ count: count() })
        .from(noteAssociations)
        .innerJoin(notes, eq(notes.id, noteAssociations.noteId))
        .innerJoin(knowledgeBases, eq(knowledgeBases.id, noteAssociations.knowledgeBaseId))
        .where(
          and(
            eq(noteAssociations.knowledgeBaseId, knowledgeBaseId),
            isNull(noteAssociations.trashedAt),
            isNull(knowledgeBases.deletedAt),
          ),
        );
      return row?.count ?? 0;
    },

    async listRelations(knowledgeBaseId: string): Promise<NoteRelation[]> {
      const rows = await db
        .select({
          id: noteRelations.id,
          knowledgeBaseId: noteRelations.knowledgeBaseId,
          sourceNoteId: noteRelations.sourceNoteId,
          targetNoteId: noteRelations.targetNoteId,
          type: noteRelations.type,
          createdAt: noteRelations.createdAt,
          createdByUserId: noteRelations.createdByUserId,
          displayName: users.displayName,
        })
        .from(noteRelations)
        .innerJoin(users, eq(users.id, noteRelations.createdByUserId))
        .where(eq(noteRelations.knowledgeBaseId, knowledgeBaseId))
        .orderBy(asc(noteRelations.createdAt), asc(noteRelations.id))
        .limit(500);
      return rows.map((row) => ({
        id: row.id,
        knowledgeBaseId: row.knowledgeBaseId,
        type: row.type as RelationType,
        origin: 'manual',
        sourceNoteId: row.sourceNoteId,
        targetNoteId: row.targetNoteId,
        createdByUserId: row.createdByUserId,
        createdByDisplayName: row.displayName,
        createdAt: row.createdAt.toISOString(),
      }));
    },

    async countRelations(knowledgeBaseId: string): Promise<number> {
      const [row] = await db
        .select({ count: count() })
        .from(noteRelations)
        .where(eq(noteRelations.knowledgeBaseId, knowledgeBaseId));
      return row?.count ?? 0;
    },

    async create(input: {
      knowledgeBaseId: string;
      sourceNoteId: string;
      targetNoteId: string;
      type: RelationType;
      pairKey: string;
      userId: string;
      now: Date;
    }): Promise<NoteRelation> {
      const [row] = await db
        .insert(noteRelations)
        .values({
          knowledgeBaseId: input.knowledgeBaseId,
          sourceNoteId: input.sourceNoteId,
          targetNoteId: input.targetNoteId,
          type: input.type,
          pairKey: input.pairKey,
          createdByUserId: input.userId,
          createdAt: input.now,
        })
        .returning();
      if (!row) throw new Error('Relation insert returned no row');
      const [author] = await db
        .select({ displayName: users.displayName })
        .from(users)
        .where(eq(users.id, input.userId))
        .limit(1);
      return {
        id: row.id,
        knowledgeBaseId: row.knowledgeBaseId,
        type: row.type as RelationType,
        origin: 'manual',
        sourceNoteId: row.sourceNoteId,
        targetNoteId: row.targetNoteId,
        createdByUserId: row.createdByUserId,
        createdByDisplayName: author?.displayName ?? input.userId,
        createdAt: row.createdAt.toISOString(),
      };
    },

    async remove(knowledgeBaseId: string, relationId: string): Promise<boolean> {
      const rows = await db
        .delete(noteRelations)
        .where(
          and(eq(noteRelations.id, relationId), eq(noteRelations.knowledgeBaseId, knowledgeBaseId)),
        )
        .returning({ id: noteRelations.id });
      return rows.length > 0;
    },
  };
}
