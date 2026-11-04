export const TRASH_RETENTION_DAYS = 30;
export const TRASH_RETENTION_MS = TRASH_RETENTION_DAYS * 24 * 60 * 60 * 1000;

export interface TrashedAssociation {
  noteId: string;
  noteTitle: string;
  knowledgeBaseId: string;
  knowledgeBaseName: string;
  trashedAt: string;
  purgeAfter: string;
}

export interface DeletedKnowledgeBase {
  id: string;
  name: string;
  deletedAt: string;
  purgeAfter: string;
  noteCount: number;
}

export interface PurgeResult {
  knowledgeBases: number;
  associations: number;
  notes: number;
  objects: number;
}
