import type { RetentionResult, RetentionStore } from '@oln/application';
import type { RetentionPolicy } from '@oln/domain';
import { and, inArray, isNotNull, lt } from 'drizzle-orm';
import type { Database } from '../db/client';
import {
  agentTokens,
  auditEvents,
  captureAttempts,
  magicLinkTokens,
  noteRevisions,
  sessions,
} from '../db/schema';

export function createRetentionStore(database: Database): RetentionStore {
  return {
    async purge(now, policy: RetentionPolicy, deleteObjects): Promise<RetentionResult> {
      const auditBefore = new Date(now.getTime() - policy.auditDays * 86_400_000);
      const acceptedBefore = new Date(now.getTime() - policy.captureAcceptedDays * 86_400_000);
      const failedBefore = new Date(now.getTime() - policy.captureFailedDays * 86_400_000);
      return database.db.transaction(async (tx) => {
        const rejectedRows = await tx
          .delete(noteRevisions)
          .where(
            and(
              inArray(noteRevisions.status, ['rejected']),
              lt(noteRevisions.createdAt, failedBefore),
            ),
          )
          .returning({ storageKey: noteRevisions.storageKey });

        const failedCaptures = await tx
          .delete(captureAttempts)
          .where(
            and(
              inArray(captureAttempts.status, ['failed']),
              lt(captureAttempts.createdAt, failedBefore),
            ),
          )
          .returning({ mediaKeys: captureAttempts.mediaKeys });

        const acceptedCaptureMetadata = await tx
          .update(captureAttempts)
          .set({ selectionHtml: null, selectionText: null, errorCode: null, errorDetail: null })
          .where(
            and(isNotNull(captureAttempts.noteId), lt(captureAttempts.createdAt, acceptedBefore)),
          )
          .returning({ id: captureAttempts.id });

        const deletedSessions = await tx
          .delete(sessions)
          .where(lt(sessions.expiresAt, now))
          .returning({ id: sessions.id });

        const deletedTokens = await tx
          .delete(agentTokens)
          .where(lt(agentTokens.expiresAt, now))
          .returning({ id: agentTokens.id });

        const deletedLinks = await tx
          .delete(magicLinkTokens)
          .where(lt(magicLinkTokens.expiresAt, new Date(now.getTime() - 7 * 86_400_000)))
          .returning({ id: magicLinkTokens.id });

        const deletedAudit = await tx
          .delete(auditEvents)
          .where(lt(auditEvents.createdAt, auditBefore))
          .returning({ id: auditEvents.id });

        const keys = [
          ...rejectedRows.map((row) => row.storageKey),
          ...failedCaptures.flatMap((row) =>
            Array.isArray(row.mediaKeys)
              ? row.mediaKeys.filter((key): key is string => typeof key === 'string')
              : [],
          ),
        ];
        if (keys.length > 0) await deleteObjects(keys);

        return {
          auditEvents: deletedAudit.length,
          failedCaptures: failedCaptures.length,
          acceptedCaptureMetadata: acceptedCaptureMetadata.length,
          rejectedRevisions: rejectedRows.length,
          sessions: deletedSessions.length,
          agentTokens: deletedTokens.length,
          magicLinks: deletedLinks.length,
        };
      });
    },
  };
}
