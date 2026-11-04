import type { AgentTokenRecord, AgentTokenStore } from '@oln/application';
import type { AgentTokenScope } from '@oln/domain';
import { and, eq, isNull } from 'drizzle-orm';
import type { Database } from '../db/client';
import { agentTokens, auditEvents, users } from '../db/schema';

function map(
  row: typeof agentTokens.$inferSelect & {
    userEmail?: string;
    userDisplayName?: string;
    userAvatarUrl?: string | null;
  },
): AgentTokenRecord {
  return {
    id: row.id,
    userId: row.userId,
    name: row.name,
    prefix: row.prefix,
    scopes: row.scopes as AgentTokenScope[],
    expiresAt: row.expiresAt.toISOString(),
    revokedAt: row.revokedAt?.toISOString() ?? null,
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    ...(row.userEmail === undefined ? {} : { userEmail: row.userEmail }),
    ...(row.userDisplayName === undefined ? {} : { userDisplayName: row.userDisplayName }),
    ...(row.userAvatarUrl === undefined ? {} : { userAvatarUrl: row.userAvatarUrl }),
  };
}

export function createAgentTokenStore(database: Database): AgentTokenStore {
  const db = database.db;
  return {
    async create(input) {
      const [row] = await db
        .insert(agentTokens)
        .values({
          userId: input.userId,
          name: input.name,
          tokenHash: input.tokenHash,
          prefix: input.prefix,
          scopes: input.scopes,
          expiresAt: input.expiresAt,
          createdAt: input.now,
        })
        .returning();
      if (!row) throw new Error('Failed to create Agent token.');
      return map(row);
    },
    async list(userId) {
      const rows = await db
        .select()
        .from(agentTokens)
        .where(eq(agentTokens.userId, userId))
        .orderBy(agentTokens.createdAt);
      return rows.map(map);
    },
    async revoke(userId, id, now) {
      const rows = await db
        .update(agentTokens)
        .set({ revokedAt: now })
        .where(
          and(
            eq(agentTokens.id, id),
            eq(agentTokens.userId, userId),
            isNull(agentTokens.revokedAt),
          ),
        )
        .returning({ id: agentTokens.id });
      return rows.length > 0;
    },
    async findByHash(tokenHash) {
      const [row] = await db
        .select({
          token: agentTokens,
          email: users.email,
          displayName: users.displayName,
          avatarUrl: users.avatarUrl,
        })
        .from(agentTokens)
        .innerJoin(users, eq(users.id, agentTokens.userId))
        .where(eq(agentTokens.tokenHash, tokenHash))
        .limit(1);
      return row
        ? map({
            ...row.token,
            userEmail: row.email,
            userDisplayName: row.displayName,
            userAvatarUrl: row.avatarUrl,
          })
        : null;
    },
    async touch(id, now) {
      await db.update(agentTokens).set({ lastUsedAt: now }).where(eq(agentTokens.id, id));
    },
    async audit(input) {
      await db.insert(auditEvents).values({
        actorUserId: input.userId,
        action: `agent.${input.action}`,
        subjectType: input.subjectType,
        subjectId: input.subjectId,
        metadata: {
          tokenId: input.tokenId,
          agentName: input.agentName,
          tool: input.tool,
        },
      });
    },
  };
}
