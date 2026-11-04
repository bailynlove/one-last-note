import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {
  type AgentControlService,
  type AgentTokenService,
  AppError,
  type AuthenticatedAgent,
} from '@oln/application';
import {
  AGENT_RATE_LIMIT,
  AGENT_RATE_WINDOW_SECONDS,
  AGENT_WRITE_LIMIT,
  type AgentTokenSummary,
} from '@oln/domain';
import type { AgentRateLimiter } from '@oln/infrastructure';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

interface McpOptions {
  tokens: AgentTokenService;
  control: AgentControlService;
  limiter: AgentRateLimiter;
}

function text(value: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }] };
}

function toolError(error: unknown) {
  const message = error instanceof AppError ? error.message : 'The Agent command failed.';
  return { isError: true, content: [{ type: 'text' as const, text: message }] };
}

function bearer(request: { headers: { authorization?: string } }): string | null {
  const header = request.headers.authorization;
  if (!header?.startsWith('Bearer ')) return null;
  return header.slice('Bearer '.length).trim() || null;
}

function scopes(token: AgentTokenSummary): string[] {
  return token.scopes;
}

export function registerMcpRoute(app: FastifyInstance, options: McpOptions): void {
  app.post('/mcp', { bodyLimit: 40 * 1024 * 1024 }, async (request, reply) => {
    const raw = bearer(request);
    if (!raw) {
      return reply.code(401).send({ error: 'Missing Agent token.' });
    }
    let agent: AuthenticatedAgent;
    try {
      agent = await options.tokens.authenticate(raw);
    } catch {
      return reply.code(401).send({ error: 'Invalid or expired Agent token.' });
    }
    const requestLimit = await options.limiter.consume(
      agent.token.id,
      'request',
      AGENT_RATE_LIMIT,
      AGENT_RATE_WINDOW_SECONDS,
    );
    if (!requestLimit.allowed) {
      return reply
        .code(429)
        .header('retry-after', String(requestLimit.retryAfterSeconds))
        .send({ error: 'Agent request limit exceeded.' });
    }
    await options.tokens.touch(agent);

    const server = new McpServer({ name: 'one-last-note', version: '1.0.0' });
    const write = async <T>(_tool: string, operation: () => Promise<T>): Promise<T> => {
      const limit = await options.limiter.consume(
        agent.token.id,
        'write',
        AGENT_WRITE_LIMIT,
        AGENT_RATE_WINDOW_SECONDS,
      );
      if (!limit.allowed) {
        throw new AppError('Agent write limit exceeded.', {
          status: 429,
          title: 'Too many writes',
        });
      }
      return operation();
    };
    const run = async <T>(_tool: string, operation: () => Promise<T>) => {
      try {
        return text(await operation());
      } catch (error) {
        return toolError(error);
      }
    };

    server.registerTool(
      'get_current_user',
      { description: 'Show the delegating User, Agent token name, and scopes.' },
      async () =>
        run('get_current_user', async () => ({
          user: agent.user,
          token: { name: agent.token.name, scopes: scopes(agent.token) },
        })),
    );

    server.registerTool(
      'list_knowledge_bases',
      { description: 'List Knowledge Bases the delegating User can access.' },
      async () => run('list_knowledge_bases', () => options.control.listKnowledgeBases(agent)),
    );

    server.registerTool(
      'get_knowledge_base',
      {
        description: 'Get one Knowledge Base and the delegating User role.',
        inputSchema: { knowledgeBaseId: z.uuid() },
      },
      async ({ knowledgeBaseId }) =>
        run('get_knowledge_base', () => options.control.getKnowledgeBase(agent, knowledgeBaseId)),
    );

    server.registerTool(
      'list_notes',
      {
        description: 'List Notes in a Knowledge Base.',
        inputSchema: { knowledgeBaseId: z.uuid() },
      },
      async ({ knowledgeBaseId }) =>
        run('list_notes', () => options.control.listNotes(agent, knowledgeBaseId)),
    );

    server.registerTool(
      'get_note',
      {
        description: 'Get a Note with its immutable Revisions and associations.',
        inputSchema: { noteId: z.uuid() },
      },
      async ({ noteId }) => run('get_note', () => options.control.getNote(agent, noteId)),
    );

    server.registerTool(
      'get_revision_text',
      {
        description: 'Read the text of a ready Revision.',
        inputSchema: { noteId: z.uuid(), revisionId: z.uuid() },
      },
      async ({ noteId, revisionId }) =>
        run('get_revision_text', () => options.control.getRevisionText(agent, noteId, revisionId)),
    );

    server.registerTool(
      'list_comments',
      {
        description: 'List anchored Comments and Marks for a Note.',
        inputSchema: {
          knowledgeBaseId: z.uuid(),
          noteId: z.uuid(),
          currentRevisionId: z.uuid().optional(),
        },
      },
      async ({ knowledgeBaseId, noteId, currentRevisionId }) =>
        run('list_comments', () =>
          options.control.listComments(agent, knowledgeBaseId, noteId, currentRevisionId),
        ),
    );

    server.registerTool(
      'list_mark_types',
      {
        description: 'List built-in and enabled App Extension Mark capability descriptors.',
        inputSchema: { knowledgeBaseId: z.uuid() },
      },
      async ({ knowledgeBaseId }) =>
        run('list_mark_types', () => options.control.listMarkTypes(agent, knowledgeBaseId)),
    );

    server.registerTool(
      'list_relations',
      {
        description: 'Read the Knowledge Base relation graph.',
        inputSchema: {
          knowledgeBaseId: z.uuid(),
          revision: z.string().max(40).optional(),
          type: z.string().max(40).optional(),
          origin: z.enum(['manual', 'content', 'all']).optional(),
          q: z.string().max(120).optional(),
        },
      },
      async ({ knowledgeBaseId, revision, type, origin, q }) =>
        run('list_relations', () =>
          options.control.listRelations(agent, knowledgeBaseId, {
            ...(revision ? { revision } : {}),
            ...(type ? { type } : {}),
            ...(origin ? { origin } : {}),
            ...(q ? { q } : {}),
          }),
        ),
    );

    server.registerTool(
      'list_trash',
      {
        description: 'List trashed Note associations in a Knowledge Base.',
        inputSchema: { knowledgeBaseId: z.uuid() },
      },
      async ({ knowledgeBaseId }) =>
        run('list_trash', () => options.control.listTrash(agent, knowledgeBaseId)),
    );

    server.registerTool(
      'create_comment',
      {
        description: 'Create an anchored Comment as the delegating User.',
        inputSchema: {
          knowledgeBaseId: z.uuid(),
          noteId: z.uuid(),
          revisionId: z.uuid(),
          body: z.string().min(1).max(4000),
          anchor: z.record(z.string(), z.unknown()),
        },
      },
      async ({ knowledgeBaseId, noteId, revisionId, body, anchor }) =>
        run('create_comment', () =>
          write('create_comment', () =>
            options.control.createComment(agent, {
              knowledgeBaseId,
              noteId,
              revisionId,
              body,
              anchor,
            }),
          ),
        ),
    );

    server.registerTool(
      'create_mark',
      {
        description: 'Create an anchored Mark, including an enabled App Extension Mark type.',
        inputSchema: {
          knowledgeBaseId: z.uuid(),
          noteId: z.uuid(),
          revisionId: z.uuid(),
          markType: z.string().max(120).optional(),
          payload: z.record(z.string(), z.unknown()).optional(),
          anchor: z.record(z.string(), z.unknown()),
        },
      },
      async ({ knowledgeBaseId, noteId, revisionId, markType, payload, anchor }) =>
        run('create_mark', () =>
          write('create_mark', () =>
            options.control.createMark(agent, {
              knowledgeBaseId,
              noteId,
              revisionId,
              ...(markType ? { markType } : {}),
              ...(payload ? { payload } : {}),
              anchor,
            }),
          ),
        ),
    );

    server.registerTool(
      'reply_comment',
      {
        description: 'Reply to a root Comment (one level only).',
        inputSchema: {
          knowledgeBaseId: z.uuid(),
          noteId: z.uuid(),
          parentId: z.uuid(),
          body: z.string().min(1).max(4000),
        },
      },
      async ({ knowledgeBaseId, noteId, parentId, body }) =>
        run('reply_comment', () =>
          write('reply_comment', () =>
            options.control.replyComment(agent, { knowledgeBaseId, noteId, parentId, body }),
          ),
        ),
    );

    server.registerTool(
      'update_note_title',
      {
        description: 'Rename a Note (requires Manager in at least one association).',
        inputSchema: { noteId: z.uuid(), title: z.string().min(1).max(200) },
      },
      async ({ noteId, title }) =>
        run('update_note_title', () =>
          write('update_note_title', () => options.control.updateNoteTitle(agent, noteId, title)),
        ),
    );

    server.registerTool(
      'trash_note',
      {
        description: 'Move a Note association to Trash.',
        inputSchema: { knowledgeBaseId: z.uuid(), noteId: z.uuid() },
      },
      async ({ knowledgeBaseId, noteId }) =>
        run('trash_note', () =>
          write('trash_note', () => options.control.trashNote(agent, knowledgeBaseId, noteId)),
        ),
    );

    server.registerTool(
      'restore_note',
      {
        description: 'Restore a Note association from Trash.',
        inputSchema: { knowledgeBaseId: z.uuid(), noteId: z.uuid() },
      },
      async ({ knowledgeBaseId, noteId }) =>
        run('restore_note', () =>
          write('restore_note', () => options.control.restoreNote(agent, knowledgeBaseId, noteId)),
        ),
    );

    server.registerTool(
      'create_note',
      {
        description: 'Create a Note Revision from base64 content.',
        inputSchema: {
          knowledgeBaseId: z.uuid(),
          filename: z.string().min(1).max(255),
          mediaType: z.string().min(1).max(120),
          title: z.string().min(1).max(200).optional(),
          contentBase64: z.string().min(1).max(34_000_000),
        },
      },
      async ({ knowledgeBaseId, filename, mediaType, title, contentBase64 }) =>
        run('create_note', () =>
          write('create_note', () =>
            options.control.createNote(agent, {
              knowledgeBaseId,
              filename,
              mediaType,
              ...(title ? { title } : {}),
              contentBase64,
            }),
          ),
        ),
    );

    server.registerTool(
      'replace_revision',
      {
        description: 'Add a new immutable Revision from base64 content.',
        inputSchema: {
          noteId: z.uuid(),
          filename: z.string().min(1).max(255),
          mediaType: z.string().min(1).max(120),
          contentBase64: z.string().min(1).max(34_000_000),
        },
      },
      async ({ noteId, filename, mediaType, contentBase64 }) =>
        run('replace_revision', () =>
          write('replace_revision', () =>
            options.control.replaceNoteRevision(agent, {
              noteId,
              filename,
              mediaType,
              contentBase64,
            }),
          ),
        ),
    );

    server.registerTool(
      'create_relation',
      {
        description: 'Create a manual Note Relation.',
        inputSchema: {
          knowledgeBaseId: z.uuid(),
          sourceNoteId: z.uuid(),
          targetNoteId: z.uuid(),
          type: z.enum(['related', 'references', 'supersedes']),
        },
      },
      async ({ knowledgeBaseId, sourceNoteId, targetNoteId, type }) =>
        run('create_relation', () =>
          write('create_relation', () =>
            options.control.createRelation(agent, {
              knowledgeBaseId,
              sourceNoteId,
              targetNoteId,
              type,
            }),
          ),
        ),
    );

    server.registerTool(
      'delete_relation',
      {
        description: 'Delete a manual Note Relation.',
        inputSchema: { knowledgeBaseId: z.uuid(), relationId: z.uuid() },
      },
      async ({ knowledgeBaseId, relationId }) =>
        run('delete_relation', () =>
          write('delete_relation', () =>
            options.control.deleteRelation(agent, knowledgeBaseId, relationId),
          ),
        ),
    );

    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    reply.hijack();
    try {
      await server.connect(transport);
      await transport.handleRequest(request.raw, reply.raw, request.body);
    } catch (error) {
      request.log.error({ error }, 'MCP request failed');
      if (!reply.raw.headersSent) {
        reply.raw.writeHead(500, { 'content-type': 'application/json' });
        reply.raw.end(
          JSON.stringify({
            jsonrpc: '2.0',
            error: { code: -32603, message: 'Internal error' },
            id: null,
          }),
        );
      }
    }
    reply.raw.on('close', () => {
      void transport.close();
      void server.close();
    });
  });

  app.get('/mcp', async (_request, reply) => {
    return reply
      .code(405)
      .header('allow', 'POST')
      .send({ error: 'Use POST for Streamable HTTP MCP.' });
  });
  app.delete('/mcp', async (_request, reply) => {
    return reply.code(405).header('allow', 'POST').send({ error: 'Stateless MCP has no session.' });
  });
}
