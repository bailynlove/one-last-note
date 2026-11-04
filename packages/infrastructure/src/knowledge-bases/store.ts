import type {
  KnowledgeBaseStore,
  StoredInvitation,
  StoredJoinLink,
  StoredOwnershipTransfer,
} from '@oln/application';
import { PendingInvitationError } from '@oln/application';
import type {
  KnowledgeBase as DomainKnowledgeBase,
  InvitableRole,
  Invitation,
  JoinLink,
  KnowledgeBaseRole,
  KnowledgeBaseSummary,
  Member,
  OwnershipTransfer,
  User,
} from '@oln/domain';
import { and, desc, eq, gt, isNull, ne, sql } from 'drizzle-orm';
import type { Database } from '../db/client';
import {
  joinLinks,
  knowledgeBaseInvitations,
  knowledgeBaseMemberships,
  knowledgeBases,
  ownershipTransfers,
  users,
} from '../db/schema';

type KnowledgeBaseRow = typeof knowledgeBases.$inferSelect;
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

function toKnowledgeBase(row: KnowledgeBaseRow): DomainKnowledgeBase {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    ownerId: row.ownerId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toRole(value: string): KnowledgeBaseRole {
  if (value === 'owner' || value === 'manager' || value === 'viewer') {
    return value;
  }
  throw new Error(`Unknown Knowledge Base role: ${value}`);
}

function toInvitableRole(value: string): InvitableRole {
  if (value === 'manager' || value === 'viewer') {
    return value;
  }
  throw new Error(`Unknown invitation role: ${value}`);
}

function toMember(row: {
  userId: string;
  email: string;
  displayName: string;
  avatarUrl: string | null;
  role: string;
  createdAt: Date;
}): Member {
  return {
    userId: row.userId,
    email: row.email,
    displayName: row.displayName,
    avatarUrl: row.avatarUrl,
    role: toRole(row.role),
    joinedAt: row.createdAt.toISOString(),
  };
}

function toInvitation(row: typeof knowledgeBaseInvitations.$inferSelect): Invitation {
  return {
    id: row.id,
    email: row.email,
    role: toInvitableRole(row.role),
    expiresAt: row.expiresAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
  };
}

function toJoinLink(row: typeof joinLinks.$inferSelect): JoinLink {
  return {
    id: row.id,
    role: toInvitableRole(row.role),
    expiresAt: row.expiresAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
  };
}

function toStoredInvitation(row: {
  invitation: typeof knowledgeBaseInvitations.$inferSelect;
  knowledgeBaseName: string;
}): StoredInvitation {
  const invite = row.invitation;
  return {
    ...toInvitation(invite),
    knowledgeBaseId: invite.knowledgeBaseId,
    knowledgeBaseName: row.knowledgeBaseName,
    expiresAt: invite.expiresAt,
    acceptedAt: invite.acceptedAt,
    revokedAt: invite.revokedAt,
    createdAt: invite.createdAt,
  };
}

function toStoredJoinLink(row: {
  link: typeof joinLinks.$inferSelect;
  knowledgeBaseName: string;
}): StoredJoinLink {
  const link = row.link;
  return {
    ...toJoinLink(link),
    knowledgeBaseId: link.knowledgeBaseId,
    knowledgeBaseName: row.knowledgeBaseName,
    expiresAt: link.expiresAt,
    revokedAt: link.revokedAt,
    createdAt: link.createdAt,
  };
}

function toTransfer(row: typeof ownershipTransfers.$inferSelect): OwnershipTransfer {
  return {
    id: row.id,
    fromUserId: row.fromUserId,
    toUserId: row.toUserId,
    expiresAt: row.expiresAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
  };
}

function toStoredTransfer(row: typeof ownershipTransfers.$inferSelect): StoredOwnershipTransfer {
  return {
    ...toTransfer(row),
    knowledgeBaseId: row.knowledgeBaseId,
    expiresAt: row.expiresAt,
    createdAt: row.createdAt,
    acceptedAt: row.acceptedAt,
    cancelledAt: row.cancelledAt,
  };
}

export function createKnowledgeBaseStore(database: Database): KnowledgeBaseStore {
  return {
    async createKnowledgeBase(input) {
      return database.db.transaction(async (tx) => {
        const [row] = await tx
          .insert(knowledgeBases)
          .values({
            name: input.name,
            description: input.description,
            ownerId: input.ownerId,
            createdAt: input.now,
            updatedAt: input.now,
          })
          .returning();
        if (!row) {
          throw new Error('Knowledge Base insert returned no row');
        }

        await tx.insert(knowledgeBaseMemberships).values({
          knowledgeBaseId: row.id,
          userId: input.ownerId,
          role: 'owner',
          createdAt: input.now,
        });

        return toKnowledgeBase(row);
      });
    },

    async findAccess(knowledgeBaseId, userId) {
      const [row] = await database.db
        .select({ knowledgeBase: knowledgeBases, role: knowledgeBaseMemberships.role })
        .from(knowledgeBaseMemberships)
        .innerJoin(knowledgeBases, eq(knowledgeBaseMemberships.knowledgeBaseId, knowledgeBases.id))
        .where(
          and(
            eq(knowledgeBaseMemberships.knowledgeBaseId, knowledgeBaseId),
            eq(knowledgeBaseMemberships.userId, userId),
          ),
        )
        .limit(1);

      if (!row) {
        return null;
      }
      return { knowledgeBase: toKnowledgeBase(row.knowledgeBase), role: toRole(row.role) };
    },

    async listForUser(userId) {
      const rows = await database.db
        .select({ knowledgeBase: knowledgeBases, role: knowledgeBaseMemberships.role })
        .from(knowledgeBaseMemberships)
        .innerJoin(knowledgeBases, eq(knowledgeBaseMemberships.knowledgeBaseId, knowledgeBases.id))
        .where(eq(knowledgeBaseMemberships.userId, userId))
        .orderBy(knowledgeBases.name);

      return rows.map(
        (row): KnowledgeBaseSummary => ({
          ...toKnowledgeBase(row.knowledgeBase),
          role: toRole(row.role),
        }),
      );
    },

    async updateKnowledgeBase(knowledgeBaseId, input, now) {
      const [row] = await database.db
        .update(knowledgeBases)
        .set({
          ...(input.name === undefined ? {} : { name: input.name }),
          ...(input.description === undefined ? {} : { description: input.description }),
          updatedAt: now,
        })
        .where(eq(knowledgeBases.id, knowledgeBaseId))
        .returning();
      return row ? toKnowledgeBase(row) : null;
    },

    async listMembers(knowledgeBaseId) {
      const rows = await database.db
        .select({
          userId: users.id,
          email: users.email,
          displayName: users.displayName,
          avatarUrl: users.avatarUrl,
          role: knowledgeBaseMemberships.role,
          createdAt: knowledgeBaseMemberships.createdAt,
        })
        .from(knowledgeBaseMemberships)
        .innerJoin(users, eq(knowledgeBaseMemberships.userId, users.id))
        .where(eq(knowledgeBaseMemberships.knowledgeBaseId, knowledgeBaseId))
        .orderBy(knowledgeBaseMemberships.createdAt);

      return rows.map(toMember);
    },

    async findMember(knowledgeBaseId, userId) {
      const [row] = await database.db
        .select({
          userId: users.id,
          email: users.email,
          displayName: users.displayName,
          avatarUrl: users.avatarUrl,
          role: knowledgeBaseMemberships.role,
          createdAt: knowledgeBaseMemberships.createdAt,
        })
        .from(knowledgeBaseMemberships)
        .innerJoin(users, eq(knowledgeBaseMemberships.userId, users.id))
        .where(
          and(
            eq(knowledgeBaseMemberships.knowledgeBaseId, knowledgeBaseId),
            eq(knowledgeBaseMemberships.userId, userId),
          ),
        )
        .limit(1);
      return row ? toMember(row) : null;
    },

    async findUserByEmail(email) {
      const [row] = await database.db.select().from(users).where(eq(users.email, email)).limit(1);
      return row ? toUser(row) : null;
    },

    async createInvitation(input) {
      return database.db.transaction(async (tx) => {
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtext(${`${input.knowledgeBaseId}:${input.email}`}))`,
        );
        const [pending] = await tx
          .select({ id: knowledgeBaseInvitations.id })
          .from(knowledgeBaseInvitations)
          .where(
            and(
              eq(knowledgeBaseInvitations.knowledgeBaseId, input.knowledgeBaseId),
              eq(knowledgeBaseInvitations.email, input.email),
              isNull(knowledgeBaseInvitations.acceptedAt),
              isNull(knowledgeBaseInvitations.revokedAt),
              gt(knowledgeBaseInvitations.expiresAt, input.now),
              input.replacesInvitationId
                ? ne(knowledgeBaseInvitations.id, input.replacesInvitationId)
                : sql`true`,
            ),
          )
          .limit(1);
        if (pending) {
          throw new PendingInvitationError();
        }
        const [row] = await tx
          .insert(knowledgeBaseInvitations)
          .values({
            knowledgeBaseId: input.knowledgeBaseId,
            email: input.email,
            role: input.role,
            tokenHash: input.tokenHash,
            invitedByUserId: input.invitedByUserId,
            expiresAt: input.expiresAt,
            createdAt: input.now,
          })
          .returning();
        if (!row) {
          throw new Error('Invitation insert returned no row');
        }
        return toInvitation(row);
      });
    },

    async findPendingInvitation(knowledgeBaseId, email) {
      const [row] = await database.db
        .select()
        .from(knowledgeBaseInvitations)
        .where(
          and(
            eq(knowledgeBaseInvitations.knowledgeBaseId, knowledgeBaseId),
            eq(knowledgeBaseInvitations.email, email),
            isNull(knowledgeBaseInvitations.acceptedAt),
            isNull(knowledgeBaseInvitations.revokedAt),
            gt(knowledgeBaseInvitations.expiresAt, new Date()),
          ),
        )
        .limit(1);
      return row ? toInvitation(row) : null;
    },

    async findInvitationByHash(tokenHash) {
      const [row] = await database.db
        .select({ invitation: knowledgeBaseInvitations, knowledgeBaseName: knowledgeBases.name })
        .from(knowledgeBaseInvitations)
        .innerJoin(knowledgeBases, eq(knowledgeBaseInvitations.knowledgeBaseId, knowledgeBases.id))
        .where(eq(knowledgeBaseInvitations.tokenHash, tokenHash))
        .limit(1);
      return row ? toStoredInvitation(row) : null;
    },

    async listInvitations(knowledgeBaseId) {
      const rows = await database.db
        .select()
        .from(knowledgeBaseInvitations)
        .where(
          and(
            eq(knowledgeBaseInvitations.knowledgeBaseId, knowledgeBaseId),
            isNull(knowledgeBaseInvitations.acceptedAt),
            isNull(knowledgeBaseInvitations.revokedAt),
            gt(knowledgeBaseInvitations.expiresAt, new Date()),
          ),
        )
        .orderBy(knowledgeBaseInvitations.createdAt);
      return rows.map(toInvitation);
    },

    async revokeInvitation(invitationId, knowledgeBaseId, now) {
      await database.db
        .update(knowledgeBaseInvitations)
        .set({ revokedAt: now })
        .where(
          and(
            eq(knowledgeBaseInvitations.id, invitationId),
            eq(knowledgeBaseInvitations.knowledgeBaseId, knowledgeBaseId),
            isNull(knowledgeBaseInvitations.acceptedAt),
          ),
        );
    },

    async acceptInvitation(input) {
      return database.db.transaction(async (tx) => {
        const [invitation] = await tx
          .select()
          .from(knowledgeBaseInvitations)
          .where(
            and(
              eq(knowledgeBaseInvitations.id, input.invitationId),
              eq(knowledgeBaseInvitations.knowledgeBaseId, input.knowledgeBaseId),
              isNull(knowledgeBaseInvitations.acceptedAt),
              isNull(knowledgeBaseInvitations.revokedAt),
              gt(knowledgeBaseInvitations.expiresAt, input.now),
            ),
          )
          .for('update')
          .limit(1);
        if (!invitation) {
          return null;
        }

        await tx
          .update(knowledgeBaseInvitations)
          .set({ acceptedAt: input.now })
          .where(eq(knowledgeBaseInvitations.id, input.invitationId));
        await tx
          .insert(knowledgeBaseMemberships)
          .values({
            knowledgeBaseId: input.knowledgeBaseId,
            userId: input.userId,
            role: input.role,
            createdAt: input.now,
          })
          .onConflictDoNothing();
        if (input.role === 'manager') {
          await tx
            .update(knowledgeBaseMemberships)
            .set({ role: 'manager' })
            .where(
              and(
                eq(knowledgeBaseMemberships.knowledgeBaseId, input.knowledgeBaseId),
                eq(knowledgeBaseMemberships.userId, input.userId),
                eq(knowledgeBaseMemberships.role, 'viewer'),
              ),
            );
        }

        const [row] = await tx
          .select()
          .from(knowledgeBases)
          .where(eq(knowledgeBases.id, input.knowledgeBaseId))
          .limit(1);
        return row ? toKnowledgeBase(row) : null;
      });
    },

    async createJoinLink(input) {
      const [row] = await database.db
        .insert(joinLinks)
        .values({
          knowledgeBaseId: input.knowledgeBaseId,
          role: input.role,
          tokenHash: input.tokenHash,
          createdByUserId: input.createdByUserId,
          expiresAt: input.expiresAt,
          createdAt: input.now,
        })
        .returning();
      if (!row) {
        throw new Error('Join link insert returned no row');
      }
      return toJoinLink(row);
    },

    async findJoinLinkByHash(tokenHash) {
      const [row] = await database.db
        .select({ link: joinLinks, knowledgeBaseName: knowledgeBases.name })
        .from(joinLinks)
        .innerJoin(knowledgeBases, eq(joinLinks.knowledgeBaseId, knowledgeBases.id))
        .where(eq(joinLinks.tokenHash, tokenHash))
        .limit(1);
      return row ? toStoredJoinLink(row) : null;
    },

    async listJoinLinks(knowledgeBaseId) {
      const rows = await database.db
        .select()
        .from(joinLinks)
        .where(and(eq(joinLinks.knowledgeBaseId, knowledgeBaseId), isNull(joinLinks.revokedAt)))
        .orderBy(joinLinks.createdAt);
      return rows.map(toJoinLink);
    },

    async revokeJoinLink(joinLinkId, knowledgeBaseId, now) {
      await database.db
        .update(joinLinks)
        .set({ revokedAt: now })
        .where(and(eq(joinLinks.id, joinLinkId), eq(joinLinks.knowledgeBaseId, knowledgeBaseId)));
    },

    async acceptJoinLink(input) {
      return database.db.transaction(async (tx) => {
        const [link] = await tx
          .select()
          .from(joinLinks)
          .where(
            and(
              eq(joinLinks.id, input.joinLinkId),
              eq(joinLinks.knowledgeBaseId, input.knowledgeBaseId),
              isNull(joinLinks.revokedAt),
              gt(joinLinks.expiresAt, input.now),
            ),
          )
          .for('update')
          .limit(1);
        if (!link) {
          return null;
        }

        await tx
          .insert(knowledgeBaseMemberships)
          .values({
            knowledgeBaseId: input.knowledgeBaseId,
            userId: input.userId,
            role: input.role,
            createdAt: input.now,
          })
          .onConflictDoNothing();
        if (input.role === 'manager') {
          await tx
            .update(knowledgeBaseMemberships)
            .set({ role: 'manager' })
            .where(
              and(
                eq(knowledgeBaseMemberships.knowledgeBaseId, input.knowledgeBaseId),
                eq(knowledgeBaseMemberships.userId, input.userId),
                eq(knowledgeBaseMemberships.role, 'viewer'),
              ),
            );
        }

        const [row] = await tx
          .select()
          .from(knowledgeBases)
          .where(eq(knowledgeBases.id, input.knowledgeBaseId))
          .limit(1);
        return row ? toKnowledgeBase(row) : null;
      });
    },

    async updateMemberRole(input) {
      await database.db
        .update(knowledgeBaseMemberships)
        .set({ role: input.role })
        .where(
          and(
            eq(knowledgeBaseMemberships.knowledgeBaseId, input.knowledgeBaseId),
            eq(knowledgeBaseMemberships.userId, input.userId),
            sql`${knowledgeBaseMemberships.role} <> 'owner'`,
          ),
        );
    },

    async removeMember(knowledgeBaseId, userId, allowedRole) {
      const conditions = [
        eq(knowledgeBaseMemberships.knowledgeBaseId, knowledgeBaseId),
        eq(knowledgeBaseMemberships.userId, userId),
        sql`${knowledgeBaseMemberships.role} <> 'owner'`,
      ];
      if (allowedRole) {
        conditions.push(eq(knowledgeBaseMemberships.role, allowedRole));
      }
      await database.db.delete(knowledgeBaseMemberships).where(and(...conditions));
    },

    async createOwnershipTransfer(input) {
      return database.db.transaction(async (tx) => {
        await tx
          .update(ownershipTransfers)
          .set({ cancelledAt: input.now })
          .where(
            and(
              eq(ownershipTransfers.knowledgeBaseId, input.knowledgeBaseId),
              isNull(ownershipTransfers.acceptedAt),
              isNull(ownershipTransfers.cancelledAt),
            ),
          );

        const [row] = await tx
          .insert(ownershipTransfers)
          .values({
            knowledgeBaseId: input.knowledgeBaseId,
            fromUserId: input.fromUserId,
            toUserId: input.toUserId,
            expiresAt: input.expiresAt,
            createdAt: input.now,
          })
          .returning();
        if (!row) {
          throw new Error('Ownership transfer insert returned no row');
        }
        return toTransfer(row);
      });
    },

    async findPendingOwnershipTransfer(knowledgeBaseId) {
      const [row] = await database.db
        .select()
        .from(ownershipTransfers)
        .where(
          and(
            eq(ownershipTransfers.knowledgeBaseId, knowledgeBaseId),
            isNull(ownershipTransfers.acceptedAt),
            isNull(ownershipTransfers.cancelledAt),
            gt(ownershipTransfers.expiresAt, new Date()),
          ),
        )
        .orderBy(desc(ownershipTransfers.createdAt))
        .limit(1);
      return row ? toTransfer(row) : null;
    },

    async findOwnershipTransfer(transferId) {
      const [row] = await database.db
        .select()
        .from(ownershipTransfers)
        .where(eq(ownershipTransfers.id, transferId))
        .limit(1);
      return row ? toStoredTransfer(row) : null;
    },

    async acceptOwnershipTransfer(input) {
      return database.db.transaction(async (tx) => {
        const [transfer] = await tx
          .select()
          .from(ownershipTransfers)
          .where(
            and(
              eq(ownershipTransfers.id, input.transferId),
              eq(ownershipTransfers.toUserId, input.toUserId),
              isNull(ownershipTransfers.acceptedAt),
              isNull(ownershipTransfers.cancelledAt),
              gt(ownershipTransfers.expiresAt, input.now),
            ),
          )
          .for('update')
          .limit(1);
        if (!transfer) {
          return null;
        }

        const [knowledgeBase] = await tx
          .select()
          .from(knowledgeBases)
          .where(eq(knowledgeBases.id, transfer.knowledgeBaseId))
          .for('update')
          .limit(1);
        if (!knowledgeBase || knowledgeBase.ownerId !== transfer.fromUserId) {
          return null;
        }

        const [target] = await tx
          .select()
          .from(knowledgeBaseMemberships)
          .where(
            and(
              eq(knowledgeBaseMemberships.knowledgeBaseId, transfer.knowledgeBaseId),
              eq(knowledgeBaseMemberships.userId, transfer.toUserId),
            ),
          )
          .for('update')
          .limit(1);
        if (target?.role !== 'manager') {
          return null;
        }

        const demoted = await tx
          .update(knowledgeBaseMemberships)
          .set({ role: 'manager' })
          .where(
            and(
              eq(knowledgeBaseMemberships.knowledgeBaseId, transfer.knowledgeBaseId),
              eq(knowledgeBaseMemberships.userId, transfer.fromUserId),
              eq(knowledgeBaseMemberships.role, 'owner'),
            ),
          )
          .returning({ id: knowledgeBaseMemberships.id });
        if (demoted.length === 0) {
          throw new Error('Ownership changed concurrently');
        }
        const promoted = await tx
          .update(knowledgeBaseMemberships)
          .set({ role: 'owner' })
          .where(
            and(
              eq(knowledgeBaseMemberships.knowledgeBaseId, transfer.knowledgeBaseId),
              eq(knowledgeBaseMemberships.userId, transfer.toUserId),
            ),
          )
          .returning({ id: knowledgeBaseMemberships.id });
        if (promoted.length === 0) {
          throw new Error('Ownership changed concurrently');
        }
        const [updated] = await tx
          .update(knowledgeBases)
          .set({ ownerId: transfer.toUserId, updatedAt: input.now })
          .where(eq(knowledgeBases.id, transfer.knowledgeBaseId))
          .returning();
        await tx
          .update(ownershipTransfers)
          .set({ acceptedAt: input.now })
          .where(eq(ownershipTransfers.id, transfer.id));

        if (!updated) {
          throw new Error('Knowledge Base not found');
        }
        return toKnowledgeBase(updated);
      });
    },

    async cancelOwnershipTransfer(input) {
      const rows = await database.db
        .update(ownershipTransfers)
        .set({ cancelledAt: input.now })
        .where(
          and(
            eq(ownershipTransfers.id, input.transferId),
            eq(ownershipTransfers.knowledgeBaseId, input.knowledgeBaseId),
            isNull(ownershipTransfers.acceptedAt),
            isNull(ownershipTransfers.cancelledAt),
          ),
        )
        .returning({ id: ownershipTransfers.id });
      return rows.length > 0;
    },
  };
}
