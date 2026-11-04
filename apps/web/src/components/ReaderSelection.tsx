'use client';

import type { Annotation, MarkTypeDescriptor } from '@oln/domain';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import {
  createAnnotationAction,
  deleteAnnotationAction,
  replyAnnotationAction,
  updateAnnotationAction,
} from '../app/notes/annotation-actions';
import styles from '../app/workspace.module.css';

export interface ReaderSelectionAnchor {
  source: 'text' | 'pdf';
  quote: string;
  prefix: string;
  suffix: string;
  path: string;
  startOffset: number;
  endOffset: number;
  page?: number;
  rect?: { x: number; y: number; width: number; height: number };
}

function nodePath(node: Node): string {
  const parts: string[] = [];
  let current: Element | null =
    node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
  while (current && current !== current.ownerDocument.body) {
    const parent: Element | null = current.parentElement;
    if (!parent) break;
    const index = Array.from(parent.children).indexOf(current) + 1;
    parts.unshift(`${current.tagName.toLowerCase()}:nth-child(${index})`);
    current = parent;
  }
  return parts.join(' > ');
}

function pageElement(node: Node): HTMLElement | null {
  const element = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
  return element?.closest<HTMLElement>('[data-page-number]') ?? null;
}

function textOffset(root: Node, container: Node, offset: number): number {
  const doc = root.ownerDocument;
  if (!doc) return 0;
  const range = doc.createRange();
  range.selectNodeContents(root);
  try {
    range.setEnd(container, offset);
  } catch {
    return 0;
  }
  return range.toString().length;
}

function readSelection(selection: Selection | null, root: Node): ReaderSelectionAnchor | null {
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
    return null;
  }
  const range = selection.getRangeAt(0);
  const raw = selection.toString() || range.toString();
  const leading = raw.length - raw.trimStart().length;
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }
  const startOffset = textOffset(root, range.startContainer, range.startOffset) + leading;
  const endOffset = startOffset + trimmed.length;
  const fullText = root.textContent ?? '';
  const page = pageElement(range.startContainer);
  const pageNumber = page ? Number(page.getAttribute('data-page-number')) : undefined;
  if (page && pageNumber) {
    const pageRect = page.getBoundingClientRect();
    const rects = Array.from(range.getClientRects()).filter(
      (rect) => rect.width > 0 && rect.height > 0,
    );
    const left = Math.min(...rects.map((rect) => rect.left));
    const top = Math.min(...rects.map((rect) => rect.top));
    const right = Math.max(...rects.map((rect) => rect.right));
    const bottom = Math.max(...rects.map((rect) => rect.bottom));
    return {
      source: 'pdf',
      quote: trimmed.slice(0, 2000),
      prefix: '',
      suffix: '',
      path: '',
      startOffset,
      endOffset,
      page: pageNumber,
      rect: {
        x: Math.max(0, Math.min(1, (left - pageRect.left) / pageRect.width)),
        y: Math.max(0, Math.min(1, (top - pageRect.top) / pageRect.height)),
        width: Math.max(0, Math.min(1, (right - left) / pageRect.width)),
        height: Math.max(0, Math.min(1, (bottom - top) / pageRect.height)),
      },
    };
  }
  return {
    source: 'text',
    quote: trimmed.slice(0, 2000),
    prefix: fullText.slice(Math.max(0, startOffset - 40), startOffset),
    suffix: fullText.slice(endOffset, endOffset + 40),
    path: nodePath(range.startContainer),
    startOffset,
    endOffset: Math.min(endOffset, startOffset + 2000),
  };
}

function toAnchor(anchor: ReaderSelectionAnchor) {
  if (anchor.source === 'pdf' && anchor.page && anchor.rect) {
    return { kind: 'pdf' as const, page: anchor.page, rect: anchor.rect };
  }
  return {
    kind: 'text' as const,
    exact: anchor.quote,
    prefix: anchor.prefix,
    suffix: anchor.suffix,
    startOffset: anchor.startOffset,
    endOffset: anchor.endOffset,
    path: anchor.path,
  };
}

function overlaps(annotation: Annotation, anchor: ReaderSelectionAnchor): boolean {
  if (annotation.anchor.kind === 'pdf' && anchor.source === 'pdf' && anchor.page) {
    if (annotation.anchor.page !== anchor.page || !anchor.rect) return false;
    const rect = annotation.anchor.rect;
    return !(
      rect.x + rect.width < anchor.rect.x ||
      rect.x > anchor.rect.x + anchor.rect.width ||
      rect.y + rect.height < anchor.rect.y ||
      rect.y > anchor.rect.y + anchor.rect.height
    );
  }
  if (annotation.anchor.kind === 'text' && anchor.source === 'text') {
    return (
      annotation.anchor.startOffset < anchor.endOffset &&
      annotation.anchor.endOffset > anchor.startOffset
    );
  }
  return false;
}

function AnnotationCard({
  annotation,
  knowledgeBaseId,
  noteId,
  revisionId,
  revisionNumber,
  active,
  onSelect,
  viewerId,
  canModerate,
  markTypes,
}: {
  annotation: Annotation;
  knowledgeBaseId: string;
  noteId: string;
  revisionId: string;
  revisionNumber?: number;
  active: boolean;
  onSelect: () => void;
  viewerId: string;
  canModerate: boolean;
  markTypes: MarkTypeDescriptor[];
}) {
  const isAuthor = annotation.author.id === viewerId;
  const canEdit = annotation.kind === 'comment' && !annotation.deleted && isAuthor;
  const canDelete = !annotation.deleted && (isAuthor || canModerate);
  const hiddenFor = (id: string) => (
    <>
      <input type="hidden" name="knowledgeBaseId" value={knowledgeBaseId} />
      <input type="hidden" name="noteId" value={noteId} />
      <input type="hidden" name="revisionId" value={revisionId} />
      <input type="hidden" name="annotationId" value={id} />
    </>
  );
  return (
    <article className={`${styles.annotationCard} ${active ? styles.annotationCardActive : ''}`}>
      <header className={styles.annotationHeader}>
        <span className={styles.annotationAuthor}>
          {annotation.author.avatarUrl ? (
            // biome-ignore lint/performance/noImgElement: avatars are already-sized remote images.
            <img className={styles.avatar} src={annotation.author.avatarUrl} alt="" />
          ) : null}
          {annotation.author.displayName}
          {annotation.agentName ? (
            <span className={styles.muted}> via {annotation.agentName}</span>
          ) : null}
        </span>
        <span className={styles.annotationMeta}>
          Rev {revisionNumber ?? '—'} · {annotation.createdAt.slice(0, 10)}
          {annotation.updatedAt !== annotation.createdAt
            ? ` · edited ${annotation.updatedAt.slice(0, 10)}`
            : ''}
        </span>
        <button
          className={styles.textButton}
          type="button"
          aria-pressed={active}
          onClick={onSelect}
        >
          {active ? 'Selected' : 'Select'}
        </button>
      </header>
      <blockquote className={styles.selectionQuote}>
        {annotation.anchor.kind === 'text'
          ? annotation.anchor.exact
          : `Page ${annotation.anchor.page}`}
      </blockquote>
      {annotation.kind === 'mark' ? (
        <p className={styles.markBadge}>
          {markTypes.find((item) => item.type === annotation.markType)?.label ??
            annotation.markType ??
            'Highlight'}
        </p>
      ) : annotation.deleted ? (
        <p className={styles.muted}>This Comment was deleted.</p>
      ) : (
        <p className={styles.annotationBody}>{annotation.body}</p>
      )}
      {annotation.needsReview ? (
        <p className={styles.annotationWarning}>
          This passage could not be re-anchored in the current Revision.
        </p>
      ) : null}
      {canEdit ? (
        <details className={styles.annotationDetails}>
          <summary>Edit</summary>
          <form action={updateAnnotationAction} className={styles.annotationForm}>
            {hiddenFor(annotation.id)}
            <textarea
              className={styles.input}
              name="body"
              defaultValue={annotation.body ?? ''}
              maxLength={4000}
              required
            />
            <button className={styles.textButton} type="submit">
              Save
            </button>
          </form>
        </details>
      ) : null}
      {annotation.replies.length > 0 ? (
        <ul className={styles.replyList}>
          {annotation.replies.map((reply) => {
            const canEditReply = !reply.deleted && reply.author.id === viewerId;
            const canDeleteReply = !reply.deleted && (reply.author.id === viewerId || canModerate);
            return (
              <li key={reply.id}>
                <strong>{reply.author.displayName}</strong>{' '}
                <span className={styles.muted}>{reply.createdAt.slice(0, 10)}</span>
                {reply.deleted ? <p>This reply was deleted.</p> : <p>{reply.body}</p>}
                {canEditReply ? (
                  <details className={styles.annotationDetails}>
                    <summary>Edit reply</summary>
                    <form action={updateAnnotationAction} className={styles.annotationForm}>
                      {hiddenFor(reply.id)}
                      <textarea
                        className={styles.input}
                        name="body"
                        defaultValue={reply.body ?? ''}
                        maxLength={4000}
                        required
                      />
                      <button className={styles.textButton} type="submit">
                        Save
                      </button>
                    </form>
                  </details>
                ) : null}
                {canDeleteReply ? (
                  <form action={deleteAnnotationAction} className={styles.annotationForm}>
                    {hiddenFor(reply.id)}
                    <button className={styles.textButton} type="submit">
                      Delete reply
                    </button>
                  </form>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}
      {annotation.kind === 'comment' && !annotation.deleted ? (
        <form action={replyAnnotationAction} className={styles.annotationForm}>
          {hiddenFor(annotation.id)}
          <input
            className={styles.input}
            name="body"
            placeholder="Reply"
            maxLength={4000}
            required
          />
          <button className={styles.textButton} type="submit">
            Reply
          </button>
        </form>
      ) : null}
      {canDelete ? (
        <form action={deleteAnnotationAction} className={styles.annotationForm}>
          {hiddenFor(annotation.id)}
          <button className={styles.textButton} type="submit">
            Delete
          </button>
        </form>
      ) : null}
    </article>
  );
}

export function ReaderSelection({
  children,
  revisionNumber,
  byteSize,
  downloadHref,
  annotations,
  knowledgeBaseId,
  noteId,
  revisionId,
  annotationError,
  viewerId,
  canModerate,
  revisionNumbers,
  markTypes = [],
}: {
  children: ReactNode;
  revisionNumber?: number;
  byteSize: string;
  downloadHref?: string;
  annotations: Annotation[];
  knowledgeBaseId?: string;
  noteId: string;
  revisionId?: string;
  annotationError?: string;
  viewerId: string;
  canModerate: boolean;
  revisionNumbers: Map<string, number>;
  markTypes?: MarkTypeDescriptor[];
}) {
  const stageRef = useRef<HTMLElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const [anchor, setAnchor] = useState<ReaderSelectionAnchor | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) {
      return;
    }
    const attached = new Map<HTMLIFrameElement, { detach: () => void }>();
    const contentRoot = stage.querySelector('[data-reader-content]') ?? stage;

    const updateFromDocument = (doc: Document, root: Node) => {
      const selection = doc.getSelection();
      if (doc === document) {
        if (!selection || selection.rangeCount === 0) {
          setAnchor(null);
          return;
        }
        if (!stage.contains(selection.getRangeAt(0).commonAncestorContainer)) {
          return;
        }
      }
      setAnchor(readSelection(selection, root));
    };
    const onDocumentSelection = () => updateFromDocument(document, contentRoot);
    document.addEventListener('selectionchange', onDocumentSelection);

    const attachFrame = (frame: HTMLIFrameElement) => {
      if (attached.has(frame)) return;
      let detachDocument = () => {};
      const attachDocument = () => {
        const frameDocument = frame.contentDocument;
        if (!frameDocument) return;
        const onFrameSelection = () => updateFromDocument(frameDocument, frameDocument.body);
        frameDocument.addEventListener('selectionchange', onFrameSelection);
        detachDocument = () =>
          frameDocument.removeEventListener('selectionchange', onFrameSelection);
      };
      const onLoad = () => {
        detachDocument();
        attachDocument();
      };
      frame.addEventListener('load', onLoad);
      attached.set(frame, {
        detach: () => {
          frame.removeEventListener('load', onLoad);
          detachDocument();
        },
      });
      attachDocument();
    };

    const scanFrames = () => {
      for (const frame of stage.querySelectorAll('iframe')) {
        attachFrame(frame);
      }
      for (const [frame, entry] of attached) {
        if (!stage.contains(frame)) {
          entry.detach();
          attached.delete(frame);
        }
      }
    };
    const onPdfRegion = (event: Event) => {
      const detail = (event as CustomEvent<{ page: number; rect: ReaderSelectionAnchor['rect'] }>)
        .detail;
      if (!detail?.page || !detail.rect) return;
      setAnchor({
        source: 'pdf',
        quote: `Page ${detail.page} region`,
        prefix: '',
        suffix: '',
        path: '',
        startOffset: 0,
        endOffset: 0,
        page: detail.page,
        rect: detail.rect,
      });
    };
    window.addEventListener('oln-pdf-region', onPdfRegion);

    const observer = new MutationObserver(scanFrames);
    observer.observe(stage, { childList: true, subtree: true });
    scanFrames();

    return () => {
      observer.disconnect();
      document.removeEventListener('selectionchange', onDocumentSelection);
      window.removeEventListener('oln-pdf-region', onPdfRegion);
      for (const entry of attached.values()) {
        entry.detach();
      }
    };
  }, []);

  const overlapping = anchor ? annotations.filter((item) => overlaps(item, anchor)) : [];
  const canCreate = Boolean(anchor && knowledgeBaseId && revisionId);

  function focusAnnotation(annotation: Annotation) {
    setActiveId(annotation.id);
    const stage = stageRef.current;
    if (!stage) return;
    for (const marked of stage.querySelectorAll('[data-oln-focus]')) {
      marked.removeAttribute('data-oln-focus');
    }
    const content = stage.querySelector('[data-reader-content]') ?? stage;
    if (annotation.anchor.kind === 'pdf') {
      const page = content.querySelector<HTMLElement>(
        `[data-page-number="${annotation.anchor.page}"]`,
      );
      page?.setAttribute('data-oln-focus', '');
      page?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    const frame = content.querySelector('iframe');
    const scope = frame?.contentDocument?.body ?? document.body;
    const element = scope.querySelector<HTMLElement>(annotation.anchor.path);
    element?.setAttribute('data-oln-focus', '');
    element?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  return (
    <div className={styles.readerLayout}>
      <section className={styles.readerStage} aria-label="Reader" ref={stageRef}>
        {children}
      </section>
      <aside className={styles.annotations} id="annotations" aria-label="Annotations">
        <h2 className={styles.cardTitle}>Annotations</h2>
        {annotationError ? (
          <p className={`${styles.notice} ${styles.error}`} role="alert">
            {annotationError}
          </p>
        ) : null}
        {anchor ? (
          <>
            <p className={styles.muted}>
              {anchor.source === 'pdf' && anchor.page ? `Page ${anchor.page} · ` : ''}
              {anchor.source === 'pdf' ? 'PDF text layer' : 'Rendered text'}
            </p>
            <blockquote className={styles.selectionQuote}>{anchor.quote}</blockquote>
            <p className={styles.muted}>
              Offsets {anchor.startOffset}–{anchor.endOffset}
            </p>
            <p className={styles.muted}>Anchor path: {anchor.path || 'PDF region'}</p>
            {overlapping.length > 0 ? (
              <div className={styles.overlapList}>
                <p className={styles.muted}>Existing annotations here:</p>
                {overlapping.map((item) => (
                  <button
                    key={item.id}
                    className={styles.textButton}
                    type="button"
                    onClick={() => focusAnnotation(item)}
                  >
                    {item.kind === 'mark'
                      ? (markTypes.find((type) => type.type === item.markType)?.label ?? 'Mark')
                      : 'Comment'}{' '}
                    · {item.author.displayName}
                    {item.deleted ? ' · deleted' : ''}
                  </button>
                ))}
              </div>
            ) : null}
            {canCreate ? (
              <form action={createAnnotationAction} className={styles.annotationForm}>
                <input type="hidden" name="knowledgeBaseId" value={knowledgeBaseId} />
                <input type="hidden" name="noteId" value={noteId} />
                <input type="hidden" name="revisionId" value={revisionId} />
                <input type="hidden" name="anchor" value={JSON.stringify(toAnchor(anchor))} />
                <textarea
                  className={styles.input}
                  name="body"
                  ref={bodyRef}
                  placeholder="Comment on this passage (clear to add a Mark)"
                  maxLength={4000}
                  rows={3}
                />
                {markTypes.length > 0 ? (
                  <label className={styles.field}>
                    Mark type
                    <select className={styles.input} name="markType" defaultValue="core/highlight">
                      {markTypes.map((type) => (
                        <option key={type.type} value={type.type}>
                          {type.label}
                          {type.source === 'extension' ? ' (extension)' : ''}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}
                <div className={styles.annotationButtons}>
                  <button className={styles.button} name="kind" value="comment" type="submit">
                    Add Comment
                  </button>
                  <button
                    className={styles.buttonSecondary}
                    name="kind"
                    value="mark"
                    type="submit"
                    onClick={() => {
                      if (bodyRef.current) bodyRef.current.value = '';
                    }}
                  >
                    Add Mark
                  </button>
                </div>
              </form>
            ) : null}
          </>
        ) : (
          <p className={styles.muted}>
            Select text in the Reader to comment or highlight it. Existing annotations are listed
            below.
          </p>
        )}

        {annotations.length === 0 ? (
          <p className={styles.muted}>No comments or highlights in this Knowledge Base yet.</p>
        ) : (
          <div className={styles.annotationList}>
            {annotations.map((annotation) => (
              <AnnotationCard
                key={annotation.id}
                annotation={annotation}
                knowledgeBaseId={knowledgeBaseId ?? annotation.knowledgeBaseId}
                noteId={noteId}
                revisionId={revisionId ?? annotation.revisionId}
                active={activeId === annotation.id}
                onSelect={() => focusAnnotation(annotation)}
                viewerId={viewerId}
                canModerate={canModerate}
                markTypes={markTypes}
                revisionNumber={revisionNumbers.get(annotation.revisionId)}
              />
            ))}
          </div>
        )}

        <div className={styles.annotationPlaceholder}>
          <span>Revision {revisionNumber ?? '—'}</span>
          <span>{byteSize}</span>
        </div>
        {downloadHref ? (
          <a className={styles.textButton} href={downloadHref}>
            Download original
          </a>
        ) : null}
      </aside>
    </div>
  );
}
