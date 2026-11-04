import type { AgentTokenScope, AnnotationAnchor, AppExtensionManifest } from '@oln/domain';
import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  displayName: text('display_name').notNull(),
  avatarUrl: text('avatar_url'),
  emailVerifiedAt: timestamp('email_verified_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const authIdentities = pgTable(
  'auth_identities',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    provider: text('provider').notNull(),
    providerAccountId: text('provider_account_id').notNull(),
    email: text('email').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('auth_identities_provider_account_idx').on(table.provider, table.providerAccountId),
    index('auth_identities_user_idx').on(table.userId),
  ],
);

export const magicLinkTokens = pgTable(
  'magic_link_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: text('email').notNull(),
    tokenHash: text('token_hash').notNull().unique(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('magic_link_tokens_email_idx').on(table.email),
    index('magic_link_tokens_expires_at_idx').on(table.expiresAt),
  ],
);

export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull().unique(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
    userAgent: text('user_agent'),
    ip: text('ip'),
  },
  (table) => [
    index('sessions_user_idx').on(table.userId),
    index('sessions_expires_at_idx').on(table.expiresAt),
  ],
);

export const knowledgeBases = pgTable('knowledge_bases', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  description: text('description'),
  ownerId: uuid('owner_id')
    .notNull()
    .references(() => users.id, { onDelete: 'restrict' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  purgeAfter: timestamp('purge_after', { withTimezone: true }),
  deletedByUserId: uuid('deleted_by_user_id').references(() => users.id, {
    onDelete: 'set null',
  }),
});

export const knowledgeBaseMemberships = pgTable(
  'knowledge_base_memberships',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    knowledgeBaseId: uuid('knowledge_base_id')
      .notNull()
      .references(() => knowledgeBases.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: text('role').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('knowledge_base_memberships_kb_user_idx').on(table.knowledgeBaseId, table.userId),
    index('knowledge_base_memberships_user_idx').on(table.userId),
    uniqueIndex('knowledge_base_memberships_one_owner_idx')
      .on(table.knowledgeBaseId)
      .where(sql`${table.role} = 'owner'`),
  ],
);

export const knowledgeBaseInvitations = pgTable(
  'knowledge_base_invitations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    knowledgeBaseId: uuid('knowledge_base_id')
      .notNull()
      .references(() => knowledgeBases.id, { onDelete: 'cascade' }),
    email: text('email').notNull(),
    role: text('role').notNull(),
    tokenHash: text('token_hash').notNull().unique(),
    invitedByUserId: uuid('invited_by_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('knowledge_base_invitations_kb_email_idx').on(table.knowledgeBaseId, table.email),
  ],
);

export const joinLinks = pgTable(
  'join_links',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    knowledgeBaseId: uuid('knowledge_base_id')
      .notNull()
      .references(() => knowledgeBases.id, { onDelete: 'cascade' }),
    role: text('role').notNull(),
    tokenHash: text('token_hash').notNull().unique(),
    createdByUserId: uuid('created_by_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('join_links_kb_idx').on(table.knowledgeBaseId)],
);

export const ownershipTransfers = pgTable(
  'ownership_transfers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    knowledgeBaseId: uuid('knowledge_base_id')
      .notNull()
      .references(() => knowledgeBases.id, { onDelete: 'cascade' }),
    fromUserId: uuid('from_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    toUserId: uuid('to_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('ownership_transfers_to_user_idx').on(table.toUserId)],
);

export const notes = pgTable(
  'notes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    title: text('title').notNull(),
    sourceUrl: text('source_url'),
    sourceCanonicalUrl: text('source_canonical_url'),
    sourceTitle: text('source_title'),
    sourceSiteName: text('source_site_name'),
    capturedAt: timestamp('captured_at', { withTimezone: true }),
    currentRevisionId: uuid('current_revision_id'),
    createdByUserId: uuid('created_by_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('notes_created_by_idx').on(table.createdByUserId),
    index('notes_source_canonical_idx').on(table.sourceCanonicalUrl),
  ],
);

export const noteRevisions = pgTable(
  'note_revisions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    noteId: uuid('note_id')
      .notNull()
      .references(() => notes.id, { onDelete: 'cascade' }),
    revisionNumber: integer('revision_number').notNull(),
    originalFilename: text('original_filename').notNull(),
    mediaType: text('media_type').notNull(),
    byteSize: bigint('byte_size', { mode: 'number' }).notNull(),
    contentHash: text('content_hash').notNull(),
    storageKey: text('storage_key').notNull(),
    status: text('status').notNull(),
    statusDetail: text('status_detail'),
    uploadedByUserId: uuid('uploaded_by_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    processedAt: timestamp('processed_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('note_revisions_note_number_idx').on(table.noteId, table.revisionNumber),
    index('note_revisions_note_idx').on(table.noteId),
  ],
);

export const noteAssociations = pgTable(
  'note_associations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    noteId: uuid('note_id')
      .notNull()
      .references(() => notes.id, { onDelete: 'cascade' }),
    knowledgeBaseId: uuid('knowledge_base_id')
      .notNull()
      .references(() => knowledgeBases.id, { onDelete: 'cascade' }),
    createdByUserId: uuid('created_by_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    trashedAt: timestamp('trashed_at', { withTimezone: true }),
    purgeAfter: timestamp('purge_after', { withTimezone: true }),
    trashedByUserId: uuid('trashed_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
  },
  (table) => [
    uniqueIndex('note_associations_note_kb_idx').on(table.noteId, table.knowledgeBaseId),
    index('note_associations_kb_idx').on(table.knowledgeBaseId),
    index('note_associations_purge_idx').on(table.purgeAfter),
  ],
);

export const noteRelations = pgTable(
  'note_relations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    knowledgeBaseId: uuid('knowledge_base_id')
      .notNull()
      .references(() => knowledgeBases.id, { onDelete: 'cascade' }),
    sourceNoteId: uuid('source_note_id')
      .notNull()
      .references(() => notes.id, { onDelete: 'cascade' }),
    targetNoteId: uuid('target_note_id')
      .notNull()
      .references(() => notes.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    pairKey: text('pair_key').notNull(),
    createdByUserId: uuid('created_by_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('note_relations_pair_idx').on(table.knowledgeBaseId, table.type, table.pairKey),
    index('note_relations_kb_idx').on(table.knowledgeBaseId),
    index('note_relations_source_idx').on(table.sourceNoteId),
    index('note_relations_target_idx').on(table.targetNoteId),
  ],
);

export const captureAttempts = pgTable(
  'capture_attempts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    knowledgeBaseId: uuid('knowledge_base_id')
      .notNull()
      .references(() => knowledgeBases.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    url: text('url').notNull(),
    canonicalUrl: text('canonical_url'),
    selectionHtml: text('selection_html'),
    selectionText: text('selection_text'),
    status: text('status').notNull(),
    noteId: uuid('note_id').references(() => notes.id, { onDelete: 'set null' }),
    revisionId: uuid('revision_id').references(() => noteRevisions.id, { onDelete: 'set null' }),
    duplicateNoteId: uuid('duplicate_note_id').references(() => notes.id, { onDelete: 'set null' }),
    duplicateTitle: text('duplicate_title'),
    errorCode: text('error_code'),
    errorDetail: text('error_detail'),
    idempotencyKey: text('idempotency_key'),
    mediaKeys: jsonb('media_keys').$type<string[]>().notNull().default([]),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('capture_attempts_user_kb_key_idx')
      .on(table.userId, table.knowledgeBaseId, table.idempotencyKey)
      .where(sql`${table.idempotencyKey} is not null`),
    index('capture_attempts_user_created_idx').on(table.userId, table.createdAt),
    index('capture_attempts_kb_url_idx').on(table.knowledgeBaseId, table.canonicalUrl),
  ],
);

export const annotations = pgTable(
  'annotations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    knowledgeBaseId: uuid('knowledge_base_id')
      .notNull()
      .references(() => knowledgeBases.id, { onDelete: 'cascade' }),
    noteId: uuid('note_id')
      .notNull()
      .references(() => notes.id, { onDelete: 'cascade' }),
    revisionId: uuid('revision_id')
      .notNull()
      .references(() => noteRevisions.id, { onDelete: 'cascade' }),
    originalRevisionId: uuid('original_revision_id')
      .notNull()
      .references(() => noteRevisions.id, { onDelete: 'cascade' }),
    parentId: uuid('parent_id').references((): AnyPgColumn => annotations.id, {
      onDelete: 'cascade',
    }),
    authorUserId: uuid('author_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    kind: text('kind').notNull(),
    markType: text('mark_type'),
    payload: jsonb('payload').$type<Record<string, unknown> | null>(),
    body: text('body'),
    agentName: text('agent_name'),
    anchor: jsonb('anchor').$type<AnnotationAnchor>().notNull(),
    needsReview: boolean('needs_review').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [
    index('annotations_kb_note_idx').on(table.knowledgeBaseId, table.noteId),
    index('annotations_parent_idx').on(table.parentId),
    index('annotations_revision_idx').on(table.revisionId),
  ],
);

export const extensionAuthCodes = pgTable(
  'extension_auth_codes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    codeHash: text('code_hash').notNull().unique(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    challenge: text('challenge').notNull(),
    redirectUri: text('redirect_uri').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('extension_auth_codes_user_idx').on(table.userId),
    index('extension_auth_codes_expires_idx').on(table.expiresAt),
  ],
);

export const extensionRefreshTokens = pgTable(
  'extension_refresh_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tokenHash: text('token_hash').notNull().unique(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  },
  (table) => [
    index('extension_refresh_tokens_user_idx').on(table.userId),
    index('extension_refresh_tokens_expires_idx').on(table.expiresAt),
  ],
);

export const appExtensions = pgTable(
  'app_extensions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    knowledgeBaseId: uuid('knowledge_base_id')
      .notNull()
      .references(() => knowledgeBases.id, { onDelete: 'cascade' }),
    extensionId: text('extension_id').notNull(),
    name: text('name').notNull(),
    version: text('version').notNull(),
    apiVersion: integer('api_version').notNull(),
    publisher: text('publisher').notNull(),
    packageHash: text('package_hash').notNull(),
    source: text('source').notNull(),
    manifest: jsonb('manifest').$type<AppExtensionManifest>().notNull(),
    files: jsonb('files').$type<Record<string, string>>().notNull().default({}),
    enabled: boolean('enabled').notNull().default(false),
    installedByUserId: uuid('installed_by_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('app_extensions_version_idx').on(
      table.knowledgeBaseId,
      table.extensionId,
      table.version,
    ),
    uniqueIndex('app_extensions_enabled_idx')
      .on(table.knowledgeBaseId, table.extensionId)
      .where(sql`${table.enabled}`),
    index('app_extensions_knowledge_base_idx').on(table.knowledgeBaseId),
  ],
);

export const agentTokens = pgTable(
  'agent_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    tokenHash: text('token_hash').notNull().unique(),
    prefix: text('prefix').notNull(),
    scopes: text('scopes').array().$type<AgentTokenScope[]>().notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('agent_tokens_user_idx').on(table.userId)],
);

export const auditEvents = pgTable(
  'audit_event',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    actorUserId: text('actor_user_id'),
    action: text('action').notNull(),
    subjectType: text('subject_type').notNull(),
    subjectId: text('subject_id'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('audit_event_subject_idx').on(table.subjectType, table.subjectId),
    index('audit_event_created_at_idx').on(table.createdAt),
  ],
);
