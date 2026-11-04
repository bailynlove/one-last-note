import { randomUUID } from 'node:crypto';
import { RetentionService } from '@oln/application';
import { createRetentionStore } from '@oln/infrastructure';
import { eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  agentTokens,
  auditEvents,
  captureAttempts,
  knowledgeBases,
  magicLinkTokens,
  noteRevisions,
  notes,
  sessions,
  users,
} from '../packages/infrastructure/src/db/schema';
import { startTestStack, type TestStack } from './fixtures';

let stack: TestStack;
const now = new Date('2026-06-01T00:00:00.000Z');
const day = 86_400_000;
const userId = randomUUID();
const knowledgeBaseId = randomUUID();
const noteId = randomUUID();
const rejectedRevisionId = randomUUID();
const readyRevisionId = randomUUID();
let deletedKeys: string[] = [];
const suffix = randomUUID();
const oldSession = `old-session-${suffix}`;
const liveSession = `live-session-${suffix}`;
const oldAgent = `old-agent-${suffix}`;
const liveAgent = `live-agent-${suffix}`;
const oldLink = `old-link-${suffix}`;
const newLink = `new-link-${suffix}`;

beforeAll(async () => {
  stack = await startTestStack();
  await stack.database.db.insert(users).values({
    id: userId,
    email: `retention-${userId}@example.com`,
    displayName: 'Retention',
    emailVerifiedAt: now,
  });
  await stack.database.db.insert(knowledgeBases).values({
    id: knowledgeBaseId,
    name: 'Retention KB',
    ownerId: userId,
  });
  await stack.database.db.insert(notes).values({
    id: noteId,
    title: 'Retention note',
    createdByUserId: userId,
    currentRevisionId: readyRevisionId,
  });
  await stack.database.db.insert(noteRevisions).values([
    {
      id: readyRevisionId,
      noteId,
      revisionNumber: 1,
      originalFilename: 'ready.txt',
      mediaType: 'text/plain',
      byteSize: 5,
      contentHash: 'a'.repeat(64),
      storageKey: 'ready-key',
      status: 'ready',
      uploadedByUserId: userId,
      processedAt: now,
      createdAt: new Date(now.getTime() - 500 * day),
    },
    {
      id: rejectedRevisionId,
      noteId,
      revisionNumber: 2,
      originalFilename: 'bad.zip',
      mediaType: 'application/zip',
      byteSize: 10,
      contentHash: 'b'.repeat(64),
      storageKey: 'rejected-key',
      status: 'rejected',
      uploadedByUserId: userId,
      createdAt: new Date(now.getTime() - 10 * day),
    },
  ]);
  await stack.database.db.insert(captureAttempts).values([
    {
      knowledgeBaseId,
      userId,
      url: 'https://example.com/old-failed',
      status: 'failed',
      mediaKeys: ['failed-capture-key'],
      createdAt: new Date(now.getTime() - 10 * day),
    },
    {
      knowledgeBaseId,
      userId,
      url: 'https://example.com/recent-failed',
      status: 'failed',
      createdAt: new Date(now.getTime() - day),
    },
    {
      knowledgeBaseId,
      userId,
      url: 'https://example.com/old-accepted',
      status: 'ready',
      noteId,
      selectionHtml: '<p>secret</p>',
      errorCode: 'old',
      createdAt: new Date(now.getTime() - 100 * day),
    },
    {
      knowledgeBaseId,
      userId,
      url: 'https://example.com/recent-accepted',
      status: 'ready',
      noteId,
      selectionHtml: '<p>keep</p>',
      createdAt: new Date(now.getTime() - 10 * day),
    },
  ]);
  await stack.database.db.insert(auditEvents).values([
    {
      action: `old-${suffix}`,
      subjectType: 'test',
      createdAt: new Date(now.getTime() - 401 * day),
    },
    {
      action: `recent-${suffix}`,
      subjectType: 'test',
      createdAt: new Date(now.getTime() - 399 * day),
    },
  ]);
  await stack.database.db.insert(sessions).values([
    { userId, tokenHash: oldSession, expiresAt: new Date(now.getTime() - day) },
    { userId, tokenHash: liveSession, expiresAt: new Date(now.getTime() + day) },
  ]);
  await stack.database.db.insert(agentTokens).values([
    {
      userId,
      name: 'old',
      tokenHash: oldAgent,
      prefix: 'oln_agent_old',
      scopes: ['read'],
      expiresAt: new Date(now.getTime() - day),
    },
    {
      userId,
      name: 'live',
      tokenHash: liveAgent,
      prefix: 'oln_agent_live',
      scopes: ['read'],
      expiresAt: new Date(now.getTime() + 30 * day),
    },
  ]);
  await stack.database.db.insert(magicLinkTokens).values([
    { email: 'old@example.com', tokenHash: oldLink, expiresAt: new Date(now.getTime() - 8 * day) },
    { email: 'new@example.com', tokenHash: newLink, expiresAt: new Date(now.getTime() - 6 * day) },
  ]);
});

afterAll(async () => {
  await stack.close();
});

describe('retention', () => {
  it('deletes only expired data classes and their storage objects', async () => {
    const retention = new RetentionService({
      store: createRetentionStore(stack.database),
      storage: {
        deleteMany: async (keys) => {
          deletedKeys = keys;
        },
      },
      now: () => now,
    });
    const result = await retention.purge();

    expect(result.auditEvents).toBeGreaterThanOrEqual(1);
    expect(result.failedCaptures).toBeGreaterThanOrEqual(1);
    expect(result.acceptedCaptureMetadata).toBeGreaterThanOrEqual(1);
    expect(result.rejectedRevisions).toBeGreaterThanOrEqual(1);
    expect(result.sessions).toBeGreaterThanOrEqual(1);
    expect(result.agentTokens).toBeGreaterThanOrEqual(1);
    expect(result.magicLinks).toBeGreaterThanOrEqual(1);
    expect(deletedKeys).toEqual(expect.arrayContaining(['failed-capture-key', 'rejected-key']));

    const rejected = await stack.database.db
      .select()
      .from(noteRevisions)
      .where(eq(noteRevisions.id, rejectedRevisionId));
    expect(rejected).toHaveLength(0);
    const ready = await stack.database.db
      .select()
      .from(noteRevisions)
      .where(eq(noteRevisions.id, readyRevisionId));
    expect(ready).toHaveLength(1);

    const captures = await stack.database.db
      .select()
      .from(captureAttempts)
      .where(eq(captureAttempts.userId, userId));
    expect(captures.map((row) => row.url).sort()).toEqual([
      'https://example.com/old-accepted',
      'https://example.com/recent-accepted',
      'https://example.com/recent-failed',
    ]);
    const acceptedOld = captures.find((row) => row.url.endsWith('old-accepted'));
    expect(acceptedOld?.selectionHtml).toBeNull();
    expect(acceptedOld?.errorCode).toBeNull();
    const acceptedRecent = captures.find((row) => row.url.endsWith('recent-accepted'));
    expect(acceptedRecent?.selectionHtml).toBe('<p>keep</p>');

    const audit = await stack.database.db
      .select()
      .from(auditEvents)
      .where(inArray(auditEvents.action, [`old-${suffix}`, `recent-${suffix}`]));
    expect(audit.map((row) => row.action)).toEqual([`recent-${suffix}`]);
    const liveSessions = await stack.database.db
      .select()
      .from(sessions)
      .where(eq(sessions.userId, userId));
    expect(liveSessions.map((row) => row.tokenHash)).toEqual([liveSession]);
    const liveTokens = await stack.database.db
      .select()
      .from(agentTokens)
      .where(eq(agentTokens.userId, userId));
    expect(liveTokens.map((row) => row.name)).toEqual(['live']);
    const links = await stack.database.db
      .select()
      .from(magicLinkTokens)
      .where(inArray(magicLinkTokens.tokenHash, [oldLink, newLink]));
    expect(links.map((row) => row.tokenHash)).toEqual([newLink]);
  });
});
