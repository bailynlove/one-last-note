import { createHash } from 'node:crypto';
import {
  CAPTURE_MEDIA_BYTES,
  CAPTURE_MEDIA_TOTAL_BYTES,
  CAPTURE_PAGE_BYTES,
  CAPTURE_SELECTION_BYTES,
  CAPTURE_TIMEOUT_MS,
  type CaptureAttempt,
  type CaptureDuplicate,
  type CaptureStatus,
} from '@oln/domain';
import {
  type CaptureMedia,
  extractPage,
  provenanceHtml,
  rewriteMedia,
  sanitizeCaptureHtml,
  selectionHtml,
} from './capture-html';
import { canonicalizeUrl, isPublicHttpUrl } from './capture-url';
import { AppError } from './errors';
import type { NoteService } from './notes';

export interface CaptureResource {
  url: string;
  contentType: string;
  bytes: Uint8Array;
}

export interface CaptureFetcher {
  fetch(url: string, signal?: AbortSignal): Promise<CaptureResource>;
}

export interface CaptureStore {
  findRole(knowledgeBaseId: string, userId: string): Promise<'owner' | 'manager' | 'viewer' | null>;
  findAttempt(id: string): Promise<CaptureAttempt | null>;
  findAttemptByKey(
    userId: string,
    knowledgeBaseId: string,
    key: string,
  ): Promise<CaptureAttempt | null>;
  findDuplicate(
    knowledgeBaseId: string,
    canonicalUrl: string,
    excludeNoteId?: string,
  ): Promise<CaptureDuplicate | null>;
  createAttempt(input: CreateCaptureAttemptInput): Promise<CaptureAttempt>;
  claimAttempt(id: string, now: Date): Promise<CaptureAttempt | null>;
  failAttempt(id: string, code: string, detail: string, now: Date): Promise<void>;
  setMediaKeys(id: string, keys: string[]): Promise<void>;
  listMediaKeys(id: string): Promise<string[]>;
  updateAttempt(id: string, patch: CaptureAttemptPatch): Promise<CaptureAttempt | null>;
}

export interface CreateCaptureAttemptInput {
  knowledgeBaseId: string;
  userId: string;
  url: string;
  canonicalUrl: string;
  selectionHtml: string | null;
  selectionText: string | null;
  duplicateOf: CaptureDuplicate | null;
  idempotencyKey: string | null;
  now: Date;
}

export interface CaptureAttemptPatch {
  status?: CaptureStatus;
  canonicalUrl?: string | null;
  noteId?: string | null;
  revisionId?: string | null;
  duplicateOf?: CaptureDuplicate | null;
  errorCode?: string | null;
  errorDetail?: string | null;
  completedAt?: Date | null;
  updatedAt: Date;
}

export interface CaptureQueue {
  enqueueCapture(attemptId: string): Promise<void>;
}

export interface CaptureStorage {
  put(key: string, bytes: Uint8Array, contentType: string): Promise<void>;
  get(key: string): Promise<Uint8Array>;
  delete(key: string): Promise<void>;
}

export interface CaptureScanner {
  scan(bytes: Uint8Array, mediaType: string): Promise<{ clean: boolean; detail?: string }>;
}

export interface CaptureLogger {
  info(context: object, message: string): void;
  error(context: object, message: string): void;
}

export interface CaptureServiceOptions {
  store: CaptureStore;
  fetcher: CaptureFetcher;
  queue: CaptureQueue;
  notes: NoteService;
  storage: CaptureStorage;
  scanner: CaptureScanner;
  logger?: CaptureLogger;
  now?: () => Date;
}

export class CaptureLimitError extends Error {
  constructor(readonly reason: 'rate' | 'active') {
    super(reason === 'rate' ? 'Too many captures' : 'Too many active captures');
    this.name = 'CaptureLimitError';
  }
}

class CaptureFailure extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'CaptureFailure';
  }
}

export interface CreateCaptureInput {
  url: string;
  selectionHtml?: string | null;
  selectionText?: string | null;
  idempotencyKey?: string | null;
}

function utf8(bytes: Uint8Array): string {
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
}

function imageType(bytes: Uint8Array): { contentType: string; extension: string } | null {
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return { contentType: 'image/png', extension: 'png' };
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { contentType: 'image/jpeg', extension: 'jpg' };
  }
  if (bytes.length >= 6 && utf8(bytes.subarray(0, 6)) === 'GIF87a') {
    return { contentType: 'image/gif', extension: 'gif' };
  }
  if (bytes.length >= 6 && utf8(bytes.subarray(0, 6)) === 'GIF89a') {
    return { contentType: 'image/gif', extension: 'gif' };
  }
  if (
    bytes.length >= 12 &&
    utf8(bytes.subarray(0, 4)) === 'RIFF' &&
    utf8(bytes.subarray(8, 12)) === 'WEBP'
  ) {
    return { contentType: 'image/webp', extension: 'webp' };
  }
  return null;
}

const CONTENT_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
};

export class CaptureService {
  private readonly now: () => Date;

  constructor(private readonly options: CaptureServiceOptions) {
    this.now = options.now ?? (() => new Date());
  }

  async create(
    userId: string,
    knowledgeBaseId: string,
    input: CreateCaptureInput,
  ): Promise<{ attempt: CaptureAttempt; duplicateOf: CaptureDuplicate | null }> {
    const role = await this.options.store.findRole(knowledgeBaseId, userId);
    if (role !== 'owner' && role !== 'manager') {
      throw new AppError('Managers can capture pages into a Knowledge Base.', {
        status: 403,
        title: 'Not allowed',
      });
    }
    if (!isPublicHttpUrl(input.url)) {
      throw new AppError('Enter a public http or https URL.', {
        status: 400,
        title: 'Capture rejected',
      });
    }
    const selectionBytes = new TextEncoder().encode(
      `${input.selectionHtml ?? ''}${input.selectionText ?? ''}`,
    ).length;
    if (selectionBytes > CAPTURE_SELECTION_BYTES) {
      throw new AppError('The selected passage is too large to capture.', {
        status: 413,
        title: 'Capture too large',
      });
    }
    if (input.idempotencyKey && input.idempotencyKey.length > 200) {
      throw new AppError('The idempotency key is too long.', {
        status: 400,
        title: 'Capture rejected',
      });
    }

    if (input.idempotencyKey) {
      const existing = await this.options.store.findAttemptByKey(
        userId,
        knowledgeBaseId,
        input.idempotencyKey,
      );
      if (existing) return { attempt: existing, duplicateOf: existing.duplicateOf };
    }

    const canonicalUrl = canonicalizeUrl(input.url);
    const duplicateOf = await this.options.store.findDuplicate(knowledgeBaseId, canonicalUrl);
    const attempt = await this.options.store.createAttempt({
      knowledgeBaseId,
      userId,
      url: input.url,
      canonicalUrl,
      selectionHtml: input.selectionHtml?.slice(0, CAPTURE_SELECTION_BYTES) ?? null,
      selectionText: input.selectionText?.slice(0, CAPTURE_SELECTION_BYTES) ?? null,
      duplicateOf,
      idempotencyKey: input.idempotencyKey ?? null,
      now: this.now(),
    });
    try {
      await this.options.queue.enqueueCapture(attempt.id);
    } catch (error) {
      this.options.logger?.error(
        { err: error, attemptId: attempt.id },
        'capture queue unavailable',
      );
      await this.options.store.failAttempt(
        attempt.id,
        'queue_unavailable',
        'The capture could not be queued. Try again.',
        this.now(),
      );
      return {
        attempt: { ...attempt, status: 'failed', errorCode: 'queue_unavailable' },
        duplicateOf,
      };
    }
    return { attempt, duplicateOf };
  }

  async get(userId: string, attemptId: string): Promise<CaptureAttempt> {
    const attempt = await this.requireAttempt(userId, attemptId);
    const role = await this.options.store.findRole(attempt.knowledgeBaseId, userId);
    if (!role) throw notFound();
    return attempt;
  }

  async retry(userId: string, attemptId: string): Promise<CaptureAttempt> {
    const attempt = await this.requireAttempt(userId, attemptId);
    if (attempt.status === 'ready') return attempt;
    const role = await this.options.store.findRole(attempt.knowledgeBaseId, userId);
    if (role !== 'owner' && role !== 'manager') throw notFound();
    const updated = await this.options.store.updateAttempt(attemptId, {
      status: 'queued',
      errorCode: null,
      errorDetail: null,
      completedAt: null,
      updatedAt: this.now(),
    });
    if (!updated) throw notFound();
    try {
      await this.options.queue.enqueueCapture(attemptId);
    } catch (error) {
      this.options.logger?.error({ err: error, attemptId }, 'capture retry queue unavailable');
      await this.options.store.failAttempt(
        attemptId,
        'queue_unavailable',
        'The capture could not be queued. Try again.',
        this.now(),
      );
      return { ...updated, status: 'failed', errorCode: 'queue_unavailable' };
    }
    return updated;
  }

  async process(attemptId: string): Promise<void> {
    const initial = await this.options.store.findAttempt(attemptId);
    if (!initial || initial.status === 'ready') return;
    if (initial.noteId) {
      await this.options.store.updateAttempt(attemptId, {
        status: 'ready',
        errorCode: null,
        errorDetail: null,
        completedAt: initial.completedAt ? new Date(initial.completedAt) : this.now(),
        updatedAt: this.now(),
      });
      return;
    }
    const attempt = await this.options.store.claimAttempt(attemptId, this.now());
    if (!attempt) {
      const latest = await this.options.store.findAttempt(attemptId);
      if (latest?.noteId) {
        await this.options.store.updateAttempt(attemptId, {
          status: 'ready',
          errorCode: null,
          errorDetail: null,
          completedAt: latest.completedAt ? new Date(latest.completedAt) : this.now(),
          updatedAt: this.now(),
        });
      }
      return;
    }
    const storedKeys: string[] = [];
    for (const key of await this.options.store.listMediaKeys(attemptId).catch(() => [])) {
      await this.options.storage.delete(key).catch(() => undefined);
    }
    await this.options.store.setMediaKeys(attemptId, []).catch(() => undefined);
    let noteCreated = false;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CAPTURE_TIMEOUT_MS);
    try {
      const role = await this.options.store.findRole(attempt.knowledgeBaseId, attempt.userId);
      if (role !== 'owner' && role !== 'manager') {
        throw new CaptureFailure('access_revoked', 'The capture owner no longer has access.');
      }

      const page = await this.options.fetcher.fetch(attempt.url, controller.signal);
      if (!isPublicHttpUrl(page.url)) {
        throw new CaptureFailure('unsafe_url', 'The page redirected to an unsafe address.');
      }
      if (!page.contentType.toLowerCase().includes('html')) {
        throw new CaptureFailure('unsupported_content', 'Only web pages can be captured.');
      }
      if (page.bytes.length > CAPTURE_PAGE_BYTES) {
        throw new CaptureFailure('page_too_large', 'The page is too large to capture.');
      }

      const extracted = extractPage(utf8(page.bytes), page.url);
      const canonicalUrl =
        extracted.canonicalUrl && isPublicHttpUrl(extracted.canonicalUrl)
          ? canonicalizeUrl(extracted.canonicalUrl)
          : canonicalizeUrl(page.url);
      const duplicateOf = await this.options.store.findDuplicate(
        attempt.knowledgeBaseId,
        canonicalUrl,
      );

      const media = await this.copyMedia(
        attemptId,
        extracted.imageUrls,
        storedKeys,
        controller.signal,
      );
      await this.options.store.setMediaKeys(attemptId, [...storedKeys]);
      const selected = selectionHtml(attempt.selectionHtml, attempt.selectionText);
      const content = selected || extracted.contentHtml;
      const rewritten = rewriteMedia(content, page.url, media);
      const capturedAt = this.now().toISOString();
      const html = sanitizeCaptureHtml(
        provenanceHtml(
          extracted.title,
          attempt.url,
          canonicalUrl,
          extracted.siteName,
          capturedAt,
          rewritten,
        ),
      );
      const created = await this.options.notes.createCapturedNote(attempt.userId, {
        knowledgeBaseId: attempt.knowledgeBaseId,
        title: extracted.title,
        html,
        additionalBytes: media.reduce((sum, item) => sum + item.bytes.length, 0),
        source: {
          url: attempt.url,
          canonicalUrl,
          title: extracted.title,
          siteName: extracted.siteName,
          capturedAt,
        },
      });
      noteCreated = true;
      await this.options.store.updateAttempt(attemptId, {
        canonicalUrl,
        noteId: created.note.id,
        revisionId: created.revisionId,
        duplicateOf,
        updatedAt: this.now(),
      });
      await this.options.store.updateAttempt(attemptId, {
        status: 'ready',
        errorCode: null,
        errorDetail: null,
        completedAt: this.now(),
        updatedAt: this.now(),
      });
    } catch (error) {
      if (!noteCreated) {
        for (const key of storedKeys) {
          await this.options.storage.delete(key).catch(() => undefined);
        }
        await this.options.store.setMediaKeys(attemptId, []).catch(() => undefined);
      }
      const code = controller.signal.aborted
        ? 'timeout'
        : error instanceof CaptureFailure
          ? error.code
          : 'capture_failed';
      const detail = controller.signal.aborted
        ? 'The page took too long to capture.'
        : error instanceof CaptureFailure
          ? error.message
          : 'The page could not be captured. Try again from the original URL.';
      await this.options.store.failAttempt(attemptId, code, detail, this.now());
      if (error instanceof CaptureFailure) return;
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  async readMedia(
    userId: string,
    attemptId: string,
    filename: string,
  ): Promise<{ bytes: Uint8Array; contentType: string }> {
    if (!/^[a-z0-9][a-z0-9._-]{0,120}$/i.test(filename)) throw notFound();
    const attempt = await this.options.store.findAttempt(attemptId);
    if (!attempt?.noteId) throw notFound();
    await this.options.notes.get(userId, attempt.noteId);
    const extension = filename.split('.').pop()?.toLowerCase() ?? '';
    const contentType = CONTENT_TYPES[extension];
    if (!contentType) throw notFound();
    try {
      return {
        bytes: await this.options.storage.get(`captures/${attemptId}/${filename}`),
        contentType,
      };
    } catch {
      throw notFound();
    }
  }

  private async copyMedia(
    attemptId: string,
    urls: string[],
    storedKeys: string[],
    signal: AbortSignal,
  ): Promise<CaptureMedia[]> {
    const media: CaptureMedia[] = [];
    let total = 0;
    for (const [index, url] of urls.entries()) {
      if (index >= 50 || total >= CAPTURE_MEDIA_TOTAL_BYTES) break;
      if (!isPublicHttpUrl(url)) continue;
      try {
        const resource = await this.options.fetcher.fetch(url, signal);
        if (resource.bytes.length > CAPTURE_MEDIA_BYTES) continue;
        if (total + resource.bytes.length > CAPTURE_MEDIA_TOTAL_BYTES) break;
        const type = imageType(resource.bytes);
        if (!type) continue;
        const scanned = await this.options.scanner.scan(resource.bytes, type.contentType);
        if (!scanned.clean) continue;
        const hash = createHash('sha256').update(resource.bytes).digest('hex').slice(0, 16);
        const filename = `${index}-${hash}.${type.extension}`;
        const key = `captures/${attemptId}/${filename}`;
        await this.options.storage.put(key, resource.bytes, type.contentType);
        storedKeys.push(key);
        total += resource.bytes.length;
        media.push({
          url,
          path: `/capture-media/${attemptId}/${filename}`,
          bytes: resource.bytes,
          contentType: type.contentType,
        });
      } catch (error) {
        if (signal.aborted) throw error;
        this.options.logger?.info({ err: error, url }, 'captured media skipped');
      }
    }
    return media;
  }

  private async requireAttempt(userId: string, attemptId: string): Promise<CaptureAttempt> {
    const attempt = await this.options.store.findAttempt(attemptId);
    if (!attempt || attempt.userId !== userId) throw notFound();
    return attempt;
  }
}

function notFound(): AppError {
  return new AppError('Capture not found.', { status: 404, title: 'Not found' });
}
