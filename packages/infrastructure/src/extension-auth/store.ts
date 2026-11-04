import type { ExtensionAuthStore } from '@oln/application';
import type { User } from '@oln/domain';
import { and, eq, gt, isNull } from 'drizzle-orm';
import type { Database } from '../db/client';
import { extensionAuthCodes, extensionRefreshTokens, users } from '../db/schema';

type UserRow = typeof users.$inferSelect;

function toUser(row: UserRow): User {
  return {
    id: row.id,
    email: row.email,
    displayName: row.displayName,
    avatarUrl: row.avatarUrl,
    createdAt: row.createdAt.toISOString(),
  };
}

export function createExtensionAuthStore(database: Database): ExtensionAuthStore {
  return {
    async createCode(input) {
      await database.db.insert(extensionAuthCodes).values({
        userId: input.userId,
        codeHash: input.codeHash,
        challenge: input.challenge,
        redirectUri: input.redirectUri,
        expiresAt: input.expiresAt,
        createdAt: input.now,
      });
    },

    async consumeCode(input) {
      const [code] = await database.db
        .update(extensionAuthCodes)
        .set({ consumedAt: input.now })
        .where(
          and(
            eq(extensionAuthCodes.codeHash, input.codeHash),
            isNull(extensionAuthCodes.consumedAt),
            gt(extensionAuthCodes.expiresAt, input.now),
          ),
        )
        .returning({
          userId: extensionAuthCodes.userId,
          challenge: extensionAuthCodes.challenge,
          redirectUri: extensionAuthCodes.redirectUri,
        });
      if (!code) {
        return null;
      }

      const [user] = await database.db
        .select()
        .from(users)
        .where(eq(users.id, code.userId))
        .limit(1);
      return user ? { ...code, user: toUser(user) } : null;
    },

    async revokeRefreshToken(input) {
      await database.db
        .update(extensionRefreshTokens)
        .set({ revokedAt: input.now })
        .where(
          and(
            eq(extensionRefreshTokens.tokenHash, input.tokenHash),
            isNull(extensionRefreshTokens.revokedAt),
          ),
        );
    },

    async createRefreshToken(input) {
      await database.db.insert(extensionRefreshTokens).values({
        userId: input.userId,
        tokenHash: input.tokenHash,
        expiresAt: input.expiresAt,
        createdAt: input.now,
      });
    },

    async rotateRefreshToken(input) {
      return database.db.transaction(async (tx) => {
        const [rotated] = await tx
          .update(extensionRefreshTokens)
          .set({ revokedAt: input.now, lastUsedAt: input.now })
          .where(
            and(
              eq(extensionRefreshTokens.tokenHash, input.oldTokenHash),
              isNull(extensionRefreshTokens.revokedAt),
              gt(extensionRefreshTokens.expiresAt, input.now),
            ),
          )
          .returning({ userId: extensionRefreshTokens.userId });
        if (!rotated) return null;

        const [user] = await tx.select().from(users).where(eq(users.id, rotated.userId)).limit(1);
        if (!user) return null;

        await tx.insert(extensionRefreshTokens).values({
          userId: user.id,
          tokenHash: input.newTokenHash,
          expiresAt: input.expiresAt,
          createdAt: input.now,
        });
        return toUser(user);
      });
    },
  };
}
