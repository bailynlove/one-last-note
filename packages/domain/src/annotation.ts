export const ANNOTATION_KINDS = ['comment', 'mark'] as const;
export type AnnotationKind = (typeof ANNOTATION_KINDS)[number];

export const HIGHLIGHT_MARK_TYPE = 'core/highlight';
export const MARK_TYPE_PATTERN = /^[a-z][a-z0-9-]*\/[a-z][a-z0-9-]*$/;
export function isMarkType(value: string): boolean {
  return MARK_TYPE_PATTERN.test(value);
}

export interface TextAnchor {
  kind: 'text';
  exact: string;
  prefix: string;
  suffix: string;
  startOffset: number;
  endOffset: number;
  path: string;
}

export interface PdfAnchor {
  kind: 'pdf';
  page: number;
  /** Normalized to the page, 0..1. */
  rect: { x: number; y: number; width: number; height: number };
}

export type AnnotationAnchor = TextAnchor | PdfAnchor;

export interface AnnotationAuthor {
  id: string;
  displayName: string;
  avatarUrl: string | null;
}

export interface Annotation {
  id: string;
  knowledgeBaseId: string;
  noteId: string;
  revisionId: string;
  originalRevisionId: string;
  parentId: string | null;
  author: AnnotationAuthor;
  kind: AnnotationKind;
  markType: string | null;
  body: string | null;
  anchor: AnnotationAnchor;
  needsReview: boolean;
  deleted: boolean;
  createdAt: string;
  updatedAt: string;
  replies: Annotation[];
}
