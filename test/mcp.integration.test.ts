import { randomUUID } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {
  AgentControlService,
  AgentTokenService,
  AnnotationService,
  AuthService,
  createToken,
  hashToken,
  KnowledgeBaseService,
  LifecycleService,
  NoteService,
  RelationService,
} from '@oln/application';
import {
  createAgentRateLimiter,
  createAgentTokenStore,
  createAnnotationStore,
  createAuthStore,
  createAuthThrottle,
  createDevelopmentScanner,
  createKnowledgeBaseStore,
  createLifecycleStore,
  createNoteRevisionQueue,
  createNoteStore,
  createRelationStore,
  storageAdapter,
} from '@oln/infrastructure';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  agentTokens as agentTokensTable,
  auditEvents,
  knowledgeBaseMemberships,
  knowledgeBases,
  noteAssociations,
  noteRevisions,
  notes,
  sessions,
  users,
} from '../packages/infrastructure/src/db/schema';
import { startTestApi, startTestStack, type TestStack, testReadiness } from './fixtures';

let stack: TestStack;
let app: FastifyInstance;
let baseUrl: string;
let owner: { id: string; email: string; displayName: string; session: string };
let outsider: { id: string; session: string };
let knowledgeBaseId: string;
let noteId: string;
let revisionId: string;
let tokens: AgentTokenService;
let queue: ReturnType<typeof createNoteRevisionQueue>;
let writeToken = '';
let readToken = '';
let revokedToken = '';

async function createUser(label: string) {
  const [user] = await stack.database.db
    .insert(users)
    .values({
      email: `${label}-${randomUUID()}@example.com`,
      displayName: label,
      emailVerifiedAt: new Date(),
    })
    .returning();
  if (!user) throw new Error('user insert failed');
  const session = createToken();
  await stack.database.db.insert(sessions).values({
    userId: user.id,
    tokenHash: hashToken(session),
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    lastSeenAt: new Date(),
  });
  return { id: user.id, email: user.email, displayName: user.displayName, session };
}

function auth(token: string) {
  return { authorization: `Bearer ${token}` };
}

async function token(label: string, scopes: ('read' | 'write')[]) {
  const response = await app.inject({
    method: 'POST',
    url: '/agent-tokens',
    headers: auth(owner.session),
    payload: { name: label, scopes, expiresInDays: 30 },
  });
  expect(response.statusCode, response.body).toBe(201);
  const body = response.json() as { token: string };
  return body.token;
}

async function connect(raw: string) {
  const client = new Client({ name: 'integration-test', version: '1.0.0' });
  const transport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`), {
    requestInit: { headers: auth(raw) },
  });
  await client.connect(transport);
  return client;
}

beforeAll(async () => {
  stack = await startTestStack();
  const ownerUser = await createUser('mcp-owner');
  owner = { ...ownerUser, session: ownerUser.session };
  const outsiderUser = await createUser('mcp-outsider');
  outsider = { id: outsiderUser.id, session: outsiderUser.session };
  const [kb] = await stack.database.db
    .insert(knowledgeBases)
    .values({ name: 'MCP KB', ownerId: owner.id })
    .returning();
  if (!kb) throw new Error('kb insert failed');
  knowledgeBaseId = kb.id;
  await stack.database.db.insert(knowledgeBaseMemberships).values([
    { knowledgeBaseId, userId: owner.id, role: 'owner' },
    { knowledgeBaseId, userId: outsider.id, role: 'viewer' },
  ]);
  const [note] = await stack.database.db
    .insert(notes)
    .values({ title: 'MCP note', createdByUserId: owner.id })
    .returning();
  if (!note) throw new Error('note insert failed');
  noteId = note.id;
  const [revision] = await stack.database.db
    .insert(noteRevisions)
    .values({
      noteId,
      revisionNumber: 1,
      originalFilename: 'note.txt',
      mediaType: 'text/plain',
      byteSize: 5,
      contentHash: 'a'.repeat(64),
      storageKey: `notes/${noteId}/revisions/${randomUUID()}/original`,
      status: 'ready',
      uploadedByUserId: owner.id,
      processedAt: new Date(),
    })
    .returning();
  if (!revision) throw new Error('revision insert failed');
  revisionId = revision.id;
  await stack.database.db
    .update(notes)
    .set({ currentRevisionId: revisionId })
    .where(eq(notes.id, noteId));
  await stack.database.db
    .insert(noteAssociations)
    .values({ noteId, knowledgeBaseId, createdByUserId: owner.id });

  const authService = new AuthService({
    store: createAuthStore(stack.database),
    email: { async sendMagicLink() {} },
    throttle: createAuthThrottle(stack.redis),
    webAppUrl: 'http://localhost:3000',
  });
  const knowledgeBaseService = new KnowledgeBaseService({
    store: createKnowledgeBaseStore(stack.database),
    email: { async sendInvitation() {} },
    webAppUrl: 'http://localhost:3000',
  });
  queue = createNoteRevisionQueue(stack.config.REDIS_URL);
  const noteService = new NoteService({
    store: createNoteStore(stack.database),
    storage: storageAdapter(stack.storage),
    scanner: createDevelopmentScanner(),
    queue: queue.revisions,
    processInline: true,
  });
  const relations = new RelationService({
    store: createRelationStore(stack.database),
    notes: noteService,
    webAppUrl: 'http://localhost:3000',
  });
  const lifecycle = new LifecycleService({ store: createLifecycleStore(stack.database) });
  const annotations = new AnnotationService({
    store: createAnnotationStore(stack.database),
    noteText: (userId, id, rev) => noteService.revisionText(userId, id, rev),
  });
  tokens = new AgentTokenService({ store: createAgentTokenStore(stack.database) });
  const control = new AgentControlService(
    { knowledgeBases: knowledgeBaseService, notes: noteService, annotations, relations, lifecycle },
    (agent, entry) =>
      tokens.audit(agent, entry.tool, entry.action, entry.subjectType, entry.subjectId),
  );
  app = startTestApi(testReadiness(stack), {
    auth: authService,
    knowledgeBases: knowledgeBaseService,
    notes: noteService,
    annotations,
    relations,
    lifecycle,
    agentTokens: tokens,
    mcp: { control, limiter: createAgentRateLimiter(stack.redis) },
  });
  baseUrl = await app.listen({ port: 0, host: '127.0.0.1' });
  writeToken = await token('writer', ['read', 'write']);
  readToken = await token('reader', ['read']);
  revokedToken = await token('revoked', ['read']);
  const listed = await app.inject({
    method: 'GET',
    url: '/agent-tokens',
    headers: auth(owner.session),
  });
  const revoked = (listed.json() as { tokens: { id: string; name: string }[] }).tokens.find(
    (item) => item.name === 'revoked',
  );
  if (!revoked) throw new Error('revoked token missing');
  await app.inject({
    method: 'DELETE',
    url: `/agent-tokens/${revoked.id}`,
    headers: auth(owner.session),
  });
}, 60_000);

afterAll(async () => {
  await app?.close();
  await queue?.close();
  await stack?.close();
});

describe('hosted MCP Agent control', () => {
  it('lists tools and Knowledge Bases through the MCP protocol', async () => {
    const client = await connect(writeToken);
    const tools = await client.listTools();
    expect(tools.tools.map((tool) => tool.name)).toEqual(
      expect.arrayContaining([
        'list_knowledge_bases',
        'create_comment',
        'create_mark',
        'create_note',
        'list_mark_types',
        'create_relation',
      ]),
    );
    const result = await client.callTool({ name: 'list_knowledge_bases', arguments: {} });
    expect(result.content).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: 'text' })]),
    );
    const text = (result.content as { type: string; text: string }[])[0]?.text ?? '';
    expect(text).toContain('MCP KB');
    const marks = await client.callTool({
      name: 'list_mark_types',
      arguments: { knowledgeBaseId },
    });
    expect((marks.content as { text: string }[])[0]?.text).toContain('core/highlight');
    await client.close();
  });

  it('creates a Note through MCP and audits the Agent write', async () => {
    const client = await connect(writeToken);
    const created = await client.callTool({
      name: 'create_note',
      arguments: {
        knowledgeBaseId,
        filename: 'agent.txt',
        mediaType: 'text/plain',
        title: 'Agent note',
        contentBase64: Buffer.from('hello from the agent').toString('base64'),
      },
    });
    expect(created.isError).not.toBe(true);
    expect((created.content as { text: string }[])[0]?.text).toContain('Agent note');
    const [audit] = await stack.database.db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, 'agent.note.create'));
    expect(audit?.metadata).toMatchObject({ agentName: 'writer' });
    await client.close();
  });

  it('enforces token scopes and role checks and records Agent writes', async () => {
    const reader = await connect(readToken);
    const denied = await reader.callTool({
      name: 'create_comment',
      arguments: {
        knowledgeBaseId,
        noteId,
        revisionId,
        body: 'should fail',
        anchor: {
          kind: 'text',
          exact: 'a',
          prefix: '',
          suffix: '',
          startOffset: 0,
          endOffset: 1,
          path: 'p',
        },
      },
    });
    expect(denied.isError).toBe(true);
    await reader.close();

    const writer = await connect(writeToken);
    const created = await writer.callTool({
      name: 'create_comment',
      arguments: {
        knowledgeBaseId,
        noteId,
        revisionId,
        body: 'Agent comment',
        anchor: {
          kind: 'text',
          exact: 'a',
          prefix: '',
          suffix: '',
          startOffset: 0,
          endOffset: 1,
          path: 'p',
        },
      },
    });
    expect(created.isError).not.toBe(true);
    const [audit] = await stack.database.db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, 'agent.comment.create'));
    expect(audit?.metadata).toMatchObject({ agentName: 'writer', tokenId: expect.any(String) });
    await writer.close();
  });

  it('rejects revoked tokens with HTTP 401', async () => {
    const response = await fetch(`${baseUrl}/mcp`, {
      method: 'POST',
      headers: { ...auth(revokedToken), 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
    });
    expect(response.status).toBe(401);
  });

  it('enforces per-token read and write windows', async () => {
    const limiter = createAgentRateLimiter(stack.redis);
    const first = await limiter.consume(randomUUID(), 'request', 1, 60);
    const second = await limiter.consume(randomUUID(), 'request', 1, 60);
    expect(first.allowed).toBe(true);
    expect(second.allowed).toBe(true);
    const key = randomUUID();
    expect((await limiter.consume(key, 'write', 1, 60)).allowed).toBe(true);
    const blocked = await limiter.consume(key, 'write', 1, 60);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
  });

  it('rejects expired tokens', async () => {
    const expired = await tokens.create(
      {
        id: owner.id,
        email: owner.email,
        displayName: owner.displayName,
        avatarUrl: null,
        createdAt: new Date().toISOString(),
      },
      { name: 'expired', scopes: ['read'] },
    );
    const listed = await app.inject({
      method: 'GET',
      url: '/agent-tokens',
      headers: auth(owner.session),
    });
    const row = (listed.json() as { tokens: { id: string; name: string }[] }).tokens.find(
      (item) => item.name === 'expired',
    );
    if (!row) throw new Error('expired token missing');
    await stack.database.db
      .update(agentTokensTable)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(agentTokensTable.id, row.id));
    const response = await fetch(`${baseUrl}/mcp`, {
      method: 'POST',
      headers: { ...auth(expired.token), 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
    });
    expect(response.status).toBe(401);
  });

  it('rejects invalid and role-incompatible writes', async () => {
    const response = await fetch(`${baseUrl}/mcp`, {
      method: 'POST',
      headers: {
        authorization: 'Bearer oln_agent_not-a-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
    });
    expect(response.status).toBe(401);
    await expect(connect(owner.session)).rejects.toBeTruthy();

    const outsiderToken = await tokens.create(
      {
        id: outsider.id,
        email: '',
        displayName: 'outsider',
        avatarUrl: null,
        createdAt: new Date().toISOString(),
      },
      { name: 'outsider-writer', scopes: ['read', 'write'] },
    );
    const outsiderClient = await connect(outsiderToken.token);
    const denied = await outsiderClient.callTool({
      name: 'trash_note',
      arguments: { knowledgeBaseId, noteId },
    });
    expect(denied.isError).toBe(true);
    await outsiderClient.close();
  });
});
