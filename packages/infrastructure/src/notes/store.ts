import {
  type AddRevisionInput,
  type AttachAssociationInput,
  type CreateNoteInput,
  type NoteStore,
  QuotaExceededError,
  type StoredRevision,
} from '@oln/application';
import type {
  Note,
  NoteAssociation,
  NoteProcessingState,
  NoteRevision,
  NoteSource,
  NoteSummary,
} from '@oln/domain';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import type { Database } from '../db/client';
import {
  knowledgeBaseMemberships,
  knowledgeBases,
  noteAssociations,
  noteRevisions,
  notes,
} from '../db/schema';

type Transaction = Parameters<Parameters<Database['db']['transaction']>[0]>[0];
type Executor = Database['db'] | Transaction;
type RevisionRow = typeof noteRevisions.$inferSelect;

function toSource(row: typeof notes.$inferSelect): NoteSource | null {
  if (!row.sourceUrl || !row.sourceCanonicalUrl || !row.sourceTitle || !row.capturedAt) {
    return null;
  }
  return {
    url: row.sourceUrl,
    canonicalUrl: row.sourceCanonicalUrl,
    title: row.sourceTitle,
    siteName: row.sourceSiteName,
    capturedAt: row.capturedAt.toISOString(),
  };
}

function toRevision(row: RevisionRow): NoteRevision {
  return {
    id: row.id,
    noteId: row.noteId,
    revisionNumber: row.revisionNumber,
    originalFilename: row.originalFilename,
    mediaType: row.mediaType,
    byteSize: Number(row.byteSize),
    contentHash: row.contentHash,
    status: toStatus(row.status),
    statusDetail: row.statusDetail,
    uploadedByUserId: row.uploadedByUserId,
    createdAt: row.createdAt.toISOString(),
    processedAt: row.processedAt?.toISOString() ?? null,
  };
}

function toStatus(value: string): NoteProcessingState {
  if (value === 'quarantined' || value === 'ready' || value === 'rejected') {
    return value;
  }
  throw new Error(`Unknown Note processing state: ${value}`);
}

async function loadNote(executor: Executor, noteId: string): Promise<Note | null> {
  const [note] = await executor.select().from(notes).where(eq(notes.id, noteId)).limit(1);
  if (!note) {
    return null;
  }

  const associations = await executor
    .select({
      id: noteAssociations.id,
      knowledgeBaseId: noteAssociations.knowledgeBaseId,
      knowledgeBaseName: knowledgeBases.name,
      createdAt: noteAssociations.createdAt,
    })
    .from(noteAssociations)
    .innerJoin(knowledgeBases, eq(noteAssociations.knowledgeBaseId, knowledgeBases.id))
    .where(
      and(
        eq(noteAssociations.noteId, noteId),
        isNull(noteAssociations.trashedAt),
        isNull(knowledgeBases.deletedAt),
      ),
    )
    .orderBy(knowledgeBases.name);

  const revisions = await executor
    .select()
    .from(noteRevisions)
    .where(eq(noteRevisions.noteId, noteId))
    .orderBy(desc(noteRevisions.revisionNumber));

  return {
    id: note.id,
    title: note.title,
    source: toSource(note),
    currentRevisionId: note.currentRevisionId,
    createdByUserId: note.createdByUserId,
    createdAt: note.createdAt.toISOString(),
    updatedAt: note.updatedAt.toISOString(),
    associations: associations.map(
      (row): NoteAssociation => ({
        id: row.id,
        knowledgeBaseId: row.knowledgeBaseId,
        knowledgeBaseName: row.knowledgeBaseName,
        createdAt: row.createdAt.toISOString(),
      }),
    ),
    revisions: revisions.map(toRevision),
  };
}

async function knowledgeBaseIdsForNote(executor: Executor, noteId: string): Promise<string[]> {
  const rows = await executor
    .select({ id: noteAssociations.knowledgeBaseId })
    .from(noteAssociations)
    .where(eq(noteAssociations.noteId, noteId));
  return rows.map((row) => row.id);
}

async function lockQuotaKeys(executor: Executor, knowledgeBaseIds: string[]): Promise<void> {
  for (const id of [...new Set(knowledgeBaseIds)].sort()) {
    await executor.execute(sql`select pg_advisory_xact_lock(hashtext(${`note-quota:${id}`}))`);
  }
}

async function storedBytes(executor: Executor, knowledgeBaseId: string): Promise<number> {
  const [row] = await executor
    .select({ total: sql<string>`coalesce(sum(${noteRevisions.byteSize}), 0)` })
    .from(noteRevisions)
    .innerJoin(noteAssociations, eq(noteAssociations.noteId, noteRevisions.noteId))
    .where(eq(noteAssociations.knowledgeBaseId, knowledgeBaseId));
  return Number(row?.total ?? 0);
}

async function noteBytes(executor: Executor, noteId: string): Promise<number> {
  const [row] = await executor
    .select({ total: sql<string>`coalesce(sum(${noteRevisions.byteSize}), 0)` })
    .from(noteRevisions)
    .where(eq(noteRevisions.noteId, noteId));
  return Number(row?.total ?? 0);
}

async function enforceQuota(
  executor: Executor,
  knowledgeBaseIds: string[],
  additionalBytes: number,
  quotaBytes: number,
): Promise<void> {
  for (const id of knowledgeBaseIds) {
    if ((await storedBytes(executor, id)) + additionalBytes > quotaBytes) {
      throw new QuotaExceededError();
    }
  }
}

function insertRevisionValues(input: {
  revisionId: string;
  noteId: string;
  revisionNumber: number;
  userId: string;
  originalFilename: string;
  mediaType: string;
  byteSize: number;
  contentHash: string;
  storageKey: string;
  status: NoteProcessingState;
  statusDetail: string | null;
  now: Date;
}) {
  return {
    id: input.revisionId,
    noteId: input.noteId,
    revisionNumber: input.revisionNumber,
    originalFilename: input.originalFilename,
    mediaType: input.mediaType,
    byteSize: input.byteSize,
    contentHash: input.contentHash,
    storageKey: input.storageKey,
    status: input.status,
    statusDetail: input.statusDetail,
    uploadedByUserId: input.userId,
    createdAt: input.now,
    processedAt: input.status === 'quarantined' ? null : input.now,
  };
}

export function createNoteStore(database: Database): NoteStore {
  return {
    async findRole(knowledgeBaseId, userId) {
      const [row] = await database.db
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
      if (!row) {
        return null;
      }
      if (row.role === 'owner' || row.role === 'manager' || row.role === 'viewer') {
        return row.role;
      }
      throw new Error(`Unknown Knowledge Base role: ${row.role}`);
    },

    findNote(noteId) {
      return loadNote(database.db, noteId);
    },

    async listNotes(knowledgeBaseId) {
      const rows = await database.db
        .select({ noteId: noteAssociations.noteId })
        .from(noteAssociations)
        .innerJoin(notes, eq(noteAssociations.noteId, notes.id))
        .innerJoin(knowledgeBases, eq(knowledgeBases.id, noteAssociations.knowledgeBaseId))
        .where(
          and(
            eq(noteAssociations.knowledgeBaseId, knowledgeBaseId),
            isNull(noteAssociations.trashedAt),
            isNull(knowledgeBases.deletedAt),
          ),
        )
        .orderBy(desc(notes.updatedAt));

      const loaded = await Promise.all(rows.map((row) => loadNote(database.db, row.noteId)));
      return loaded
        .filter((note): note is Note => note !== null)
        .map(
          (note): NoteSummary => ({
            id: note.id,
            title: note.title,
            source: note.source,
            currentRevisionId: note.currentRevisionId,
            latestRevision: note.revisions[0] ?? null,
            associationCount: note.associations.length,
            createdAt: note.createdAt,
            updatedAt: note.updatedAt,
          }),
        );
    },

    async findRevision(revisionId) {
      const [row] = await database.db
        .select()
        .from(noteRevisions)
        .where(eq(noteRevisions.id, revisionId))
        .limit(1);
      if (!row) {
        return null;
      }
      return { ...toRevision(row), storageKey: row.storageKey } satisfies StoredRevision;
    },

    async createNote(input: CreateNoteInput) {
      return database.db.transaction(async (tx) => {
        await lockQuotaKeys(tx, input.knowledgeBaseIds);
        await enforceQuota(tx, input.knowledgeBaseIds, input.byteSize, input.quotaBytes);
        await tx.insert(notes).values({
          id: input.noteId,
          title: input.title,
          sourceUrl: input.source?.url,
          sourceCanonicalUrl: input.source?.canonicalUrl,
          sourceTitle: input.source?.title,
          sourceSiteName: input.source?.siteName,
          capturedAt: input.source ? new Date(input.source.capturedAt) : undefined,
          createdByUserId: input.userId,
          createdAt: input.now,
          updatedAt: input.now,
        });
        await tx.insert(noteRevisions).values(
          insertRevisionValues({
            revisionId: input.revisionId,
            noteId: input.noteId,
            revisionNumber: 1,
            userId: input.userId,
            originalFilename: input.originalFilename,
            mediaType: input.mediaType,
            byteSize: input.byteSize,
            contentHash: input.contentHash,
            storageKey: input.storageKey,
            status: input.status,
            statusDetail: input.statusDetail,
            now: input.now,
          }),
        );
        if (input.status === 'ready') {
          await tx
            .update(notes)
            .set({ currentRevisionId: input.revisionId })
            .where(eq(notes.id, input.noteId));
        }
        await tx.insert(noteAssociations).values(
          input.knowledgeBaseIds.map((knowledgeBaseId) => ({
            noteId: input.noteId,
            knowledgeBaseId,
            createdByUserId: input.userId,
            createdAt: input.now,
          })),
        );

        const note = await loadNote(tx, input.noteId);
        if (!note) {
          throw new Error('Note insert returned no row');
        }
        return note;
      });
    },

    async addRevision(input: AddRevisionInput) {
      return database.db.transaction(async (tx) => {
        const [note] = await tx
          .select()
          .from(notes)
          .where(eq(notes.id, input.noteId))
          .for('update')
          .limit(1);
        if (!note) {
          throw new Error('Note not found');
        }
        const associated = await knowledgeBaseIdsForNote(tx, input.noteId);
        await lockQuotaKeys(tx, associated);
        await enforceQuota(tx, associated, input.byteSize, input.quotaBytes);

        const [latest] = await tx
          .select({ revisionNumber: noteRevisions.revisionNumber })
          .from(noteRevisions)
          .where(eq(noteRevisions.noteId, input.noteId))
          .orderBy(desc(noteRevisions.revisionNumber))
          .limit(1);

        await tx.insert(noteRevisions).values(
          insertRevisionValues({
            revisionId: input.revisionId,
            noteId: input.noteId,
            revisionNumber: (latest?.revisionNumber ?? 0) + 1,
            userId: input.userId,
            originalFilename: input.originalFilename,
            mediaType: input.mediaType,
            byteSize: input.byteSize,
            contentHash: input.contentHash,
            storageKey: input.storageKey,
            status: input.status,
            statusDetail: input.statusDetail,
            now: input.now,
          }),
        );

        const updated = await loadNote(tx, input.noteId);
        if (!updated) {
          throw new Error('Note not found after revision insert');
        }
        return updated;
      });
    },

    async attachAssociation(input: AttachAssociationInput) {
      await database.db.transaction(async (tx) => {
        const [note] = await tx
          .select()
          .from(notes)
          .where(eq(notes.id, input.noteId))
          .for('update')
          .limit(1);
        if (!note) {
          throw new Error('Note not found');
        }

        await lockQuotaKeys(tx, [input.knowledgeBaseId]);
        await enforceQuota(
          tx,
          [input.knowledgeBaseId],
          await noteBytes(tx, input.noteId),
          input.quotaBytes,
        );

        await tx
          .insert(noteAssociations)
          .values({
            noteId: input.noteId,
            knowledgeBaseId: input.knowledgeBaseId,
            createdByUserId: input.userId,
            createdAt: input.now,
          })
          .onConflictDoUpdate({
            target: [noteAssociations.noteId, noteAssociations.knowledgeBaseId],
            set: { trashedAt: null, purgeAfter: null, trashedByUserId: null },
          });
        await tx.update(notes).set({ updatedAt: input.now }).where(eq(notes.id, input.noteId));
      });
    },

    async updateTitle(noteId, title, now) {
      const [row] = await database.db
        .update(notes)
        .set({ title, updatedAt: now })
        .where(eq(notes.id, noteId))
        .returning({ id: notes.id });
      return row ? loadNote(database.db, noteId) : null;
    },

    async completeRevision(input) {
      await database.db.transaction(async (tx) => {
        const [revision] = await tx
          .select()
          .from(noteRevisions)
          .where(eq(noteRevisions.id, input.revisionId))
          .limit(1);
        if (!revision) {
          return;
        }

        await tx
          .update(noteRevisions)
          .set({
            status: input.status,
            statusDetail: input.statusDetail,
            processedAt: input.now,
          })
          .where(eq(noteRevisions.id, input.revisionId));

        if (input.status !== 'ready') {
          return;
        }

        const [note] = await tx
          .select()
          .from(notes)
          .where(eq(notes.id, revision.noteId))
          .for('update')
          .limit(1);
        if (!note) {
          return;
        }
        let currentNumber = 0;
        if (note.currentRevisionId) {
          const [current] = await tx
            .select({ revisionNumber: noteRevisions.revisionNumber })
            .from(noteRevisions)
            .where(eq(noteRevisions.id, note.currentRevisionId))
            .limit(1);
          currentNumber = current?.revisionNumber ?? 0;
        }
        if (revision.revisionNumber > currentNumber) {
          await tx
            .update(notes)
            .set({ currentRevisionId: revision.id, updatedAt: input.now })
            .where(eq(notes.id, revision.noteId));
        }
      });
    },
  };
}
