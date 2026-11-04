export const RELATION_TYPES = ['related', 'references', 'supersedes'] as const;
export type RelationType = (typeof RELATION_TYPES)[number];

export const RELATION_ORIGINS = ['manual', 'content'] as const;
export type RelationOrigin = (typeof RELATION_ORIGINS)[number];

export const RELATION_LABELS: Record<RelationType, string> = {
  related: 'Related to',
  references: 'References',
  supersedes: 'Supersedes',
};

export interface RelationRevision {
  id: string;
  number: number;
}

export interface RelationNote {
  id: string;
  title: string;
  currentRevisionId: string | null;
  revisions: RelationRevision[];
}

export interface NoteRelation {
  id: string;
  knowledgeBaseId: string;
  type: RelationType;
  origin: 'manual';
  sourceNoteId: string;
  targetNoteId: string;
  createdByUserId: string;
  createdByDisplayName: string;
  createdAt: string;
}

export interface ContentReference {
  id: string;
  knowledgeBaseId: string;
  type: 'references';
  origin: 'content';
  sourceNoteId: string;
  sourceRevisionId: string;
  sourceRevisionNumber: number;
  targetNoteId: string;
  path: string;
  context: string;
}

export interface RelationGraph {
  knowledgeBaseId: string;
  notes: RelationNote[];
  relations: NoteRelation[];
  references: ContentReference[];
  revision: 'current' | 'all' | string;
  truncated: boolean;
}

export function isRelationType(value: unknown): value is RelationType {
  return typeof value === 'string' && (RELATION_TYPES as readonly string[]).includes(value);
}
