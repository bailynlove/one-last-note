import type {
  ContentReference,
  KnowledgeBaseRole,
  NoteRelation,
  RelationGraph,
  RelationNote,
  RelationOrigin,
  RelationType,
} from '@oln/domain';
import { isRelationType } from '@oln/domain';
import sanitizeHtml from 'sanitize-html';
import { AppError } from './errors';

const MAX_CONTENT_REFERENCES = 500;
const MAX_MANUAL_RELATIONS = 500;
const NOTE_PATH_PATTERN =
  /^\/notes\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/?$/i;
const MAX_SCAN_CHARS = 2_000_000;
const MAX_LINK_LENGTH = 4_000;

export interface RelationStore {
  findAccess(knowledgeBaseId: string, userId: string): Promise<KnowledgeBaseRole | null>;
  listNotes(knowledgeBaseId: string, revision?: string): Promise<RelationNote[]>;
  countNotes(knowledgeBaseId: string): Promise<number>;
  listRelations(knowledgeBaseId: string): Promise<NoteRelation[]>;
  countRelations(knowledgeBaseId: string): Promise<number>;
  create(input: {
    knowledgeBaseId: string;
    sourceNoteId: string;
    targetNoteId: string;
    type: RelationType;
    pairKey: string;
    userId: string;
    now: Date;
  }): Promise<NoteRelation>;
  remove(knowledgeBaseId: string, relationId: string): Promise<boolean>;
}

export interface RevisionSourceReader {
  revisionSource(userId: string, noteId: string, revisionId: string): Promise<string | null>;
}

export interface RelationFilter {
  revision?: string;
  type?: string;
  origin?: string;
  query?: string;
}

export interface RelationServiceOptions {
  store: RelationStore;
  notes: RevisionSourceReader;
  webAppUrl?: string;
  now?: () => Date;
}

function pairKey(type: RelationType, sourceNoteId: string, targetNoteId: string): string {
  if (type === 'related') {
    return [sourceNoteId, targetNoteId].sort().join(':');
  }
  return `${sourceNoteId}:${targetNoteId}`;
}

function notFound(): AppError {
  return new AppError('Relation not found.', { status: 404, title: 'Relation not found' });
}

function contextAround(text: string, index: number, length: number): string {
  return text
    .slice(Math.max(0, index - 60), Math.min(text.length, index + length + 60))
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160);
}

function maskedRanges(text: string): [number, number][] {
  const ranges: [number, number][] = [];
  let index = 0;
  while (index < text.length) {
    const candidates = ['```', '~~~', '<!--', '`']
      .map((marker) => ({ marker, at: text.indexOf(marker, index) }))
      .filter((candidate) => candidate.at >= 0)
      .sort((a, b) => a.at - b.at);
    const next = candidates[0];
    if (!next) break;
    const close = text.indexOf(next.marker, next.at + next.marker.length);
    if (close < 0) break;
    ranges.push([next.at, close + next.marker.length]);
    index = close + next.marker.length;
  }
  return ranges;
}

function isMasked(index: number, ranges: [number, number][]): boolean {
  return ranges.some(([start, end]) => index >= start && index < end);
}

function htmlLinks(text: string) {
  const links: { href: string; index: number; length: number }[] = [];
  let index = 0;
  while (index < text.length) {
    const at = text.indexOf('<a', index);
    if (at < 0) break;
    const next = text[at + 2];
    if (next && !/[\s>]/i.test(next)) {
      index = at + 2;
      continue;
    }
    const end = text.indexOf('>', at + 2);
    if (end < 0) break;
    const length = end + 1 - at;
    if (length > MAX_LINK_LENGTH) {
      index = end + 1;
      continue;
    }
    const tag = text.slice(at, end + 1);
    const match = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(tag);
    const href = match?.[1] ?? match?.[2] ?? match?.[3];
    if (href) links.push({ href, index: at, length });
    index = end + 1;
  }
  return links;
}

function markdownLinks(text: string, ranges: [number, number][]) {
  const links: { href: string; index: number; length: number }[] = [];
  let index = 0;
  while (index < text.length) {
    const open = text.indexOf('[', index);
    if (open < 0) break;
    if (isMasked(open, ranges)) {
      index = open + 1;
      continue;
    }
    const close = text.indexOf(']', open + 1);
    if (close < 0) break;
    if (text[close + 1] !== '(') {
      index = close + 1;
      continue;
    }
    const end = text.indexOf(')', close + 2);
    if (end < 0) break;
    if (end - close > MAX_LINK_LENGTH) {
      index = end + 1;
      continue;
    }
    const raw = text.slice(close + 2, end).trim();
    const href = raw.startsWith('<') && raw.endsWith('>') ? raw.slice(1, -1) : raw.split(/\s+/)[0];
    if (href) links.push({ href, index: open, length: end + 1 - open });
    index = end + 1;
  }
  return links;
}

export function extractContentReferences(input: {
  knowledgeBaseId: string;
  sourceNoteId: string;
  sourceRevisionId: string;
  sourceRevisionNumber: number;
  text: string;
  targetNoteIds: ReadonlySet<string>;
  webAppUrl?: string;
}): ContentReference[] {
  const found: ContentReference[] = [];
  const seen = new Set<string>();
  const base = new URL(input.webAppUrl ?? 'http://localhost:3000');
  // sanitize-html strips script/style/comments and unsafe attributes before link discovery.
  const sanitized = sanitizeHtml(input.text, {
    allowedTags: ['a'],
    allowedAttributes: { a: ['href'] },
  }).slice(0, MAX_SCAN_CHARS);
  const ranges = maskedRanges(sanitized);

  function addReference(rawHref: string, index: number, length: number): void {
    let url: URL;
    try {
      url = new URL(rawHref, base);
    } catch {
      return;
    }
    if (url.origin !== base.origin) return;
    const pathMatch = NOTE_PATH_PATTERN.exec(url.pathname);
    const targetNoteId = pathMatch?.[1]?.toLowerCase();
    if (!targetNoteId || targetNoteId === input.sourceNoteId) return;
    if (!input.targetNoteIds.has(targetNoteId)) return;
    if (seen.has(targetNoteId)) return;
    seen.add(targetNoteId);
    found.push({
      id: `content:${input.sourceRevisionId}:${targetNoteId}:${found.length}`,
      knowledgeBaseId: input.knowledgeBaseId,
      type: 'references',
      origin: 'content',
      sourceNoteId: input.sourceNoteId,
      sourceRevisionId: input.sourceRevisionId,
      sourceRevisionNumber: input.sourceRevisionNumber,
      targetNoteId,
      path: url.pathname,
      context: contextAround(sanitized, index, length),
    });
  }

  for (const link of htmlLinks(sanitized)) {
    addReference(link.href, link.index, link.length);
    if (found.length >= MAX_CONTENT_REFERENCES) return found;
  }
  for (const link of markdownLinks(sanitized, ranges)) {
    addReference(link.href, link.index, link.length);
    if (found.length >= MAX_CONTENT_REFERENCES) return found;
  }
  return found;
}

export class RelationService {
  private readonly now: () => Date;

  constructor(private readonly options: RelationServiceOptions) {
    this.now = options.now ?? (() => new Date());
  }

  async graph(
    userId: string,
    knowledgeBaseId: string,
    filter: RelationFilter = {},
  ): Promise<RelationGraph> {
    const role = await this.options.store.findAccess(knowledgeBaseId, userId);
    if (!role) {
      throw new AppError('Knowledge Base not found.', { status: 404, title: 'Not found' });
    }
    const [notes, noteCount] = await Promise.all([
      this.options.store.listNotes(knowledgeBaseId, filter.revision),
      this.options.store.countNotes(knowledgeBaseId),
    ]);
    const truncated = noteCount > notes.length;
    const noteIds = new Set(notes.map((note) => note.id));
    const relations = await this.options.store.listRelations(knowledgeBaseId);
    const references = await this.contentReferences(
      userId,
      knowledgeBaseId,
      notes,
      noteIds,
      filter.revision,
    );

    const type = filter.type && isRelationType(filter.type) ? filter.type : undefined;
    const origin: RelationOrigin | undefined =
      filter.origin === 'manual' || filter.origin === 'content' ? filter.origin : undefined;
    const query = filter.query?.trim().toLocaleLowerCase() ?? '';
    const titles = new Map(notes.map((note) => [note.id, note.title]));
    const visibleNoteIds = new Set(
      query
        ? notes
            .filter((note) => note.title.toLocaleLowerCase().includes(query))
            .map((note) => note.id)
        : notes.map((note) => note.id),
    );
    const keeps = (relationType: RelationType, source: string, target: string) => {
      if (type && relationType !== type) return false;
      return keepsQuery(source, target);
    };
    const keepsQuery = (source: string, target: string) => {
      if (!query) return true;
      if (!visibleNoteIds.has(source) || !visibleNoteIds.has(target)) return false;
      const sourceTitle = titles.get(source)?.toLocaleLowerCase() ?? '';
      const targetTitle = titles.get(target)?.toLocaleLowerCase() ?? '';
      return sourceTitle.includes(query) || targetTitle.includes(query);
    };

    return {
      knowledgeBaseId,
      notes: notes.filter((note) => visibleNoteIds.has(note.id)),
      relations:
        origin === 'content'
          ? []
          : relations.filter(
              (relation) =>
                noteIds.has(relation.sourceNoteId) &&
                noteIds.has(relation.targetNoteId) &&
                keeps(relation.type, relation.sourceNoteId, relation.targetNoteId),
            ),
      references:
        origin === 'manual' || (type && type !== 'references')
          ? []
          : references.filter((reference) =>
              keepsQuery(reference.sourceNoteId, reference.targetNoteId),
            ),
      revision: filter.revision === 'all' ? 'all' : (filter.revision ?? 'current'),
      truncated,
    };
  }

  async create(
    userId: string,
    knowledgeBaseId: string,
    input: { sourceNoteId: string; targetNoteId: string; type: string },
  ): Promise<NoteRelation> {
    await this.requireManager(knowledgeBaseId, userId);
    if (!isRelationType(input.type)) {
      throw new AppError('Unknown Relation type.', { status: 422, title: 'Invalid Relation' });
    }
    if (input.sourceNoteId === input.targetNoteId) {
      throw new AppError('A Note cannot relate to itself.', {
        status: 422,
        title: 'Invalid Relation',
      });
    }
    const [notes, relationCount] = await Promise.all([
      this.options.store.listNotes(knowledgeBaseId, 'all'),
      this.options.store.countRelations(knowledgeBaseId),
    ]);
    if (relationCount >= MAX_MANUAL_RELATIONS) {
      throw new AppError('This Knowledge Base has reached its Relation limit.', {
        status: 409,
        title: 'Relation limit reached',
      });
    }
    const noteIds = new Set(notes.map((note) => note.id));
    if (!noteIds.has(input.sourceNoteId) || !noteIds.has(input.targetNoteId)) {
      throw new AppError('Both Notes must belong to this Knowledge Base.', {
        status: 422,
        title: 'Invalid Relation',
      });
    }
    try {
      return await this.options.store.create({
        knowledgeBaseId,
        sourceNoteId: input.sourceNoteId,
        targetNoteId: input.targetNoteId,
        type: input.type,
        pairKey: pairKey(input.type, input.sourceNoteId, input.targetNoteId),
        userId,
        now: this.now(),
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new AppError('That Relation already exists.', {
          status: 409,
          title: 'Duplicate Relation',
        });
      }
      throw error;
    }
  }

  async remove(userId: string, knowledgeBaseId: string, relationId: string): Promise<void> {
    await this.requireManager(knowledgeBaseId, userId);
    if (!(await this.options.store.remove(knowledgeBaseId, relationId))) {
      throw notFound();
    }
  }

  private async requireManager(knowledgeBaseId: string, userId: string): Promise<void> {
    const role = await this.options.store.findAccess(knowledgeBaseId, userId);
    if (!role) throw notFound();
    if (role !== 'owner' && role !== 'manager') {
      throw new AppError('Only Owners and Managers can change Relations.', {
        status: 403,
        title: 'Forbidden',
      });
    }
  }

  private async contentReferences(
    userId: string,
    knowledgeBaseId: string,
    notes: RelationNote[],
    noteIds: ReadonlySet<string>,
    revisionFilter?: string,
  ): Promise<ContentReference[]> {
    const references: ContentReference[] = [];
    for (const note of notes) {
      const revisions =
        revisionFilter && revisionFilter !== 'current' && revisionFilter !== 'all'
          ? note.revisions.filter((revision) => revision.id === revisionFilter)
          : revisionFilter === 'all'
            ? note.revisions
            : note.revisions.filter((revision) => revision.id === note.currentRevisionId);
      for (const revision of revisions) {
        const text = await this.options.notes.revisionSource(userId, note.id, revision.id);
        if (!text) continue;
        references.push(
          ...extractContentReferences({
            knowledgeBaseId,
            sourceNoteId: note.id,
            sourceRevisionId: revision.id,
            sourceRevisionNumber: revision.number,
            text,
            targetNoteIds: noteIds,
            webAppUrl: this.options.webAppUrl,
          }),
        );
        if (references.length >= MAX_CONTENT_REFERENCES) return references;
      }
    }
    return references;
  }
}

function isUniqueViolation(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  if ('code' in error && (error as { code?: unknown }).code === '23505') return true;
  return 'cause' in error && isUniqueViolation((error as { cause?: unknown }).cause);
}
