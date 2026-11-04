import { createHash, randomUUID } from 'node:crypto';
import {
  KNOWLEDGE_BASE_STORAGE_BYTES,
  MAX_ORIGINAL_BYTES,
  type Note,
  type NoteProcessingState,
  type NoteRevision,
  type NoteSource,
  type NoteSummary,
} from '@oln/domain';
import { AppError } from './errors';
import { renderRevision } from './renderers';

const TEXT_MEDIA_TYPES = new Set(['text/html', 'text/markdown', 'text/plain']);

const ARCHIVE_EXTENSIONS = new Set([
  'zip',
  'rar',
  '7z',
  'tar',
  'gz',
  'tgz',
  'bz2',
  'xz',
  'docx',
  'xlsx',
  'pptx',
]);

interface OriginalKind {
  mediaType: string;
  extension: string;
  signature: 'pdf' | 'png' | 'jpeg' | 'gif' | 'webp' | 'text';
}

const ORIGINALS: Record<string, OriginalKind> = {
  pdf: { mediaType: 'application/pdf', extension: 'pdf', signature: 'pdf' },
  png: { mediaType: 'image/png', extension: 'png', signature: 'png' },
  jpg: { mediaType: 'image/jpeg', extension: 'jpg', signature: 'jpeg' },
  jpeg: { mediaType: 'image/jpeg', extension: 'jpeg', signature: 'jpeg' },
  gif: { mediaType: 'image/gif', extension: 'gif', signature: 'gif' },
  webp: { mediaType: 'image/webp', extension: 'webp', signature: 'webp' },
  md: { mediaType: 'text/markdown', extension: 'md', signature: 'text' },
  markdown: { mediaType: 'text/markdown', extension: 'markdown', signature: 'text' },
  txt: { mediaType: 'text/plain', extension: 'txt', signature: 'text' },
  html: { mediaType: 'text/html', extension: 'html', signature: 'text' },
  htm: { mediaType: 'text/html', extension: 'htm', signature: 'text' },
};

const MIME_ALIASES: Record<string, string> = {
  'image/jpg': 'image/jpeg',
  'text/x-markdown': 'text/markdown',
  'application/x-pdf': 'application/pdf',
};

export class UploadValidationError extends Error {
  constructor(
    readonly code: string,
    readonly safeMessage: string,
  ) {
    super(safeMessage);
    this.name = 'UploadValidationError';
  }
}

export class QuotaExceededError extends Error {
  constructor() {
    super('Knowledge Base storage quota exceeded');
    this.name = 'QuotaExceededError';
  }
}

export interface StoredRevision extends NoteRevision {
  storageKey: string;
}

export interface NoteStore {
  findRole(knowledgeBaseId: string, userId: string): Promise<'owner' | 'manager' | 'viewer' | null>;
  findNote(noteId: string): Promise<Note | null>;
  listNotes(knowledgeBaseId: string): Promise<NoteSummary[]>;
  findRevision(revisionId: string): Promise<StoredRevision | null>;
  createNote(input: CreateNoteInput): Promise<Note>;
  addRevision(input: AddRevisionInput): Promise<Note>;
  attachAssociation(input: AttachAssociationInput): Promise<void>;
  updateTitle(noteId: string, title: string, now: Date): Promise<Note | null>;
  completeRevision(input: {
    revisionId: string;
    status: NoteProcessingState;
    statusDetail: string | null;
    now: Date;
  }): Promise<void>;
}

export interface CreateNoteInput {
  noteId: string;
  revisionId: string;
  title: string;
  knowledgeBaseIds: string[];
  userId: string;
  originalFilename: string;
  mediaType: string;
  byteSize: number;
  contentHash: string;
  storageKey: string;
  status: NoteProcessingState;
  statusDetail: string | null;
  source?: NoteSource;
  quotaBytes: number;
  now: Date;
}

export interface AddRevisionInput {
  noteId: string;
  revisionId: string;
  userId: string;
  originalFilename: string;
  mediaType: string;
  byteSize: number;
  contentHash: string;
  storageKey: string;
  status: NoteProcessingState;
  statusDetail: string | null;
  quotaBytes: number;
  now: Date;
}

export interface AttachAssociationInput {
  noteId: string;
  knowledgeBaseId: string;
  userId: string;
  quotaBytes: number;
  now: Date;
}

export interface NoteStorage {
  put(key: string, bytes: Uint8Array, contentType: string): Promise<void>;
  get(key: string): Promise<Uint8Array>;
  delete(key: string): Promise<void>;
}

export interface MalwareScanner {
  scan(bytes: Uint8Array, mediaType: string): Promise<{ clean: boolean; detail?: string }>;
}

export interface RevisionQueue {
  enqueueRevision(revisionId: string): Promise<void>;
}

export interface NoteLogger {
  error(context: object, message: string): void;
}

export interface NoteServiceOptions {
  store: NoteStore;
  storage: NoteStorage;
  scanner: MalwareScanner;
  queue?: RevisionQueue;
  now?: () => Date;
  maxOriginalBytes?: number;
  quotaBytes?: number;
  processInline?: boolean;
  logger?: NoteLogger;
}

export interface CapturedNoteInput {
  knowledgeBaseId: string;
  title: string;
  html: string;
  source: NoteSource;
  additionalBytes?: number;
}

export interface UploadOriginal {
  filename: string;
  mediaType: string;
  bytes: Uint8Array;
  title?: string;
}

export interface DownloadedOriginal {
  revision: StoredRevision;
  bytes: Uint8Array;
}

export class NoteService {
  private readonly now: () => Date;
  private readonly maxOriginalBytes: number;
  private readonly quotaBytes: number;

  constructor(private readonly options: NoteServiceOptions) {
    this.now = options.now ?? (() => new Date());
    this.maxOriginalBytes = options.maxOriginalBytes ?? MAX_ORIGINAL_BYTES;
    this.quotaBytes = options.quotaBytes ?? KNOWLEDGE_BASE_STORAGE_BYTES;
  }

  async listNotes(userId: string, knowledgeBaseId: string): Promise<NoteSummary[]> {
    if (!(await this.options.store.findRole(knowledgeBaseId, userId))) {
      throw notFound();
    }
    return this.options.store.listNotes(knowledgeBaseId);
  }

  async getNote(userId: string, noteId: string): Promise<Note> {
    const note = await this.requireNote(userId, noteId);
    return publicNote(note);
  }

  async upload(
    userId: string,
    knowledgeBaseIds: string[],
    original: UploadOriginal,
  ): Promise<Note> {
    const uniqueKnowledgeBaseIds = [...new Set(knowledgeBaseIds)];
    if (uniqueKnowledgeBaseIds.length === 0) {
      throw new AppError('Choose at least one Knowledge Base.', {
        status: 400,
        title: 'Upload rejected',
      });
    }
    for (const knowledgeBaseId of uniqueKnowledgeBaseIds) {
      await this.requireManager(knowledgeBaseId, userId);
    }

    const inspected = this.inspectForStorage(original);
    const noteId = randomUUID();
    const revisionId = randomUUID();
    const storageKey = storageKeyFor(noteId, revisionId);
    const now = this.now();
    const title = cleanTitle(original.title ?? titleFromFilename(original.filename));
    const mediaType = inspected.kind?.mediaType ?? normaliseMediaType(original.mediaType);

    await this.options.storage.put(
      storageKey,
      original.bytes,
      mediaType || 'application/octet-stream',
    );
    try {
      await this.options.store.createNote({
        noteId,
        revisionId,
        title,
        knowledgeBaseIds: uniqueKnowledgeBaseIds,
        userId,
        originalFilename: safeFilename(original.filename),
        mediaType,
        byteSize: original.bytes.length,
        contentHash: hashBytes(original.bytes),
        storageKey,
        status: inspected.error ? 'rejected' : 'quarantined',
        statusDetail: inspected.error?.code ?? null,
        quotaBytes: this.quotaBytes,
        now,
      });
    } catch (error) {
      // A failed commit may still have committed; deleting here could destroy a live Revision.
      this.options.logger?.error(
        { err: error, storageKey },
        'note storage cleanup skipped after write failure',
      );
      throw this.mapStoreError(error);
    }

    if (!inspected.error) {
      await this.releaseOrQueue(revisionId);
    }
    return publicNote(await this.requireNote(userId, noteId));
  }

  async replace(userId: string, noteId: string, original: UploadOriginal): Promise<Note> {
    const note = await this.requireNote(userId, noteId);
    await this.requireManagerForAny(userId, note);

    const inspected = this.inspectForStorage(original);
    const revisionId = randomUUID();
    const storageKey = storageKeyFor(noteId, revisionId);
    const now = this.now();
    const mediaType = inspected.kind?.mediaType ?? normaliseMediaType(original.mediaType);

    await this.options.storage.put(
      storageKey,
      original.bytes,
      mediaType || 'application/octet-stream',
    );
    try {
      await this.options.store.addRevision({
        noteId,
        revisionId,
        userId,
        originalFilename: safeFilename(original.filename),
        mediaType,
        byteSize: original.bytes.length,
        contentHash: hashBytes(original.bytes),
        storageKey,
        status: inspected.error ? 'rejected' : 'quarantined',
        statusDetail: inspected.error?.code ?? null,
        quotaBytes: this.quotaBytes,
        now,
      });
    } catch (error) {
      this.options.logger?.error(
        { err: error, storageKey },
        'note storage cleanup skipped after write failure',
      );
      throw this.mapStoreError(error);
    }

    if (!inspected.error) {
      await this.releaseOrQueue(revisionId);
    }
    return publicNote(await this.requireNote(userId, noteId));
  }

  async createCapturedNote(
    userId: string,
    input: CapturedNoteInput,
  ): Promise<{ note: Note; revisionId: string }> {
    await this.requireManager(input.knowledgeBaseId, userId);
    const bytes = new TextEncoder().encode(input.html);
    const byteSize = bytes.length + Math.max(0, input.additionalBytes ?? 0);
    if (bytes.length > this.maxOriginalBytes) {
      throw new AppError('The captured page is too large to store.', {
        status: 413,
        title: 'Capture too large',
      });
    }
    const noteId = randomUUID();
    const revisionId = randomUUID();
    const storageKey = storageKeyFor(noteId, revisionId);
    const now = this.now();
    const title = cleanTitle(input.title);
    const filename = `${
      title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .slice(0, 80) || 'capture'
    }.html`;

    await this.options.storage.put(storageKey, bytes, 'text/html');
    try {
      await this.options.store.createNote({
        noteId,
        revisionId,
        title,
        knowledgeBaseIds: [input.knowledgeBaseId],
        userId,
        originalFilename: filename,
        mediaType: 'text/html',
        byteSize,
        contentHash: hashBytes(bytes),
        storageKey,
        status: 'ready',
        statusDetail: null,
        source: input.source,
        quotaBytes: this.quotaBytes,
        now,
      });
    } catch (error) {
      this.options.logger?.error(
        { err: error, storageKey },
        'captured note storage cleanup skipped after write failure',
      );
      throw this.mapStoreError(error);
    }
    return { note: publicNote(await this.requireNote(userId, noteId)), revisionId };
  }

  async attachToKnowledgeBase(
    userId: string,
    noteId: string,
    sourceKnowledgeBaseId: string,
    targetKnowledgeBaseId: string,
  ): Promise<Note> {
    await this.requireManager(sourceKnowledgeBaseId, userId);
    await this.requireManager(targetKnowledgeBaseId, userId);
    const note = await this.requireNote(userId, noteId);
    if (
      !note.associations.some(
        (association) => association.knowledgeBaseId === sourceKnowledgeBaseId,
      )
    ) {
      throw notFound();
    }
    try {
      await this.options.store.attachAssociation({
        noteId,
        knowledgeBaseId: targetKnowledgeBaseId,
        userId,
        quotaBytes: this.quotaBytes,
        now: this.now(),
      });
    } catch (error) {
      throw this.mapStoreError(error);
    }
    return publicNote(await this.requireNote(userId, noteId));
  }

  async updateTitle(userId: string, noteId: string, title: string): Promise<Note> {
    const note = await this.requireNote(userId, noteId);
    await this.requireManagerForAny(userId, note);
    const updated = await this.options.store.updateTitle(noteId, cleanTitle(title), this.now());
    if (!updated) {
      throw notFound();
    }
    return publicNote(updated);
  }

  async get(userId: string, noteId: string): Promise<Note> {
    return publicNote(await this.requireNote(userId, noteId));
  }

  async download(userId: string, noteId: string, revisionId: string): Promise<DownloadedOriginal> {
    const note = await this.requireNote(userId, noteId);
    const revision = note.revisions.find((item) => item.id === revisionId);
    if (!revision) {
      throw notFound();
    }
    if (revision.status !== 'ready') {
      throw new AppError('This Revision is not available yet.', {
        status: 409,
        title: 'Revision unavailable',
      });
    }
    const stored = await this.options.store.findRevision(revisionId);
    if (!stored) {
      throw notFound();
    }
    return { revision: stored, bytes: await this.options.storage.get(stored.storageKey) };
  }

  async revisionText(userId: string, noteId: string, revisionId: string): Promise<string | null> {
    const note = await this.requireNote(userId, noteId);
    const revision = note.revisions.find((item) => item.id === revisionId);
    if (revision?.status !== 'ready') {
      return null;
    }
    const stored = await this.options.store.findRevision(revisionId);
    if (!stored) {
      return null;
    }
    const bytes = await this.options.storage.get(stored.storageKey);
    const rendered = renderRevision({
      filename: revision.originalFilename,
      mediaType: revision.mediaType,
      bytes,
    });
    return rendered.text ?? null;
  }

  async revisionSource(userId: string, noteId: string, revisionId: string): Promise<string | null> {
    const note = await this.requireNote(userId, noteId);
    const revision = note.revisions.find((item) => item.id === revisionId);
    if (revision?.status !== 'ready') return null;
    if (!TEXT_MEDIA_TYPES.has(revision.mediaType.split(';')[0]?.trim() ?? '')) return null;
    const stored = await this.options.store.findRevision(revisionId);
    if (!stored) return null;
    return new TextDecoder().decode(await this.options.storage.get(stored.storageKey));
  }

  async processRevision(revisionId: string): Promise<void> {
    const revision = await this.options.store.findRevision(revisionId);
    if (revision?.status !== 'quarantined') {
      return;
    }
    try {
      const bytes = await this.options.storage.get(revision.storageKey);
      inspectOriginal(revision.originalFilename, revision.mediaType, bytes, this.maxOriginalBytes);
      const result = await this.options.scanner.scan(bytes, revision.mediaType);
      if (!result.clean) {
        await this.complete(revisionId, 'rejected', 'malware_detected');
        return;
      }
      await this.complete(revisionId, 'ready', null);
    } catch (error) {
      if (error instanceof UploadValidationError) {
        await this.complete(revisionId, 'rejected', error.code);
        return;
      }
      this.options.logger?.error({ err: error, revisionId }, 'revision processing failed');
      throw error;
    }
  }

  async markRevisionFailed(revisionId: string, detail = 'scan_unavailable'): Promise<void> {
    const revision = await this.options.store.findRevision(revisionId);
    if (revision?.status === 'quarantined') {
      await this.complete(revisionId, 'rejected', detail);
    }
  }

  private async releaseOrQueue(revisionId: string): Promise<void> {
    if (this.options.processInline) {
      try {
        await this.processRevision(revisionId);
      } catch (error) {
        this.options.logger?.error({ err: error, revisionId }, 'inline revision processing failed');
        await this.markRevisionFailed(revisionId).catch(() => undefined);
      }
      return;
    }
    try {
      await this.options.queue?.enqueueRevision(revisionId);
    } catch (error) {
      this.options.logger?.error({ err: error, revisionId }, 'revision enqueue failed');
      await this.markRevisionFailed(revisionId).catch(() => undefined);
    }
  }

  private async complete(
    revisionId: string,
    status: NoteProcessingState,
    statusDetail: string | null,
  ): Promise<void> {
    await this.options.store.completeRevision({
      revisionId,
      status,
      statusDetail,
      now: this.now(),
    });
  }

  private inspectForStorage(original: UploadOriginal): {
    error: UploadValidationError | null;
    kind: OriginalKind | null;
  } {
    try {
      const kind = inspectOriginal(
        original.filename,
        original.mediaType,
        original.bytes,
        this.maxOriginalBytes,
      );
      return { error: null, kind };
    } catch (error) {
      if (!(error instanceof UploadValidationError)) {
        throw error;
      }
      if (error.code === 'file_too_large') {
        throw new AppError(error.safeMessage, { status: 413, title: 'File too large' });
      }
      return { error, kind: null };
    }
  }

  private async requireNote(userId: string, noteId: string): Promise<Note> {
    const note = await this.options.store.findNote(noteId);
    if (!note) {
      throw notFound();
    }
    for (const association of note.associations) {
      if (await this.options.store.findRole(association.knowledgeBaseId, userId)) {
        return note;
      }
    }
    throw notFound();
  }

  private async requireManagerForAny(userId: string, note: Note): Promise<void> {
    for (const association of note.associations) {
      if (await isManager(this.options.store, association.knowledgeBaseId, userId)) {
        return;
      }
    }
    throw new AppError('Managers can change Notes.', { status: 403, title: 'Forbidden' });
  }

  private async requireManager(knowledgeBaseId: string, userId: string): Promise<void> {
    if (!(await isManager(this.options.store, knowledgeBaseId, userId))) {
      throw new AppError('Managers can change Notes.', { status: 403, title: 'Forbidden' });
    }
  }

  private mapStoreError(error: unknown): unknown {
    return error instanceof QuotaExceededError
      ? new AppError('This Knowledge Base is out of storage space.', {
          status: 413,
          title: 'Storage quota exceeded',
        })
      : error;
  }
}

async function isManager(
  store: NoteStore,
  knowledgeBaseId: string,
  userId: string,
): Promise<boolean> {
  const role = await store.findRole(knowledgeBaseId, userId);
  return role === 'owner' || role === 'manager';
}

export function inspectOriginal(
  filename: string,
  declaredMediaType: string,
  bytes: Uint8Array,
  maxBytes = MAX_ORIGINAL_BYTES,
): OriginalKind {
  if (bytes.length === 0) {
    throw new UploadValidationError('empty_file', 'The file is empty.');
  }
  if (bytes.length > maxBytes) {
    throw new UploadValidationError(
      'file_too_large',
      `The original file must be ${Math.floor(maxBytes / (1024 * 1024))} MB or smaller.`,
    );
  }

  const safeName = safeFilename(filename);
  const extension = safeName.includes('.') ? (safeName.split('.').at(-1)?.toLowerCase() ?? '') : '';
  if (ARCHIVE_EXTENSIONS.has(extension)) {
    throw new UploadValidationError('archive_not_allowed', 'Archives are not accepted.');
  }
  const kind = ORIGINALS[extension];
  if (!kind) {
    throw new UploadValidationError(
      'unsupported_type',
      'Accepted originals are PDF, Markdown, text, HTML, PNG, JPEG, GIF, and WebP.',
    );
  }

  if (looksLikeArchive(bytes)) {
    throw new UploadValidationError('archive_not_allowed', 'Archives are not accepted.');
  }

  const declared = normaliseMediaType(declaredMediaType);
  if (declared && declared !== 'application/octet-stream' && declared !== kind.mediaType) {
    throw new UploadValidationError(
      'mime_mismatch',
      'The declared file type does not match this file.',
    );
  }

  if (kind.signature === 'text' && !isUtf8Text(bytes)) {
    throw new UploadValidationError('invalid_text', 'Text files must be valid UTF-8.');
  }
  if (!matchesSignature(kind.signature, bytes)) {
    throw new UploadValidationError(
      'signature_mismatch',
      'The file contents do not match its extension.',
    );
  }

  if (kind.signature === 'pdf' && isEncryptedPdf(bytes)) {
    throw new UploadValidationError('encrypted_pdf', 'Encrypted PDFs are not accepted.');
  }
  return kind;
}

function matchesSignature(signature: OriginalKind['signature'], bytes: Uint8Array): boolean {
  switch (signature) {
    case 'pdf':
      return startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d]);
    case 'png':
      return startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    case 'jpeg':
      return startsWith(bytes, [0xff, 0xd8, 0xff]);
    case 'gif':
      return startsWith(bytes, [0x47, 0x49, 0x46, 0x38]);
    case 'webp':
      return (
        startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) &&
        bytes[8] === 0x57 &&
        bytes[9] === 0x45 &&
        bytes[10] === 0x42 &&
        bytes[11] === 0x50
      );
    case 'text':
      return isUtf8Text(bytes);
  }
}

function isUtf8Text(bytes: Uint8Array): boolean {
  if (bytes.includes(0)) {
    return false;
  }
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return true;
  } catch {
    return false;
  }
}

function looksLikeArchive(bytes: Uint8Array): boolean {
  return (
    startsWith(bytes, [0x50, 0x4b, 0x03, 0x04]) ||
    startsWith(bytes, [0x1f, 0x8b]) ||
    startsWith(bytes, [0x52, 0x61, 0x72, 0x21]) ||
    startsWith(bytes, [0x37, 0x7a, 0xbc, 0xaf]) ||
    (bytes.length > 262 && startsWith(bytes.subarray(257), [0x75, 0x73, 0x74, 0x61, 0x72]))
  );
}

function isEncryptedPdf(bytes: Uint8Array): boolean {
  const tail = bytes.subarray(Math.max(0, bytes.length - 65_536));
  return /\/Encrypt\b/.test(new TextDecoder('latin1').decode(tail));
}

function startsWith(bytes: Uint8Array, prefix: number[]): boolean {
  if (bytes.length < prefix.length) {
    return false;
  }
  return prefix.every((value, index) => bytes[index] === value);
}

function normaliseMediaType(value: string): string {
  const mediaType = value.split(';')[0]?.trim().toLowerCase() ?? '';
  return MIME_ALIASES[mediaType] ?? mediaType;
}

function safeFilename(filename: string): string {
  const basename = filename.replaceAll('\\', '/').split('/').at(-1)?.trim() ?? '';
  return (basename || 'untitled').slice(0, 255);
}

function titleFromFilename(filename: string): string {
  const name = safeFilename(filename);
  return name.includes('.') ? name.slice(0, name.lastIndexOf('.')) : name;
}

function cleanTitle(title: string): string {
  const cleaned = title.trim().replaceAll(/\s+/g, ' ');
  return (cleaned || 'Untitled Note').slice(0, 200);
}

export function storageKeyFor(noteId: string, revisionId: string): string {
  return `notes/${noteId}/revisions/${revisionId}/original`;
}

function publicNote(note: Note): Note {
  return {
    ...note,
    revisions: note.revisions.map((revision) => {
      const { storageKey: _storageKey, ...publicRevision } = revision as StoredRevision;
      return publicRevision;
    }),
  };
}

export function hashBytes(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function notFound(): AppError {
  return new AppError('That Note is not available.', { status: 404, title: 'Not found' });
}
