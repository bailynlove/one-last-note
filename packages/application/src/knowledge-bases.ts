import {
  type InvitableRole,
  type Invitation,
  type InvitationPreview,
  isInvitableRole,
  type JoinLink,
  type JoinLinkPreview,
  type KnowledgeBase,
  type KnowledgeBaseRole,
  type KnowledgeBaseSummary,
  type Member,
  normalizeEmail,
  type OwnershipTransfer,
  type User,
} from '@oln/domain';
import { createToken, hashToken } from './auth';
import { AppError } from './errors';

export class PendingInvitationError extends Error {}

const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const OWNERSHIP_TRANSFER_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_NAME_LENGTH = 120;
const MAX_DESCRIPTION_LENGTH = 1_000;

export interface KnowledgeBaseAccess {
  knowledgeBase: KnowledgeBase;
  role: KnowledgeBaseRole;
}

export interface StoredInvitation extends Omit<Invitation, 'expiresAt' | 'createdAt'> {
  knowledgeBaseId: string;
  knowledgeBaseName: string;
  expiresAt: Date;
  acceptedAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
}

export interface StoredJoinLink extends Omit<JoinLink, 'expiresAt' | 'createdAt'> {
  knowledgeBaseId: string;
  knowledgeBaseName: string;
  expiresAt: Date;
  revokedAt: Date | null;
  createdAt: Date;
}

export interface StoredOwnershipTransfer
  extends Omit<OwnershipTransfer, 'expiresAt' | 'createdAt'> {
  knowledgeBaseId: string;
  expiresAt: Date;
  createdAt: Date;
  acceptedAt: Date | null;
  cancelledAt: Date | null;
}

export interface CreatedJoinLink extends JoinLink {
  token: string;
}

export interface KnowledgeBaseStore {
  createKnowledgeBase(input: {
    name: string;
    description: string | null;
    ownerId: string;
    now: Date;
  }): Promise<KnowledgeBase>;
  findAccess(knowledgeBaseId: string, userId: string): Promise<KnowledgeBaseAccess | null>;
  listForUser(userId: string): Promise<KnowledgeBaseSummary[]>;
  updateKnowledgeBase(
    knowledgeBaseId: string,
    input: { name?: string; description?: string | null },
    now: Date,
  ): Promise<KnowledgeBase | null>;
  listMembers(knowledgeBaseId: string): Promise<Member[]>;
  findMember(knowledgeBaseId: string, userId: string): Promise<Member | null>;
  findUserByEmail(email: string): Promise<User | null>;
  createInvitation(input: {
    knowledgeBaseId: string;
    email: string;
    role: InvitableRole;
    tokenHash: string;
    expiresAt: Date;
    invitedByUserId: string;
    replacesInvitationId?: string;
    now: Date;
  }): Promise<Invitation>;
  findPendingInvitation(knowledgeBaseId: string, email: string): Promise<Invitation | null>;
  findInvitationByHash(tokenHash: string): Promise<StoredInvitation | null>;
  listInvitations(knowledgeBaseId: string): Promise<Invitation[]>;
  revokeInvitation(invitationId: string, knowledgeBaseId: string, now: Date): Promise<void>;
  acceptInvitation(input: {
    invitationId: string;
    knowledgeBaseId: string;
    userId: string;
    role: InvitableRole;
    now: Date;
  }): Promise<KnowledgeBase | null>;
  createJoinLink(input: {
    knowledgeBaseId: string;
    role: InvitableRole;
    tokenHash: string;
    expiresAt: Date;
    createdByUserId: string;
    now: Date;
  }): Promise<JoinLink>;
  findJoinLinkByHash(tokenHash: string): Promise<StoredJoinLink | null>;
  listJoinLinks(knowledgeBaseId: string): Promise<JoinLink[]>;
  revokeJoinLink(joinLinkId: string, knowledgeBaseId: string, now: Date): Promise<void>;
  acceptJoinLink(input: {
    joinLinkId: string;
    knowledgeBaseId: string;
    userId: string;
    role: InvitableRole;
    now: Date;
  }): Promise<KnowledgeBase | null>;
  updateMemberRole(input: {
    knowledgeBaseId: string;
    userId: string;
    role: Exclude<KnowledgeBaseRole, 'owner'>;
  }): Promise<void>;
  removeMember(knowledgeBaseId: string, userId: string, allowedRole?: InvitableRole): Promise<void>;
  createOwnershipTransfer(input: {
    knowledgeBaseId: string;
    fromUserId: string;
    toUserId: string;
    expiresAt: Date;
    now: Date;
  }): Promise<OwnershipTransfer>;
  findOwnershipTransfer(transferId: string): Promise<StoredOwnershipTransfer | null>;
  findPendingOwnershipTransfer(knowledgeBaseId: string): Promise<OwnershipTransfer | null>;
  acceptOwnershipTransfer(input: {
    transferId: string;
    toUserId: string;
    now: Date;
  }): Promise<KnowledgeBase | null>;
  cancelOwnershipTransfer(input: {
    transferId: string;
    knowledgeBaseId: string;
    now: Date;
  }): Promise<boolean>;
}

export interface KnowledgeBaseEmailSender {
  sendInvitation(input: {
    to: string;
    knowledgeBaseName: string;
    role: InvitableRole;
    url: string;
  }): Promise<void>;
}

export interface KnowledgeBaseServiceOptions {
  store: KnowledgeBaseStore;
  email: KnowledgeBaseEmailSender;
  webAppUrl: string;
  now?: () => Date;
  logger?: { error(details: unknown, message: string): void };
}

export class KnowledgeBaseService {
  private readonly now: () => Date;

  constructor(private readonly options: KnowledgeBaseServiceOptions) {
    this.now = options.now ?? (() => new Date());
  }

  async create(
    user: User,
    input: { name: string; description?: string | null },
  ): Promise<KnowledgeBase> {
    return this.options.store.createKnowledgeBase({
      name: this.readName(input.name),
      description: this.readDescription(input.description),
      ownerId: user.id,
      now: this.now(),
    });
  }

  list(user: User): Promise<KnowledgeBaseSummary[]> {
    return this.options.store.listForUser(user.id);
  }

  get(user: User, knowledgeBaseId: string): Promise<KnowledgeBaseAccess> {
    return this.requireMember(knowledgeBaseId, user.id);
  }

  async update(
    user: User,
    knowledgeBaseId: string,
    input: { name?: string; description?: string | null },
  ): Promise<KnowledgeBase> {
    await this.requireOwner(knowledgeBaseId, user.id);
    const updated = await this.options.store.updateKnowledgeBase(
      knowledgeBaseId,
      {
        ...(input.name === undefined ? {} : { name: this.readName(input.name) }),
        ...(input.description === undefined
          ? {}
          : { description: this.readDescription(input.description) }),
      },
      this.now(),
    );
    if (!updated) {
      throw notFound();
    }

    return updated;
  }

  async listMembers(user: User, knowledgeBaseId: string): Promise<Member[]> {
    await this.requireMember(knowledgeBaseId, user.id);
    return this.options.store.listMembers(knowledgeBaseId);
  }

  async listInvitations(user: User, knowledgeBaseId: string): Promise<Invitation[]> {
    await this.requireManager(knowledgeBaseId, user.id);
    return this.options.store.listInvitations(knowledgeBaseId);
  }

  async invite(
    user: User,
    knowledgeBaseId: string,
    input: { email: string; role: InvitableRole },
  ): Promise<Invitation> {
    const access = await this.requireManager(knowledgeBaseId, user.id);
    const role = this.readInvitableRole(input.role);
    const email = normalizeEmail(input.email);
    if (role === 'manager' && access.role !== 'owner') {
      throw forbidden('Only the Owner can invite Managers.');
    }

    const existingUser = await this.options.store.findUserByEmail(email);
    if (existingUser) {
      const existingMember = await this.options.store.findMember(knowledgeBaseId, existingUser.id);
      if (existingMember) {
        throw conflict('That person is already a member.');
      }
    }

    if (await this.options.store.findPendingInvitation(knowledgeBaseId, email)) {
      throw conflict('An invitation is already pending for that email.');
    }

    const token = createToken();
    const now = this.now();
    const expiresAt = new Date(now.getTime() + INVITATION_TTL_MS);
    const invitation = await this.options.store
      .createInvitation({
        knowledgeBaseId,
        email,
        role,
        tokenHash: hashToken(token),
        expiresAt,
        invitedByUserId: user.id,
        now,
      })
      .catch((error: unknown) => {
        if (error instanceof PendingInvitationError) {
          throw conflict('An invitation is already pending for that email.');
        }
        throw error;
      });

    try {
      await this.options.email.sendInvitation({
        to: email,
        knowledgeBaseName: access.knowledgeBase.name,
        role,
        url: new URL(`/invitations/${token}`, this.options.webAppUrl).toString(),
      });
    } catch (error) {
      this.options.logger?.error({ err: error }, 'knowledge base invitation email failed');
      await this.options.store.revokeInvitation(invitation.id, knowledgeBaseId, now);
      throw new AppError('The invitation email could not be sent. Try again.', {
        status: 503,
        title: 'Invitation unavailable',
      });
    }

    return invitation;
  }

  async resendInvitation(
    user: User,
    knowledgeBaseId: string,
    invitationId: string,
  ): Promise<Invitation> {
    const access = await this.requireManager(knowledgeBaseId, user.id);
    const invitation = await this.options.store.listInvitations(knowledgeBaseId);
    const existing = invitation.find((item) => item.id === invitationId);
    if (!existing) {
      throw notFound();
    }
    if (existing.role === 'manager' && access.role !== 'owner') {
      throw forbidden('Only the Owner can invite Managers.');
    }

    const token = createToken();
    const now = this.now();
    const replacement = await this.options.store
      .createInvitation({
        knowledgeBaseId,
        email: existing.email,
        role: existing.role,
        tokenHash: hashToken(token),
        expiresAt: new Date(now.getTime() + INVITATION_TTL_MS),
        invitedByUserId: user.id,
        replacesInvitationId: existing.id,
        now,
      })
      .catch((error: unknown) => {
        if (error instanceof PendingInvitationError) {
          throw conflict('An invitation is already pending for that email.');
        }
        throw error;
      });
    try {
      await this.options.email.sendInvitation({
        to: existing.email,
        knowledgeBaseName: access.knowledgeBase.name,
        role: existing.role,
        url: new URL(`/invitations/${token}`, this.options.webAppUrl).toString(),
      });
    } catch (error) {
      this.options.logger?.error({ err: error }, 'knowledge base invitation resend failed');
      await this.options.store.revokeInvitation(replacement.id, knowledgeBaseId, now);
      throw new AppError('The invitation email could not be sent. Try again.', {
        status: 503,
        title: 'Invitation unavailable',
      });
    }

    await this.options.store.revokeInvitation(existing.id, knowledgeBaseId, now);
    return replacement;
  }

  async revokeInvitation(user: User, knowledgeBaseId: string, invitationId: string): Promise<void> {
    const access = await this.requireManager(knowledgeBaseId, user.id);
    const invitations = await this.options.store.listInvitations(knowledgeBaseId);
    const invitation = invitations.find((item) => item.id === invitationId);
    if (!invitation) {
      throw notFound();
    }
    if (invitation.role === 'manager' && access.role !== 'owner') {
      throw forbidden('Only the Owner can manage Manager invitations.');
    }
    await this.options.store.revokeInvitation(invitationId, knowledgeBaseId, this.now());
  }

  async invitationPreview(token: string): Promise<InvitationPreview> {
    const invitation = await this.options.store.findInvitationByHash(hashToken(token));
    if (!invitation || invitation.revokedAt || invitation.acceptedAt) {
      throw notFound();
    }
    if (invitation.expiresAt.getTime() <= this.now().getTime()) {
      throw notFound();
    }
    return {
      knowledgeBaseName: invitation.knowledgeBaseName,
      role: invitation.role,
      email: invitation.email,
      expiresAt: invitation.expiresAt.toISOString(),
    };
  }

  async acceptInvitation(user: User, token: string): Promise<KnowledgeBase> {
    const invitation = await this.options.store.findInvitationByHash(hashToken(token));
    if (!invitation || invitation.revokedAt || invitation.acceptedAt) {
      throw invalidInvitation();
    }
    if (invitation.expiresAt.getTime() <= this.now().getTime()) {
      throw invalidInvitation();
    }
    if (normalizeEmail(user.email) !== normalizeEmail(invitation.email)) {
      throw forbidden('Sign in with the email address that was invited.');
    }
    const knowledgeBase = await this.options.store.acceptInvitation({
      invitationId: invitation.id,
      knowledgeBaseId: invitation.knowledgeBaseId,
      userId: user.id,
      role: invitation.role,
      now: this.now(),
    });
    if (!knowledgeBase) {
      throw invalidInvitation();
    }
    return knowledgeBase;
  }

  async createJoinLink(
    user: User,
    knowledgeBaseId: string,
    input: { role: InvitableRole; expiresInDays?: number },
  ): Promise<CreatedJoinLink> {
    await this.requireOwner(knowledgeBaseId, user.id);
    const role = this.readInvitableRole(input.role);
    const days = input.expiresInDays ?? 7;
    if (!Number.isInteger(days) || days < 1 || days > 30) {
      throw new AppError('Join link expiry must be between 1 and 30 days.', {
        status: 400,
        title: 'Invalid expiry',
      });
    }

    const token = createToken();
    const now = this.now();
    const expiresAt = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
    const link = await this.options.store.createJoinLink({
      knowledgeBaseId,
      role,
      tokenHash: hashToken(token),
      expiresAt,
      createdByUserId: user.id,
      now,
    });
    return { ...link, token };
  }

  async listJoinLinks(user: User, knowledgeBaseId: string): Promise<JoinLink[]> {
    await this.requireOwner(knowledgeBaseId, user.id);
    return this.options.store.listJoinLinks(knowledgeBaseId);
  }

  async revokeJoinLink(user: User, knowledgeBaseId: string, joinLinkId: string): Promise<void> {
    await this.requireOwner(knowledgeBaseId, user.id);
    await this.options.store.revokeJoinLink(joinLinkId, knowledgeBaseId, this.now());
  }

  async joinLinkPreview(token: string): Promise<JoinLinkPreview> {
    const link = await this.options.store.findJoinLinkByHash(hashToken(token));
    if (!link || link.revokedAt) {
      throw notFound();
    }
    if (link.expiresAt.getTime() <= this.now().getTime()) {
      throw notFound();
    }
    return {
      knowledgeBaseName: link.knowledgeBaseName,
      role: link.role,
      expiresAt: link.expiresAt.toISOString(),
    };
  }

  async acceptJoinLink(user: User, token: string): Promise<KnowledgeBase> {
    const link = await this.options.store.findJoinLinkByHash(hashToken(token));
    if (!link || link.revokedAt || link.expiresAt.getTime() <= this.now().getTime()) {
      throw invalidJoinLink();
    }
    const knowledgeBase = await this.options.store.acceptJoinLink({
      joinLinkId: link.id,
      knowledgeBaseId: link.knowledgeBaseId,
      userId: user.id,
      role: link.role,
      now: this.now(),
    });
    if (!knowledgeBase) {
      throw invalidJoinLink();
    }
    return knowledgeBase;
  }

  async changeRole(
    user: User,
    knowledgeBaseId: string,
    targetUserId: string,
    role: InvitableRole,
  ): Promise<void> {
    await this.requireOwner(knowledgeBaseId, user.id);
    const target = await this.options.store.findMember(knowledgeBaseId, targetUserId);
    if (!target) {
      throw notFound();
    }
    if (target.role === 'owner') {
      throw conflict('Transfer ownership instead of changing the Owner role.');
    }
    await this.options.store.updateMemberRole({
      knowledgeBaseId,
      userId: targetUserId,
      role: this.readInvitableRole(role),
    });
  }

  async removeMember(user: User, knowledgeBaseId: string, targetUserId: string): Promise<void> {
    const access = await this.requireMember(knowledgeBaseId, user.id);
    const target = await this.options.store.findMember(knowledgeBaseId, targetUserId);
    if (!target) {
      throw notFound();
    }

    if (targetUserId === user.id) {
      if (access.role === 'owner') {
        throw conflict('Transfer ownership before leaving this Knowledge Base.');
      }
    } else if (access.role === 'owner') {
      if (target.role === 'owner') {
        throw conflict('The Owner cannot be removed.');
      }
    } else if (access.role === 'manager') {
      if (target.role !== 'viewer') {
        throw forbidden('Managers can remove Viewers only.');
      }
    } else {
      throw forbidden('Viewers cannot remove members.');
    }

    await this.options.store.removeMember(
      knowledgeBaseId,
      targetUserId,
      access.role === 'manager' && targetUserId !== user.id ? 'viewer' : undefined,
    );
  }

  async transferOwnership(
    user: User,
    knowledgeBaseId: string,
    targetUserId: string,
  ): Promise<OwnershipTransfer> {
    await this.requireOwner(knowledgeBaseId, user.id);
    if (targetUserId === user.id) {
      throw conflict('Choose another Manager.');
    }
    const target = await this.options.store.findMember(knowledgeBaseId, targetUserId);
    if (target?.role !== 'manager') {
      throw conflict('Ownership can only transfer to a Manager.');
    }

    const now = this.now();
    return this.options.store.createOwnershipTransfer({
      knowledgeBaseId,
      fromUserId: user.id,
      toUserId: targetUserId,
      expiresAt: new Date(now.getTime() + OWNERSHIP_TRANSFER_TTL_MS),
      now,
    });
  }

  async pendingOwnershipTransfer(
    user: User,
    knowledgeBaseId: string,
  ): Promise<OwnershipTransfer | null> {
    await this.requireOwner(knowledgeBaseId, user.id);
    return this.options.store.findPendingOwnershipTransfer(knowledgeBaseId);
  }

  async acceptOwnershipTransfer(user: User, transferId: string): Promise<KnowledgeBase> {
    const transfer = await this.options.store.findOwnershipTransfer(transferId);
    if (!transfer || transfer.toUserId !== user.id || transfer.acceptedAt || transfer.cancelledAt) {
      throw notFound();
    }
    if (transfer.expiresAt.getTime() <= this.now().getTime()) {
      throw new AppError('This ownership transfer has expired.', {
        status: 400,
        title: 'Transfer expired',
      });
    }
    const knowledgeBase = await this.options.store.acceptOwnershipTransfer({
      transferId,
      toUserId: user.id,
      now: this.now(),
    });
    if (!knowledgeBase) {
      throw notFound();
    }
    return knowledgeBase;
  }

  async cancelOwnershipTransfer(
    user: User,
    knowledgeBaseId: string,
    transferId: string,
  ): Promise<void> {
    await this.requireOwner(knowledgeBaseId, user.id);
    const cancelled = await this.options.store.cancelOwnershipTransfer({
      transferId,
      knowledgeBaseId,
      now: this.now(),
    });
    if (!cancelled) {
      throw notFound();
    }
  }

  private async requireMember(
    knowledgeBaseId: string,
    userId: string,
  ): Promise<KnowledgeBaseAccess> {
    const access = await this.options.store.findAccess(knowledgeBaseId, userId);
    if (!access) {
      throw notFound();
    }
    return access;
  }

  private async requireManager(
    knowledgeBaseId: string,
    userId: string,
  ): Promise<KnowledgeBaseAccess> {
    const access = await this.requireMember(knowledgeBaseId, userId);
    if (access.role !== 'owner' && access.role !== 'manager') {
      throw forbidden('Managers or the Owner can do that.');
    }
    return access;
  }

  private async requireOwner(
    knowledgeBaseId: string,
    userId: string,
  ): Promise<KnowledgeBaseAccess> {
    const access = await this.requireMember(knowledgeBaseId, userId);
    if (access.role !== 'owner') {
      throw forbidden('Only the Owner can do that.');
    }
    return access;
  }

  private readName(value: string): string {
    const name = value.trim();
    if (!name || name.length > MAX_NAME_LENGTH) {
      throw new AppError('Knowledge Base name must be between 1 and 120 characters.', {
        status: 400,
        title: 'Invalid name',
      });
    }
    return name;
  }

  private readDescription(value: string | null | undefined): string | null {
    if (value == null) {
      return null;
    }
    const description = value.trim();
    if (description.length > MAX_DESCRIPTION_LENGTH) {
      throw new AppError('Description must be 1000 characters or fewer.', {
        status: 400,
        title: 'Invalid description',
      });
    }
    return description || null;
  }

  private readInvitableRole(value: unknown): InvitableRole {
    if (!isInvitableRole(value)) {
      throw new AppError('Role must be manager or viewer.', {
        status: 400,
        title: 'Invalid role',
      });
    }
    return value;
  }
}

function notFound(): AppError {
  return new AppError('Knowledge Base not found.', {
    status: 404,
    title: 'Not found',
  });
}

function forbidden(message: string): AppError {
  return new AppError(message, { status: 403, title: 'Forbidden' });
}

function conflict(message: string): AppError {
  return new AppError(message, { status: 409, title: 'Conflict' });
}

function invalidInvitation(): AppError {
  return new AppError('This invitation is invalid, expired, or already used.', {
    status: 400,
    title: 'Invalid invitation',
  });
}

function invalidJoinLink(): AppError {
  return new AppError('This join link is invalid, expired, or revoked.', {
    status: 400,
    title: 'Invalid join link',
  });
}
