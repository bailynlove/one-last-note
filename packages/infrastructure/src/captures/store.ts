import type {
  CaptureAttemptPatch,
  CaptureStore,
  CreateCaptureAttemptInput,
} from '@oln/application';
import { CaptureLimitError } from '@oln/application';
import {
  CAPTURE_ACTIVE_LIMIT,
  CAPTURE_RATE_LIMIT,
  CAPTURE_RATE_WINDOW_MS,
  type CaptureAttempt,
  type CaptureDuplicate,
  type CaptureStatus,
  isCaptureStatus,
} from '@oln/domain';
import { and, count, eq, gt, inArray, isNull, ne, or, sql } from 'drizzle-orm';
import type { Database } from '../db/client';
import {
  captureAttempts,
  knowledgeBaseMemberships,
  knowledgeBases,
  noteAssociations,
  notes,
} from '../db/schema';

function toStatus(value: string): CaptureStatus {
  if (!isCaptureStatus(value)) throw new Error(`Unknown capture status: ${value}`);
  return value;
}

function toAttempt(row: typeof captureAttempts.$inferSelect): CaptureAttempt {
  return {
    id: row.id,
    knowledgeBaseId: row.knowledgeBaseId,
    userId: row.userId,
    url: row.url,
    canonicalUrl: row.canonicalUrl,
    selectionHtml: row.selectionHtml,
    selectionText: row.selectionText,
    status: toStatus(row.status),
    noteId: row.noteId,
    revisionId: row.revisionId,
    duplicateOf: row.duplicateNoteId
      ? { noteId: row.duplicateNoteId, title: row.duplicateTitle ?? 'Untitled' }
      : null,
    errorCode: row.errorCode,
    errorDetail: row.errorDetail,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    completedAt: row.completedAt?.toISOString() ?? null,
  };
}

export function createCaptureStore(database: Database): CaptureStore {
  return {
    async findRole(knowledgeBaseId, userId) {
      const [row] = await database.db
        .select({ role: knowledgeBaseMemberships.role })
        .from(knowledgeBaseMemberships)
        .innerJoin(knowledgeBases, eq(knowledgeBaseMemberships.knowledgeBaseId, knowledgeBases.id))
        .where(
          and(
            eq(knowledgeBaseMemberships.knowledgeBaseId, knowledgeBaseId),
            eq(knowledgeBaseMemberships.userId, userId),
            isNull(knowledgeBases.deletedAt),
          ),
        )
        .limit(1);
      return row?.role === 'owner' || row?.role === 'manager' || row?.role === 'viewer'
        ? row.role
        : null;
    },

    async findAttempt(id) {
      const [row] = await database.db
        .select()
        .from(captureAttempts)
        .where(eq(captureAttempts.id, id))
        .limit(1);
      return row ? toAttempt(row) : null;
    },

    async findAttemptByKey(userId, knowledgeBaseId, key) {
      const [row] = await database.db
        .select()
        .from(captureAttempts)
        .where(
          and(
            eq(captureAttempts.userId, userId),
            eq(captureAttempts.knowledgeBaseId, knowledgeBaseId),
            eq(captureAttempts.idempotencyKey, key),
          ),
        )
        .limit(1);
      return row ? toAttempt(row) : null;
    },

    async findDuplicate(knowledgeBaseId, canonicalUrl, excludeNoteId) {
      const [row] = await database.db
        .select({ noteId: notes.id, title: notes.title })
        .from(notes)
        .innerJoin(noteAssociations, eq(noteAssociations.noteId, notes.id))
        .where(
          and(
            eq(noteAssociations.knowledgeBaseId, knowledgeBaseId),
            isNull(noteAssociations.trashedAt),
            or(eq(notes.sourceUrl, canonicalUrl), eq(notes.sourceCanonicalUrl, canonicalUrl)),
            excludeNoteId ? ne(notes.id, excludeNoteId) : undefined,
          ),
        )
        .limit(1);
      return row ? ({ noteId: row.noteId, title: row.title } satisfies CaptureDuplicate) : null;
    },

    async createAttempt(input: CreateCaptureAttemptInput) {
      return database.db.transaction(async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`capture:${input.userId}`}))`);
        if (input.idempotencyKey) {
          const [existing] = await tx
            .select()
            .from(captureAttempts)
            .where(
              and(
                eq(captureAttempts.userId, input.userId),
                eq(captureAttempts.knowledgeBaseId, input.knowledgeBaseId),
                eq(captureAttempts.idempotencyKey, input.idempotencyKey),
              ),
            )
            .limit(1);
          if (existing) return toAttempt(existing);
        }
        const windowStart = new Date(input.now.getTime() - CAPTURE_RATE_WINDOW_MS);
        const [rate] = await tx
          .select({ value: count() })
          .from(captureAttempts)
          .where(
            and(
              eq(captureAttempts.userId, input.userId),
              gt(captureAttempts.createdAt, windowStart),
            ),
          );
        if (Number(rate?.value ?? 0) >= CAPTURE_RATE_LIMIT) {
          throw new CaptureLimitError('rate');
        }
        const [active] = await tx
          .select({ value: count() })
          .from(captureAttempts)
          .where(
            and(
              eq(captureAttempts.userId, input.userId),
              inArray(captureAttempts.status, ['queued', 'processing']),
            ),
          );
        if (Number(active?.value ?? 0) >= CAPTURE_ACTIVE_LIMIT) {
          throw new CaptureLimitError('active');
        }

        const [row] = await tx
          .insert(captureAttempts)
          .values({
            knowledgeBaseId: input.knowledgeBaseId,
            userId: input.userId,
            url: input.url,
            canonicalUrl: input.canonicalUrl,
            selectionHtml: input.selectionHtml,
            selectionText: input.selectionText,
            status: 'queued',
            duplicateNoteId: input.duplicateOf?.noteId ?? null,
            duplicateTitle: input.duplicateOf?.title ?? null,
            idempotencyKey: input.idempotencyKey,
            createdAt: input.now,
            updatedAt: input.now,
          })
          .returning();
        if (!row) throw new Error('Capture attempt insert returned no row');
        return toAttempt(row);
      });
    },

    async claimAttempt(id, now) {
      const [row] = await database.db
        .update(captureAttempts)
        .set({ status: 'processing', updatedAt: now })
        .where(
          and(
            eq(captureAttempts.id, id),
            isNull(captureAttempts.noteId),
            inArray(captureAttempts.status, ['queued', 'failed']),
          ),
        )
        .returning();
      return row ? toAttempt(row) : null;
    },

    async failAttempt(id, code, detail, now) {
      await database.db
        .update(captureAttempts)
        .set({ status: 'failed', errorCode: code, errorDetail: detail, updatedAt: now })
        .where(
          and(
            eq(captureAttempts.id, id),
            isNull(captureAttempts.noteId),
            inArray(captureAttempts.status, ['queued', 'processing']),
          ),
        );
    },

    async setMediaKeys(id, keys) {
      await database.db
        .update(captureAttempts)
        .set({ mediaKeys: keys })
        .where(eq(captureAttempts.id, id));
    },

    async listMediaKeys(id) {
      const [row] = await database.db
        .select({ keys: captureAttempts.mediaKeys })
        .from(captureAttempts)
        .where(eq(captureAttempts.id, id))
        .limit(1);
      return row?.keys ?? [];
    },

    async updateAttempt(id, patch: CaptureAttemptPatch) {
      const [row] = await database.db
        .update(captureAttempts)
        .set({
          ...(patch.status === undefined ? {} : { status: patch.status }),
          ...(patch.canonicalUrl === undefined ? {} : { canonicalUrl: patch.canonicalUrl }),
          ...(patch.noteId === undefined ? {} : { noteId: patch.noteId }),
          ...(patch.revisionId === undefined ? {} : { revisionId: patch.revisionId }),
          ...(patch.duplicateOf === undefined
            ? {}
            : {
                duplicateNoteId: patch.duplicateOf?.noteId ?? null,
                duplicateTitle: patch.duplicateOf?.title ?? null,
              }),
          ...(patch.errorCode === undefined ? {} : { errorCode: patch.errorCode }),
          ...(patch.errorDetail === undefined ? {} : { errorDetail: patch.errorDetail }),
          ...(patch.completedAt === undefined ? {} : { completedAt: patch.completedAt }),
          updatedAt: patch.updatedAt,
        })
        .where(eq(captureAttempts.id, id))
        .returning();
      return row ? toAttempt(row) : null;
    },
  };
}
