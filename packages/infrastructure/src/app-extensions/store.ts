import type {
  AppExtensionInstallation,
  AppExtensionManifest,
  KnowledgeBaseRole,
} from '@oln/domain';
import { and, asc, desc, eq, isNull } from 'drizzle-orm';
import type { Database } from '../db/client';
import { appExtensions, knowledgeBaseMemberships, knowledgeBases } from '../db/schema';

function map(row: typeof appExtensions.$inferSelect): AppExtensionInstallation {
  return {
    id: row.id,
    knowledgeBaseId: row.knowledgeBaseId,
    extensionId: row.extensionId,
    name: row.name,
    version: row.version,
    apiVersion: row.apiVersion,
    publisher: row.publisher,
    packageHash: row.packageHash,
    source: row.source,
    manifest: row.manifest,
    files: row.files,
    enabled: row.enabled,
    installedByUserId: row.installedByUserId,
    createdAt: row.createdAt.toISOString(),
  };
}

export function createAppExtensionStore(database: Database) {
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

    async list(knowledgeBaseId: string): Promise<AppExtensionInstallation[]> {
      const rows = await db
        .select()
        .from(appExtensions)
        .where(eq(appExtensions.knowledgeBaseId, knowledgeBaseId))
        .orderBy(desc(appExtensions.enabled), asc(appExtensions.name), asc(appExtensions.version));
      return rows.map(map);
    },

    async find(
      knowledgeBaseId: string,
      installationId: string,
    ): Promise<AppExtensionInstallation | null> {
      const [row] = await db
        .select()
        .from(appExtensions)
        .where(
          and(
            eq(appExtensions.knowledgeBaseId, knowledgeBaseId),
            eq(appExtensions.id, installationId),
          ),
        )
        .limit(1);
      return row ? map(row) : null;
    },

    async install(input: {
      knowledgeBaseId: string;
      manifest: AppExtensionManifest;
      files: Record<string, string>;
      packageHash: string;
      source: string;
      userId: string;
      now: Date;
    }): Promise<AppExtensionInstallation> {
      const [row] = await db
        .insert(appExtensions)
        .values({
          knowledgeBaseId: input.knowledgeBaseId,
          extensionId: input.manifest.id,
          name: input.manifest.name,
          version: input.manifest.version,
          apiVersion: input.manifest.apiVersion,
          publisher: input.manifest.publisher,
          packageHash: input.packageHash,
          source: input.source,
          manifest: input.manifest,
          files: input.files,
          installedByUserId: input.userId,
          createdAt: input.now,
        })
        .returning();
      if (!row) throw new Error('App Extension install failed');
      return map(row);
    },

    async setEnabled(
      knowledgeBaseId: string,
      installationId: string,
      enabled: boolean,
    ): Promise<AppExtensionInstallation | null> {
      return db.transaction(async (tx) => {
        const [target] = await tx
          .select()
          .from(appExtensions)
          .where(
            and(
              eq(appExtensions.knowledgeBaseId, knowledgeBaseId),
              eq(appExtensions.id, installationId),
            ),
          )
          .limit(1);
        if (!target) return null;
        if (enabled) {
          await tx
            .update(appExtensions)
            .set({ enabled: false })
            .where(
              and(
                eq(appExtensions.knowledgeBaseId, knowledgeBaseId),
                eq(appExtensions.extensionId, target.extensionId),
                eq(appExtensions.enabled, true),
              ),
            );
        }
        const [row] = await tx
          .update(appExtensions)
          .set({ enabled })
          .where(eq(appExtensions.id, installationId))
          .returning();
        return row ? map(row) : null;
      });
    },

    async remove(knowledgeBaseId: string, installationId: string): Promise<boolean> {
      const [row] = await db
        .delete(appExtensions)
        .where(
          and(
            eq(appExtensions.knowledgeBaseId, knowledgeBaseId),
            eq(appExtensions.id, installationId),
          ),
        )
        .returning({ id: appExtensions.id });
      return Boolean(row);
    },
  };
}
