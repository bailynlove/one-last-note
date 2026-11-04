import type {
  Annotation,
  KnowledgeBaseSummary,
  Note,
  NoteRelation,
  RelationGraph,
} from '@oln/domain';
import type { AuthenticatedAgent } from './agent-tokens';
import type { AnnotationService } from './annotations';
import { AppError } from './errors';
import type { KnowledgeBaseService } from './knowledge-bases';
import type { LifecycleService } from './lifecycle';
import type { NoteService } from './notes';
import type { RelationService } from './relations';

export interface AgentControlServiceOptions {
  knowledgeBases: KnowledgeBaseService;
  notes: NoteService;
  annotations: AnnotationService;
  relations: RelationService;
  lifecycle: LifecycleService;
}

interface WriteAudit {
  tool: string;
  action: string;
  subjectType: string;
  subjectId: string | null;
}

export class AgentControlService {
  constructor(
    private readonly options: AgentControlServiceOptions,
    private readonly audit: (agent: AuthenticatedAgent, entry: WriteAudit) => Promise<void>,
  ) {}

  private read(agent: AuthenticatedAgent): void {
    if (!agent.token.scopes.includes('read')) {
      throw new AppError('This Agent token cannot read.', { status: 403, title: 'Missing scope' });
    }
  }

  private write(agent: AuthenticatedAgent): void {
    if (!agent.token.scopes.includes('write')) {
      throw new AppError('This Agent token cannot write.', { status: 403, title: 'Missing scope' });
    }
  }

  private async mutate<T>(
    agent: AuthenticatedAgent,
    entry: WriteAudit,
    operation: () => Promise<T>,
  ): Promise<T> {
    this.write(agent);
    const result = await operation();
    await this.audit(agent, entry);
    return result;
  }

  async listKnowledgeBases(agent: AuthenticatedAgent): Promise<KnowledgeBaseSummary[]> {
    this.read(agent);
    return this.options.knowledgeBases.list(agent.user);
  }

  async getKnowledgeBase(agent: AuthenticatedAgent, knowledgeBaseId: string) {
    this.read(agent);
    return this.options.knowledgeBases.get(agent.user, knowledgeBaseId);
  }

  async listNotes(agent: AuthenticatedAgent, knowledgeBaseId: string): Promise<unknown[]> {
    this.read(agent);
    return this.options.notes.listNotes(agent.user.id, knowledgeBaseId);
  }

  async getNote(agent: AuthenticatedAgent, noteId: string): Promise<Note> {
    this.read(agent);
    return this.options.notes.getNote(agent.user.id, noteId);
  }

  async getRevisionText(
    agent: AuthenticatedAgent,
    noteId: string,
    revisionId: string,
  ): Promise<{ text: string | null }> {
    this.read(agent);
    return { text: await this.options.notes.revisionText(agent.user.id, noteId, revisionId) };
  }

  async listComments(
    agent: AuthenticatedAgent,
    knowledgeBaseId: string,
    noteId: string,
    currentRevisionId?: string,
  ): Promise<Annotation[]> {
    this.read(agent);
    return this.options.annotations.list(agent.user, knowledgeBaseId, noteId, {
      ...(currentRevisionId ? { currentRevisionId } : {}),
    });
  }

  async listMarkTypes(agent: AuthenticatedAgent, knowledgeBaseId: string) {
    this.read(agent);
    return this.options.annotations.listMarkTypes(agent.user.id, knowledgeBaseId);
  }

  async listRelations(
    agent: AuthenticatedAgent,
    knowledgeBaseId: string,
    filter: {
      revision?: string;
      type?: string;
      origin?: 'manual' | 'content' | 'all';
      q?: string;
    },
  ): Promise<RelationGraph> {
    this.read(agent);
    return this.options.relations.graph(agent.user.id, knowledgeBaseId, filter);
  }

  async listTrash(agent: AuthenticatedAgent, knowledgeBaseId: string) {
    this.read(agent);
    return this.options.lifecycle.listAssociationTrash(agent.user.id, knowledgeBaseId);
  }

  async createComment(
    agent: AuthenticatedAgent,
    input: {
      knowledgeBaseId: string;
      noteId: string;
      revisionId: string;
      body: string;
      anchor: unknown;
    },
  ): Promise<Annotation> {
    return this.mutate(
      agent,
      {
        tool: 'create_comment',
        action: 'comment.create',
        subjectType: 'note',
        subjectId: input.noteId,
      },
      () =>
        this.options.annotations.create(agent.user, input.knowledgeBaseId, input.noteId, {
          revisionId: input.revisionId,
          kind: 'comment',
          body: input.body,
          anchor: input.anchor,
          agentName: agent.token.name,
        }),
    );
  }

  async createMark(
    agent: AuthenticatedAgent,
    input: {
      knowledgeBaseId: string;
      noteId: string;
      revisionId: string;
      markType?: string;
      payload?: Record<string, unknown>;
      anchor: unknown;
    },
  ): Promise<Annotation> {
    return this.mutate(
      agent,
      { tool: 'create_mark', action: 'mark.create', subjectType: 'note', subjectId: input.noteId },
      () =>
        this.options.annotations.create(agent.user, input.knowledgeBaseId, input.noteId, {
          revisionId: input.revisionId,
          kind: 'mark',
          markType: input.markType,
          payload: input.payload,
          anchor: input.anchor,
          agentName: agent.token.name,
        }),
    );
  }

  async replyComment(
    agent: AuthenticatedAgent,
    input: {
      knowledgeBaseId: string;
      noteId: string;
      parentId: string;
      body: string;
    },
  ): Promise<Annotation> {
    return this.mutate(
      agent,
      {
        tool: 'reply_comment',
        action: 'comment.reply',
        subjectType: 'note',
        subjectId: input.noteId,
      },
      () =>
        this.options.annotations.reply(
          agent.user,
          input.knowledgeBaseId,
          input.noteId,
          input.parentId,
          input.body,
        ),
    );
  }

  async updateNoteTitle(agent: AuthenticatedAgent, noteId: string, title: string): Promise<Note> {
    return this.mutate(
      agent,
      { tool: 'update_note_title', action: 'note.update', subjectType: 'note', subjectId: noteId },
      () => this.options.notes.updateTitle(agent.user.id, noteId, title),
    );
  }

  async trashNote(
    agent: AuthenticatedAgent,
    knowledgeBaseId: string,
    noteId: string,
  ): Promise<unknown> {
    return this.mutate(
      agent,
      { tool: 'trash_note', action: 'note.trash', subjectType: 'note', subjectId: noteId },
      () => this.options.lifecycle.trashAssociation(agent.user.id, noteId, knowledgeBaseId),
    );
  }

  async restoreNote(
    agent: AuthenticatedAgent,
    knowledgeBaseId: string,
    noteId: string,
  ): Promise<unknown> {
    return this.mutate(
      agent,
      { tool: 'restore_note', action: 'note.restore', subjectType: 'note', subjectId: noteId },
      () => this.options.lifecycle.restoreAssociation(agent.user.id, noteId, knowledgeBaseId),
    );
  }

  async createNote(
    agent: AuthenticatedAgent,
    input: {
      knowledgeBaseId: string;
      filename: string;
      mediaType: string;
      title?: string;
      contentBase64: string;
    },
  ): Promise<Note> {
    const bytes = decodeBase64(input.contentBase64);
    return this.mutate(
      agent,
      {
        tool: 'create_note',
        action: 'note.create',
        subjectType: 'knowledge_base',
        subjectId: input.knowledgeBaseId,
      },
      () =>
        this.options.notes.upload(agent.user.id, [input.knowledgeBaseId], {
          filename: input.filename,
          mediaType: input.mediaType,
          bytes,
          ...(input.title ? { title: input.title } : {}),
        }),
    );
  }

  async replaceNoteRevision(
    agent: AuthenticatedAgent,
    input: {
      noteId: string;
      filename: string;
      mediaType: string;
      contentBase64: string;
    },
  ): Promise<Note> {
    const bytes = decodeBase64(input.contentBase64);
    return this.mutate(
      agent,
      {
        tool: 'replace_revision',
        action: 'note.replace',
        subjectType: 'note',
        subjectId: input.noteId,
      },
      () =>
        this.options.notes.replace(agent.user.id, input.noteId, {
          filename: input.filename,
          mediaType: input.mediaType,
          bytes,
        }),
    );
  }

  async createRelation(
    agent: AuthenticatedAgent,
    input: {
      knowledgeBaseId: string;
      sourceNoteId: string;
      targetNoteId: string;
      type: string;
    },
  ): Promise<NoteRelation> {
    return this.mutate(
      agent,
      {
        tool: 'create_relation',
        action: 'relation.create',
        subjectType: 'note',
        subjectId: input.sourceNoteId,
      },
      () =>
        this.options.relations.create(agent.user.id, input.knowledgeBaseId, {
          sourceNoteId: input.sourceNoteId,
          targetNoteId: input.targetNoteId,
          type: input.type,
        }),
    );
  }

  async deleteRelation(
    agent: AuthenticatedAgent,
    knowledgeBaseId: string,
    relationId: string,
  ): Promise<{ deleted: true }> {
    return this.mutate(
      agent,
      {
        tool: 'delete_relation',
        action: 'relation.delete',
        subjectType: 'relation',
        subjectId: relationId,
      },
      async () => {
        await this.options.relations.remove(agent.user.id, knowledgeBaseId, relationId);
        return { deleted: true as const };
      },
    );
  }
}

function decodeBase64(value: string): Uint8Array {
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(value) || value.length > 34_000_000) {
    throw new AppError('contentBase64 is not a valid 25 MB base64 payload.', { status: 400 });
  }
  const bytes = Uint8Array.from(Buffer.from(value, 'base64'));
  if (bytes.byteLength === 0 || bytes.byteLength > 25 * 1024 * 1024) {
    throw new AppError('Note content must be between 1 byte and 25 MB.', { status: 400 });
  }
  return bytes;
}
