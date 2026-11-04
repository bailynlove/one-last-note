export const KNOWLEDGE_BASE_ROLES = ['owner', 'manager', 'viewer'] as const;
export type KnowledgeBaseRole = (typeof KNOWLEDGE_BASE_ROLES)[number];

export const INVITABLE_ROLES = ['manager', 'viewer'] as const;
export type InvitableRole = (typeof INVITABLE_ROLES)[number];

export interface KnowledgeBase {
  id: string;
  name: string;
  description: string | null;
  ownerId: string;
  createdAt: string;
  updatedAt: string;
}

export interface KnowledgeBaseSummary extends KnowledgeBase {
  role: KnowledgeBaseRole;
}

export interface Member {
  userId: string;
  email: string;
  displayName: string;
  avatarUrl: string | null;
  role: KnowledgeBaseRole;
  joinedAt: string;
}

export interface Invitation {
  id: string;
  email: string;
  role: InvitableRole;
  expiresAt: string;
  createdAt: string;
}

export interface JoinLink {
  id: string;
  role: InvitableRole;
  expiresAt: string;
  createdAt: string;
}

export interface InvitationPreview {
  knowledgeBaseName: string;
  role: InvitableRole;
  email: string;
  expiresAt: string;
}

export interface JoinLinkPreview {
  knowledgeBaseName: string;
  role: InvitableRole;
  expiresAt: string;
}

export interface OwnershipTransfer {
  id: string;
  fromUserId: string;
  toUserId: string;
  expiresAt: string;
  createdAt: string;
}

export function isKnowledgeBaseRole(value: unknown): value is KnowledgeBaseRole {
  return typeof value === 'string' && (KNOWLEDGE_BASE_ROLES as readonly string[]).includes(value);
}

export function isInvitableRole(value: unknown): value is InvitableRole {
  return typeof value === 'string' && (INVITABLE_ROLES as readonly string[]).includes(value);
}
