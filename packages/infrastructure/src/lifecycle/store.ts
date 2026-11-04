import type { LifecycleStore } from '@oln/application';
import type { DeletedKnowledgeBase, PurgeResult, TrashedAssociation } from '@oln/domain';
import { and, count, eq, inArray, isNotNull, isNull, lte, notExists, sql } from 'drizzle-orm';
import type { Database } from '../db/client';
import {
  annotations,
  auditEvents,
  captureAttempts,
  joinLinks,
  knowledgeBaseInvitations,
  knowledgeBaseMemberships,
  knowledgeBases,
  noteAssociations,
  noteRevisions,
  notes,
} from '../db/schema';

type Transaction = Parameters<Parameters<Database['db']['transaction']>[0]>[0];
type Executor = Database['db'] | Transaction;

async function roleFor(
  executor: Executor,
  userId: string,
  knowledgeBaseId: string,
): Promise<string | null> {
  const [row] = await executor
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
  return row?.role ?? null;
}

async function audit(
  executor: Executor,
  action: string,
  subjectType: string,
  subjectId: string,
  actorUserId: string | null,
  metadata: Record<string, unknown>,
): Promise<void> {
  await executor.insert(auditEvents).values({
    actorUserId,
    action,
    subjectType,
    subjectId,
    metadata,
  });
}

function toTrashed(row: {
  noteId: string;
  noteTitle: string;
  knowledgeBaseId: string;
  knowledgeBaseName: string;
  trashedAt: Date | null;
  purgeAfter: Date | null;
}): TrashedAssociation {
  return {
    noteId: row.noteId,
    noteTitle: row.noteTitle,
    knowledgeBaseId: row.knowledgeBaseId,
    knowledgeBaseName: row.knowledgeBaseName,
    trashedAt: (row.trashedAt ?? new Date()).toISOString(),
    purgeAfter: (row.purgeAfter ?? new Date()).toISOString(),
  };
}

function toDeleted(row: {
  id: string;
  name: string;
  deletedAt: Date | null;
  purgeAfter: Date | null;
  noteCount: number;
}): DeletedKnowledgeBase {
  return {
    id: row.id,
    name: row.name,
    deletedAt: (row.deletedAt ?? new Date()).toISOString(),
    purgeAfter: (row.purgeAfter ?? new Date()).toISOString(),
    noteCount: Number(row.noteCount),
  };
}

export function createLifecycleStore(database: Database): LifecycleStore {
  return {
    async trashAssociation(userId, noteId, knowledgeBaseId, now, purgeAfter) {
      return database.db.transaction(async (tx) => {
        const role = await roleFor(tx, userId, knowledgeBaseId);
        if (role !== 'owner' && role !== 'manager') return null;
        const [row] = await tx
          .update(noteAssociations)
          .set({ trashedAt: now, purgeAfter, trashedByUserId: userId })
          .where(
            and(
              eq(noteAssociations.noteId, noteId),
              eq(noteAssociations.knowledgeBaseId, knowledgeBaseId),
              isNull(noteAssociations.trashedAt),
            ),
          )
          .returning({
            noteId: noteAssociations.noteId,
            knowledgeBaseId: noteAssociations.knowledgeBaseId,
            trashedAt: noteAssociations.trashedAt,
            purgeAfter: noteAssociations.purgeAfter,
          });
        if (!row) return null;
        const [note] = await tx
          .select({ title: notes.title })
          .from(notes)
          .where(eq(notes.id, noteId))
          .limit(1);
        const [knowledgeBase] = await tx
          .select({ name: knowledgeBases.name })
          .from(knowledgeBases)
          .where(eq(knowledgeBases.id, knowledgeBaseId))
          .limit(1);
        await audit(
          tx,
          'association.trash',
          'note_association',
          `${knowledgeBaseId}:${noteId}`,
          userId,
          {
            noteId,
            knowledgeBaseId,
            purgeAfter: purgeAfter.toISOString(),
          },
        );
        return toTrashed({
          ...row,
          noteTitle: note?.title ?? 'Untitled Note',
          knowledgeBaseName: knowledgeBase?.name ?? 'Knowledge Base',
        });
      });
    },

    async restoreAssociation(userId, noteId, knowledgeBaseId, now) {
      return database.db.transaction(async (tx) => {
        const role = await roleFor(tx, userId, knowledgeBaseId);
        if (role !== 'owner' && role !== 'manager') return null;
        const [row] = await tx
          .update(noteAssociations)
          .set({ trashedAt: null, purgeAfter: null, trashedByUserId: null })
          .where(
            and(
              eq(noteAssociations.noteId, noteId),
              eq(noteAssociations.knowledgeBaseId, knowledgeBaseId),
              isNotNull(noteAssociations.trashedAt),
              isNotNull(noteAssociations.purgeAfter),
              sql`${noteAssociations.purgeAfter} > ${now}`,
            ),
          )
          .returning({
            noteId: noteAssociations.noteId,
            knowledgeBaseId: noteAssociations.knowledgeBaseId,
            trashedAt: noteAssociations.trashedAt,
            purgeAfter: noteAssociations.purgeAfter,
          });
        if (!row) return null;
        const [note] = await tx
          .select({ title: notes.title })
          .from(notes)
          .where(eq(notes.id, noteId))
          .limit(1);
        const [knowledgeBase] = await tx
          .select({ name: knowledgeBases.name })
          .from(knowledgeBases)
          .where(eq(knowledgeBases.id, knowledgeBaseId))
          .limit(1);
        await audit(
          tx,
          'association.restore',
          'note_association',
          `${knowledgeBaseId}:${noteId}`,
          userId,
          {
            noteId,
            knowledgeBaseId,
          },
        );
        return toTrashed({
          ...row,
          trashedAt: row.trashedAt ?? now,
          purgeAfter: row.purgeAfter ?? now,
          noteTitle: note?.title ?? 'Untitled Note',
          knowledgeBaseName: knowledgeBase?.name ?? 'Knowledge Base',
        });
      });
    },

    async listAssociationTrash(userId, knowledgeBaseId) {
      const role = await roleFor(database.db, userId, knowledgeBaseId);
      if (role !== 'owner' && role !== 'manager') return null;
      const rows = await database.db
        .select({
          noteId: noteAssociations.noteId,
          noteTitle: notes.title,
          knowledgeBaseId: noteAssociations.knowledgeBaseId,
          knowledgeBaseName: knowledgeBases.name,
          trashedAt: noteAssociations.trashedAt,
          purgeAfter: noteAssociations.purgeAfter,
        })
        .from(noteAssociations)
        .innerJoin(notes, eq(notes.id, noteAssociations.noteId))
        .innerJoin(knowledgeBases, eq(knowledgeBases.id, noteAssociations.knowledgeBaseId))
        .where(
          and(
            eq(noteAssociations.knowledgeBaseId, knowledgeBaseId),
            isNotNull(noteAssociations.trashedAt),
          ),
        )
        .orderBy(noteAssociations.purgeAfter);
      return rows.map(toTrashed);
    },

    async deleteKnowledgeBase(userId, knowledgeBaseId, now, purgeAfter) {
      return database.db.transaction(async (tx) => {
        const role = await roleFor(tx, userId, knowledgeBaseId);
        if (role !== 'owner') return null;
        const [row] = await tx
          .update(knowledgeBases)
          .set({ deletedAt: now, purgeAfter, deletedByUserId: userId })
          .where(and(eq(knowledgeBases.id, knowledgeBaseId), isNull(knowledgeBases.deletedAt)))
          .returning({
            id: knowledgeBases.id,
            name: knowledgeBases.name,
            deletedAt: knowledgeBases.deletedAt,
            purgeAfter: knowledgeBases.purgeAfter,
          });
        if (!row) return null;
        await tx
          .update(knowledgeBaseInvitations)
          .set({ revokedAt: now })
          .where(
            and(
              eq(knowledgeBaseInvitations.knowledgeBaseId, knowledgeBaseId),
              isNull(knowledgeBaseInvitations.revokedAt),
            ),
          );
        await tx
          .update(joinLinks)
          .set({ revokedAt: now })
          .where(and(eq(joinLinks.knowledgeBaseId, knowledgeBaseId), isNull(joinLinks.revokedAt)));
        const [notesCount] = await tx
          .select({ value: count() })
          .from(noteAssociations)
          .where(eq(noteAssociations.knowledgeBaseId, knowledgeBaseId));
        await audit(tx, 'knowledge_base.trash', 'knowledge_base', knowledgeBaseId, userId, {
          purgeAfter: purgeAfter.toISOString(),
        });
        return toDeleted({ ...row, noteCount: notesCount?.value ?? 0 });
      });
    },

    async restoreKnowledgeBase(userId, knowledgeBaseId, now) {
      return database.db.transaction(async (tx) => {
        const [membership] = await tx
          .select({ role: knowledgeBaseMemberships.role })
          .from(knowledgeBaseMemberships)
          .where(
            and(
              eq(knowledgeBaseMemberships.knowledgeBaseId, knowledgeBaseId),
              eq(knowledgeBaseMemberships.userId, userId),
            ),
          )
          .limit(1);
        if (membership?.role !== 'owner') return null;
        const [row] = await tx
          .update(knowledgeBases)
          .set({ deletedAt: null, purgeAfter: null, deletedByUserId: null })
          .where(
            and(
              eq(knowledgeBases.id, knowledgeBaseId),
              isNotNull(knowledgeBases.deletedAt),
              isNotNull(knowledgeBases.purgeAfter),
              sql`${knowledgeBases.purgeAfter} > ${now}`,
            ),
          )
          .returning({
            id: knowledgeBases.id,
            name: knowledgeBases.name,
            deletedAt: knowledgeBases.deletedAt,
            purgeAfter: knowledgeBases.purgeAfter,
          });
        if (!row) return null;
        const [notesCount] = await tx
          .select({ value: count() })
          .from(noteAssociations)
          .where(eq(noteAssociations.knowledgeBaseId, knowledgeBaseId));
        await audit(tx, 'knowledge_base.restore', 'knowledge_base', knowledgeBaseId, userId, {});
        return toDeleted({
          ...row,
          deletedAt: row.deletedAt ?? now,
          purgeAfter: row.purgeAfter ?? now,
          noteCount: notesCount?.value ?? 0,
        });
      });
    },

    async listDeletedKnowledgeBases(userId) {
      const rows = await database.db
        .select({
          id: knowledgeBases.id,
          name: knowledgeBases.name,
          deletedAt: knowledgeBases.deletedAt,
          purgeAfter: knowledgeBases.purgeAfter,
          noteCount: count(noteAssociations.id),
        })
        .from(knowledgeBases)
        .innerJoin(
          knowledgeBaseMemberships,
          and(
            eq(knowledgeBaseMemberships.knowledgeBaseId, knowledgeBases.id),
            eq(knowledgeBaseMemberships.userId, userId),
            eq(knowledgeBaseMemberships.role, 'owner'),
          ),
        )
        .leftJoin(noteAssociations, eq(noteAssociations.knowledgeBaseId, knowledgeBases.id))
        .where(isNotNull(knowledgeBases.deletedAt))
        .groupBy(
          knowledgeBases.id,
          knowledgeBases.name,
          knowledgeBases.deletedAt,
          knowledgeBases.purgeAfter,
        )
        .orderBy(knowledgeBases.purgeAfter);
      return rows.map((row) =>
        toDeleted({
          ...row,
          deletedAt: row.deletedAt ?? new Date(),
          purgeAfter: row.purgeAfter ?? new Date(),
          noteCount: Number(row.noteCount),
        }),
      );
    },

    async purgeDue(now, deleteObjects) {
      return database.db.transaction(async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext('lifecycle-purge'))`);
        const dueKbs = await tx
          .select({ id: knowledgeBases.id, name: knowledgeBases.name })
          .from(knowledgeBases)
          .where(
            and(
              isNotNull(knowledgeBases.deletedAt),
              isNotNull(knowledgeBases.purgeAfter),
              lte(knowledgeBases.purgeAfter, now),
            ),
          );
        const dueAssociations = await tx
          .select({
            noteId: noteAssociations.noteId,
            knowledgeBaseId: noteAssociations.knowledgeBaseId,
          })
          .from(noteAssociations)
          .where(
            and(
              isNotNull(noteAssociations.trashedAt),
              isNotNull(noteAssociations.purgeAfter),
              lte(noteAssociations.purgeAfter, now),
            ),
          );
        const captureKeys: string[] = [];
        if (dueKbs.length > 0) {
          const rows = await tx
            .select({ keys: captureAttempts.mediaKeys })
            .from(captureAttempts)
            .where(
              inArray(
                captureAttempts.knowledgeBaseId,
                dueKbs.map((row) => row.id),
              ),
            );
          for (const row of rows) captureKeys.push(...row.keys);
        }
        const affectedNotes = new Set<string>(dueAssociations.map((row) => row.noteId));
        for (const kb of dueKbs) {
          const rows = await tx
            .select({ noteId: noteAssociations.noteId })
            .from(noteAssociations)
            .where(eq(noteAssociations.knowledgeBaseId, kb.id));
          for (const row of rows) affectedNotes.add(row.noteId);
        }
        if (dueKbs.length > 0) {
          await tx.delete(knowledgeBases).where(
            inArray(
              knowledgeBases.id,
              dueKbs.map((row) => row.id),
            ),
          );
        }
        const associationKbIds = [...new Set(dueAssociations.map((row) => row.knowledgeBaseId))];
        if (associationKbIds.length > 0) {
          await tx
            .delete(annotations)
            .where(
              and(
                inArray(annotations.noteId, [...new Set(dueAssociations.map((row) => row.noteId))]),
                inArray(annotations.knowledgeBaseId, associationKbIds),
              ),
            );
          for (const row of dueAssociations) {
            await tx
              .delete(noteAssociations)
              .where(
                and(
                  eq(noteAssociations.noteId, row.noteId),
                  eq(noteAssociations.knowledgeBaseId, row.knowledgeBaseId),
                ),
              );
          }
        }
        const orphanRows = await tx
          .select({ id: notes.id })
          .from(notes)
          .where(
            notExists(
              tx
                .select({ id: noteAssociations.id })
                .from(noteAssociations)
                .where(eq(noteAssociations.noteId, notes.id)),
            ),
          );
        const orphanIds = orphanRows.map((row) => row.id);
        const objectRows =
          orphanIds.length > 0
            ? await tx
                .select({ storageKey: noteRevisions.storageKey })
                .from(noteRevisions)
                .where(inArray(noteRevisions.noteId, orphanIds))
            : [];
        if (orphanIds.length > 0) {
          const rows = await tx
            .select({ keys: captureAttempts.mediaKeys })
            .from(captureAttempts)
            .where(inArray(captureAttempts.noteId, orphanIds));
          for (const row of rows) captureKeys.push(...row.keys);
        }
        const keys = [...objectRows.map((row) => row.storageKey), ...captureKeys];
        if (keys.length > 0) {
          await deleteObjects(keys);
        }
        if (orphanIds.length > 0) {
          await tx
            .update(captureAttempts)
            .set({ mediaKeys: [] })
            .where(inArray(captureAttempts.noteId, orphanIds));
          await tx.delete(notes).where(inArray(notes.id, orphanIds));
        }
        for (const kb of dueKbs) {
          await audit(tx, 'knowledge_base.purge', 'knowledge_base', kb.id, null, { name: kb.name });
        }
        for (const row of dueAssociations) {
          await audit(
            tx,
            'association.purge',
            'note_association',
            `${row.knowledgeBaseId}:${row.noteId}`,
            null,
            row,
          );
        }
        for (const id of orphanIds) {
          await audit(tx, 'note.purge', 'note', id, null, {});
        }
        return {
          knowledgeBases: dueKbs.length,
          associations: dueAssociations.length,
          notes: orphanIds.length,
          objects: keys.length,
        } satisfies PurgeResult;
      });
    },
  };
}
