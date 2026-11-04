import {
  type Annotation,
  type AnnotationAnchor,
  HIGHLIGHT_MARK_TYPE,
  isMarkType,
  type KnowledgeBaseRole,
  type MarkTypeDescriptor,
} from '@oln/domain';
import { AppError } from './errors';
import { type MarkTypeReader, markTypesFor, validateMarkPayload } from './mark-types';

const MAX_BODY_LENGTH = 4_000;
const MAX_EXACT_LENGTH = 2_000;
const MAX_CONTEXT_LENGTH = 200;
const MAX_PATH_LENGTH = 1_000;

export interface AnnotationStore {
  findAccess(
    knowledgeBaseId: string,
    noteId: string,
    userId: string,
  ): Promise<{ role: KnowledgeBaseRole } | null>;
  findKnowledgeBaseRole(
    knowledgeBaseId: string,
    userId: string,
  ): Promise<{ role: KnowledgeBaseRole } | null>;
  hasRevision(noteId: string, revisionId: string): Promise<boolean>;
  list(knowledgeBaseId: string, noteId: string): Promise<Annotation[]>;
  find(knowledgeBaseId: string, noteId: string, annotationId: string): Promise<Annotation | null>;
  create(input: {
    knowledgeBaseId: string;
    noteId: string;
    revisionId: string;
    parentId: string | null;
    authorUserId: string;
    kind: 'comment' | 'mark';
    markType: string | null;
    payload: Record<string, unknown> | null;
    body: string | null;
    agentName: string | null;
    anchor: AnnotationAnchor;
    now: Date;
  }): Promise<Annotation>;
  updateBody(
    knowledgeBaseId: string,
    noteId: string,
    annotationId: string,
    body: string,
    now: Date,
  ): Promise<Annotation | null>;
  softDelete(
    knowledgeBaseId: string,
    noteId: string,
    annotationId: string,
    now: Date,
  ): Promise<void>;
  hardDeleteIfUnthreaded(
    knowledgeBaseId: string,
    noteId: string,
    annotationId: string,
  ): Promise<boolean>;
}

export interface AnnotationServiceOptions {
  store: AnnotationStore;
  noteText?: (userId: string, noteId: string, revisionId: string) => Promise<string | null>;
  markTypes?: MarkTypeReader;
  now?: () => Date;
}

export interface CreateAnnotationInput {
  revisionId: string;
  kind: 'comment' | 'mark';
  body?: string | null;
  markType?: string | null;
  payload?: unknown;
  agentName?: string | null;
  anchor: unknown;
}

export interface AnnotationListOptions {
  currentRevisionId?: string;
}

/**
 * Conservative hybrid match: exact text plus surrounding context, never a guess.
 * Returns the updated anchor only when the passage resolves to one confident location.
 */
export function reanchorText(anchor: AnnotationAnchor, text: string): AnnotationAnchor | null {
  if (anchor.kind !== 'text' || !anchor.exact) {
    return null;
  }
  const locations: number[] = [];
  let from = 0;
  while (from <= text.length) {
    const index = text.indexOf(anchor.exact, from);
    if (index === -1) break;
    locations.push(index);
    from = index + 1;
  }

  const contextual = locations.filter((index) => {
    const before = text.slice(Math.max(0, index - anchor.prefix.length), index);
    const after = text.slice(index + anchor.exact.length);
    return before.endsWith(anchor.prefix) && after.startsWith(anchor.suffix);
  });
  const hasContext = Boolean(anchor.prefix || anchor.suffix);
  const candidates = contextual.length > 0 ? contextual : hasContext ? [] : locations;
  if (candidates.length !== 1) {
    return null;
  }
  const startOffset = candidates[0] as number;
  return {
    ...anchor,
    startOffset,
    endOffset: startOffset + anchor.exact.length,
  };
}

function fail(message: string, status = 400, title = 'Invalid annotation'): never {
  throw new AppError(message, { status, title });
}

function readPayload(value: unknown): Record<string, unknown> {
  if (value === undefined || value === null) return {};
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new AppError('Mark payload must be an object.', {
      status: 422,
      title: 'Invalid Mark payload',
    });
  }
  return value as Record<string, unknown>;
}

function readBody(value: string | null | undefined): string {
  const body = value?.trim() ?? '';
  if (!body) fail('Write a Comment before posting.');
  if (body.length > MAX_BODY_LENGTH) fail('Comments are limited to 4000 characters.');
  return body;
}

function readAnchor(value: unknown): AnnotationAnchor {
  if (typeof value !== 'object' || value === null || !('kind' in value)) {
    fail('Select a passage or PDF region first.');
  }
  const candidate = value as Record<string, unknown>;
  if (candidate.kind === 'text') {
    const exact = typeof candidate.exact === 'string' ? candidate.exact.trim() : '';
    const prefix = typeof candidate.prefix === 'string' ? candidate.prefix : '';
    const suffix = typeof candidate.suffix === 'string' ? candidate.suffix : '';
    const path = typeof candidate.path === 'string' ? candidate.path : '';
    const startOffset = candidate.startOffset;
    const endOffset = candidate.endOffset;
    if (!exact || exact.length > MAX_EXACT_LENGTH) {
      fail('The selected passage is not a valid anchor.');
    }
    if (prefix.length > MAX_CONTEXT_LENGTH || suffix.length > MAX_CONTEXT_LENGTH) {
      fail('The selected passage context is too long.');
    }
    if (path.length > MAX_PATH_LENGTH) fail('The selected passage path is too long.');
    if (
      typeof startOffset !== 'number' ||
      typeof endOffset !== 'number' ||
      !Number.isInteger(startOffset) ||
      !Number.isInteger(endOffset) ||
      startOffset < 0 ||
      endOffset < startOffset
    ) {
      fail('The selected passage offsets are invalid.');
    }
    if (endOffset - startOffset !== exact.length) {
      fail('The selected passage offsets do not match the quote.');
    }
    return { kind: 'text', exact, prefix, suffix, startOffset, endOffset, path };
  }
  if (candidate.kind === 'pdf') {
    const rect = candidate.rect;
    if (
      typeof candidate.page !== 'number' ||
      !Number.isInteger(candidate.page) ||
      candidate.page < 1 ||
      candidate.page > 10_000 ||
      typeof rect !== 'object' ||
      rect === null
    ) {
      fail('The PDF region is invalid.');
    }
    const { x, y, width, height } = rect as Record<string, unknown>;
    if (
      typeof x !== 'number' ||
      typeof y !== 'number' ||
      typeof width !== 'number' ||
      typeof height !== 'number' ||
      x < 0 ||
      y < 0 ||
      width <= 0 ||
      height <= 0 ||
      x + width > 1.001 ||
      y + height > 1.001
    ) {
      fail('The PDF region coordinates are invalid.');
    }
    return {
      kind: 'pdf',
      page: candidate.page,
      rect: { x, y, width, height },
    };
  }
  fail('The annotation anchor type is not supported.');
}

function isModerator(role: KnowledgeBaseRole): boolean {
  return role === 'owner' || role === 'manager';
}

export class AnnotationService {
  private readonly now: () => Date;

  constructor(private readonly options: AnnotationServiceOptions) {
    this.now = options.now ?? (() => new Date());
  }

  private async requireAccess(
    userId: string,
    knowledgeBaseId: string,
    noteId: string,
  ): Promise<KnowledgeBaseRole> {
    const access = await this.options.store.findAccess(knowledgeBaseId, noteId, userId);
    if (!access) fail('This Note is not available in that Knowledge Base.', 404, 'Not found');
    return access.role;
  }

  async list(
    user: { id: string },
    knowledgeBaseId: string,
    noteId: string,
    options: AnnotationListOptions = {},
  ): Promise<Annotation[]> {
    await this.requireAccess(user.id, knowledgeBaseId, noteId);
    if (
      options.currentRevisionId &&
      !(await this.options.store.hasRevision(noteId, options.currentRevisionId))
    ) {
      fail('Choose a Revision from this Note.', 400, 'Invalid Revision');
    }
    const annotations = await this.options.store.list(knowledgeBaseId, noteId);
    const currentText =
      options.currentRevisionId && this.options.noteText
        ? await this.options.noteText(user.id, noteId, options.currentRevisionId)
        : null;
    if (options.currentRevisionId) {
      for (const annotation of annotations) {
        if (annotation.parentId || annotation.deleted) continue;
        if (annotation.revisionId === options.currentRevisionId) {
          annotation.needsReview = false;
          continue;
        }
        if (!currentText) continue;
        if (annotation.anchor.kind !== 'text') {
          annotation.needsReview = true;
          continue;
        }
        const moved = reanchorText(annotation.anchor, currentText);
        if (moved) {
          annotation.anchor = moved;
          annotation.needsReview = false;
        } else {
          annotation.needsReview = true;
        }
      }
    }
    const roots = annotations.filter((annotation) => !annotation.parentId);
    const replies = annotations.filter((annotation) => annotation.parentId);
    for (const root of roots) {
      root.replies = replies.filter((reply) => reply.parentId === root.id);
      for (const reply of root.replies) {
        if (reply.deleted) reply.body = null;
      }
      if (root.deleted) root.body = null;
    }
    return roots.filter((root) => !root.deleted || root.replies.length > 0);
  }

  async listMarkTypes(userId: string, knowledgeBaseId: string): Promise<MarkTypeDescriptor[]> {
    const access = await this.options.store.findKnowledgeBaseRole(knowledgeBaseId, userId);
    if (!access) fail('This Knowledge Base is not available.', 404, 'Not found');
    return markTypesFor(
      this.options.markTypes ? await this.options.markTypes.markTypes(userId, knowledgeBaseId) : [],
    );
  }

  private async markTypes(userId: string, knowledgeBaseId: string): Promise<MarkTypeDescriptor[]> {
    return this.listMarkTypes(userId, knowledgeBaseId);
  }

  async create(
    user: { id: string },
    knowledgeBaseId: string,
    noteId: string,
    input: CreateAnnotationInput,
  ): Promise<Annotation> {
    await this.requireAccess(user.id, knowledgeBaseId, noteId);
    if (!(await this.options.store.hasRevision(noteId, input.revisionId))) {
      fail('Choose a Revision from this Note.', 400, 'Invalid Revision');
    }
    const anchor = readAnchor(input.anchor);
    const kind = input.kind;
    if (kind === 'comment') {
      return this.options.store.create({
        knowledgeBaseId,
        noteId,
        revisionId: input.revisionId,
        parentId: null,
        authorUserId: user.id,
        kind,
        markType: null,
        payload: null,
        body: readBody(input.body),
        agentName: input.agentName ?? null,
        anchor,
        now: this.now(),
      });
    }
    if (kind === 'mark') {
      if (input.body?.trim()) fail('Marks cannot contain comment text.');
      const markType = input.markType ?? HIGHLIGHT_MARK_TYPE;
      if (!isMarkType(markType)) fail('Mark types use a namespaced name, e.g. core/highlight.');
      const definitions = await this.markTypes(user.id, knowledgeBaseId);
      const definition = definitions.find((item) => item.type === markType);
      if (!definition) fail('That Mark type is not available in this Knowledge Base.', 422);
      const payload = readPayload(input.payload ?? definition.defaultPayload);
      const error = validateMarkPayload(definition, payload);
      if (error) fail(error, 422, 'Invalid Mark payload');
      return this.options.store.create({
        knowledgeBaseId,
        noteId,
        revisionId: input.revisionId,
        parentId: null,
        authorUserId: user.id,
        kind,
        markType,
        payload,
        body: null,
        agentName: input.agentName ?? null,
        anchor,
        now: this.now(),
      });
    }
    fail('The annotation type is not supported.');
  }

  async reply(
    user: { id: string },
    knowledgeBaseId: string,
    noteId: string,
    parentId: string,
    body: string,
  ): Promise<Annotation> {
    await this.requireAccess(user.id, knowledgeBaseId, noteId);
    const parent = await this.options.store.find(knowledgeBaseId, noteId, parentId);
    if (!parent || parent.deleted) fail('That Comment is not available.', 404, 'Not found');
    if (parent.kind !== 'comment') fail('Marks cannot have replies.');
    if (parent.parentId) fail('Replies can only be one level deep.');
    return this.options.store.create({
      knowledgeBaseId,
      noteId,
      revisionId: parent.revisionId,
      parentId: parent.id,
      authorUserId: user.id,
      kind: 'comment',
      markType: null,
      payload: null,
      body: readBody(body),
      agentName: null,
      anchor: parent.anchor,
      now: this.now(),
    });
  }

  async update(
    user: { id: string },
    knowledgeBaseId: string,
    noteId: string,
    annotationId: string,
    body: string,
  ): Promise<Annotation> {
    await this.requireAccess(user.id, knowledgeBaseId, noteId);
    const annotation = await this.options.store.find(knowledgeBaseId, noteId, annotationId);
    if (!annotation || annotation.deleted) fail('That Comment is not available.', 404, 'Not found');
    if (annotation.author.id !== user.id) fail('Only the author can edit this Comment.', 403);
    if (annotation.kind !== 'comment') fail('Marks cannot be edited.');
    const updated = await this.options.store.updateBody(
      knowledgeBaseId,
      noteId,
      annotationId,
      readBody(body),
      this.now(),
    );
    if (!updated) fail('That Comment is not available.', 404, 'Not found');
    return updated;
  }

  async remove(
    user: { id: string },
    knowledgeBaseId: string,
    noteId: string,
    annotationId: string,
  ): Promise<void> {
    const role = await this.requireAccess(user.id, knowledgeBaseId, noteId);
    const annotation = await this.options.store.find(knowledgeBaseId, noteId, annotationId);
    if (!annotation) fail('That Annotation is not available.', 404, 'Not found');
    if (annotation.author.id !== user.id && !isModerator(role)) {
      fail('You cannot delete this Annotation.', 403);
    }
    const now = this.now();
    if (await this.options.store.hardDeleteIfUnthreaded(knowledgeBaseId, noteId, annotation.id)) {
      return;
    }
    await this.options.store.softDelete(knowledgeBaseId, noteId, annotation.id, now);
  }
}
