import type { AuthStore, GoogleIdentity, SessionContext } from '@oln/application';
import { normalizeEmail, type User } from '@oln/domain';
import { and, eq, gt, isNull } from 'drizzle-orm';
import type { Database } from '../db/client';
import { authIdentities, magicLinkTokens, sessions, users } from '../db/schema';

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

export function createAuthStore(database: Database): AuthStore {
  return {
    async findOrCreateUserByEmail(input, now) {
      const [row] = await database.db
        .insert(users)
        .values({
          email: normalizeEmail(input.email),
          displayName: input.displayName,
          avatarUrl: input.avatarUrl ?? null,
          emailVerifiedAt: now,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: users.email,
          set: { updatedAt: now },
        })
        .returning();

      if (!row) {
        throw new Error('User upsert returned no row');
      }

      return toUser(row);
    },

    async findOrCreateGoogleUser(identity: GoogleIdentity, now) {
      return database.db.transaction(async (tx) => {
        const [existing] = await tx
          .select({ user: users })
          .from(authIdentities)
          .innerJoin(users, eq(authIdentities.userId, users.id))
          .where(
            and(
              eq(authIdentities.provider, 'google'),
              eq(authIdentities.providerAccountId, identity.providerAccountId),
            ),
          )
          .limit(1);

        if (existing) {
          return toUser(existing.user);
        }

        const email = normalizeEmail(identity.email);
        const [user] = await tx
          .insert(users)
          .values({
            email,
            displayName: identity.displayName,
            avatarUrl: identity.avatarUrl,
            emailVerifiedAt: now,
            createdAt: now,
            updatedAt: now,
          })
          .onConflictDoUpdate({
            target: users.email,
            set: { updatedAt: now },
          })
          .returning();

        if (!user) {
          throw new Error('User upsert returned no row');
        }

        const linked = await tx
          .insert(authIdentities)
          .values({
            userId: user.id,
            provider: 'google',
            providerAccountId: identity.providerAccountId,
            email,
            createdAt: now,
          })
          .onConflictDoNothing()
          .returning({ id: authIdentities.id });

        if (linked.length === 0) {
          const [owner] = await tx
            .select({ user: users })
            .from(authIdentities)
            .innerJoin(users, eq(authIdentities.userId, users.id))
            .where(
              and(
                eq(authIdentities.provider, 'google'),
                eq(authIdentities.providerAccountId, identity.providerAccountId),
              ),
            )
            .limit(1);

          if (owner) {
            return toUser(owner.user);
          }
        }

        return toUser(user);
      });
    },

    async createMagicLink(input) {
      await database.db.insert(magicLinkTokens).values({
        email: normalizeEmail(input.email),
        tokenHash: input.tokenHash,
        expiresAt: input.expiresAt,
        createdAt: input.now,
      });
    },

    async consumeMagicLink(input) {
      const [row] = await database.db
        .update(magicLinkTokens)
        .set({ consumedAt: input.now })
        .where(
          and(
            eq(magicLinkTokens.tokenHash, input.tokenHash),
            isNull(magicLinkTokens.consumedAt),
            gt(magicLinkTokens.expiresAt, input.now),
          ),
        )
        .returning({ email: magicLinkTokens.email });

      return row?.email ?? null;
    },

    async createSession(input) {
      await database.db.insert(sessions).values({
        userId: input.userId,
        tokenHash: input.tokenHash,
        expiresAt: input.expiresAt,
        createdAt: input.createdAt,
        lastSeenAt: input.createdAt,
        userAgent: input.userAgent,
        ip: input.ip,
      });
    },

    async findSession(input): Promise<SessionContext | null> {
      const [row] = await database.db
        .select({ sessionId: sessions.id, user: users })
        .from(sessions)
        .innerJoin(users, eq(sessions.userId, users.id))
        .where(
          and(
            eq(sessions.tokenHash, input.tokenHash),
            isNull(sessions.revokedAt),
            gt(sessions.expiresAt, input.now),
          ),
        )
        .limit(1);

      if (!row) {
        return null;
      }

      return { sessionId: row.sessionId, user: toUser(row.user) };
    },

    async revokeSession(input) {
      await database.db
        .update(sessions)
        .set({ revokedAt: input.now })
        .where(and(eq(sessions.tokenHash, input.tokenHash), isNull(sessions.revokedAt)));
    },
  };
}
