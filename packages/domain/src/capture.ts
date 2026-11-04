export const CAPTURE_STATUSES = ['queued', 'processing', 'ready', 'failed'] as const;

export type CaptureStatus = (typeof CAPTURE_STATUSES)[number];

export const CAPTURE_PAGE_BYTES = 5 * 1024 * 1024;
export const CAPTURE_SELECTION_BYTES = 1024 * 1024;
export const CAPTURE_MEDIA_BYTES = 10 * 1024 * 1024;
export const CAPTURE_MEDIA_TOTAL_BYTES = 100 * 1024 * 1024;
export const CAPTURE_TIMEOUT_MS = 60_000;
export const CAPTURE_RATE_LIMIT = 30;
export const CAPTURE_RATE_WINDOW_MS = 60 * 60 * 1000;
export const CAPTURE_ACTIVE_LIMIT = 2;

export interface CaptureDuplicate {
  noteId: string;
  title: string;
}

export interface CaptureAttempt {
  id: string;
  knowledgeBaseId: string;
  userId: string;
  url: string;
  canonicalUrl: string | null;
  selectionHtml: string | null;
  selectionText: string | null;
  status: CaptureStatus;
  noteId: string | null;
  revisionId: string | null;
  duplicateOf: CaptureDuplicate | null;
  errorCode: string | null;
  errorDetail: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export function isCaptureStatus(value: unknown): value is CaptureStatus {
  return typeof value === 'string' && (CAPTURE_STATUSES as readonly string[]).includes(value);
}
