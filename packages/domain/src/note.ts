export const NOTE_PROCESSING_STATES = ['quarantined', 'ready', 'rejected'] as const;

export type NoteProcessingState = (typeof NOTE_PROCESSING_STATES)[number];

export const MAX_ORIGINAL_BYTES = 25 * 1024 * 1024;
export const KNOWLEDGE_BASE_STORAGE_BYTES = 5 * 1024 * 1024 * 1024;

export interface NoteRevision {
  id: string;
  noteId: string;
  revisionNumber: number;
  originalFilename: string;
  mediaType: string;
  byteSize: number;
  contentHash: string;
  status: NoteProcessingState;
  statusDetail: string | null;
  uploadedByUserId: string;
  createdAt: string;
  processedAt: string | null;
}

export interface NoteAssociation {
  id: string;
  knowledgeBaseId: string;
  knowledgeBaseName: string;
  createdAt: string;
}

export interface NoteSource {
  url: string;
  canonicalUrl: string;
  title: string;
  siteName: string | null;
  capturedAt: string;
}

export interface Note {
  id: string;
  title: string;
  source: NoteSource | null;
  currentRevisionId: string | null;
  createdByUserId: string;
  createdAt: string;
  updatedAt: string;
  associations: NoteAssociation[];
  revisions: NoteRevision[];
}

export interface NoteSummary {
  id: string;
  title: string;
  source: NoteSource | null;
  currentRevisionId: string | null;
  latestRevision: NoteRevision | null;
  associationCount: number;
  createdAt: string;
  updatedAt: string;
}

export function isNoteProcessingState(value: unknown): value is NoteProcessingState {
  return typeof value === 'string' && (NOTE_PROCESSING_STATES as readonly string[]).includes(value);
}

export function processingStateLabel(state: NoteProcessingState): string {
  switch (state) {
    case 'quarantined':
      return 'Checking file';
    case 'ready':
      return 'Ready';
    case 'rejected':
      return 'Rejected';
  }
}
