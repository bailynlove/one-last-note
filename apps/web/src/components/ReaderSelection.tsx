'use client';

import { type ReactNode, useEffect, useRef, useState } from 'react';
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

function pageNumber(node: Node): number | undefined {
  const element = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
  const page = element?.closest('[data-page-number]');
  const value = page?.getAttribute('data-page-number');
  return value ? Number(value) : undefined;
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
  const quote = (range.toString() || selection.toString()).trim();
  if (!quote) {
    return null;
  }
  const startOffset = textOffset(root, range.startContainer, range.startOffset);
  const endOffset = textOffset(root, range.endContainer, range.endOffset);
  const fullText = root.textContent ?? '';
  const rect = range.getBoundingClientRect();
  const page = pageNumber(range.startContainer);
  return {
    source: page ? 'pdf' : 'text',
    quote: quote.slice(0, 2000),
    prefix: fullText.slice(Math.max(0, startOffset - 40), startOffset),
    suffix: fullText.slice(endOffset, endOffset + 40),
    path: nodePath(range.startContainer),
    startOffset,
    endOffset,
    page,
    rect: {
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    },
  };
}

export function ReaderSelection({
  children,
  revisionNumber,
  byteSize,
  downloadHref,
}: {
  children: ReactNode;
  revisionNumber?: number;
  byteSize: string;
  downloadHref?: string;
}) {
  const stageRef = useRef<HTMLElement>(null);
  const [anchor, setAnchor] = useState<ReaderSelectionAnchor | null>(null);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) {
      return;
    }
    const attached = new Map<HTMLIFrameElement, { detach: () => void }>();

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
    const onDocumentSelection = () => updateFromDocument(document, stage);
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
    const observer = new MutationObserver(scanFrames);
    observer.observe(stage, { childList: true, subtree: true });
    scanFrames();

    return () => {
      observer.disconnect();
      document.removeEventListener('selectionchange', onDocumentSelection);
      for (const entry of attached.values()) {
        entry.detach();
      }
    };
  }, []);

  return (
    <div className={styles.readerLayout}>
      <section className={styles.readerStage} aria-label="Reader" ref={stageRef}>
        {children}
      </section>
      <aside className={styles.annotations} aria-label="Annotations">
        <h2 className={styles.cardTitle}>Annotations</h2>
        {anchor ? (
          <>
            <p className={styles.muted}>
              {anchor.source === 'pdf' && anchor.page ? `Page ${anchor.page} · ` : ''}
              {anchor.source === 'pdf' ? 'PDF text layer' : 'Rendered text'}
            </p>
            <blockquote className={styles.selectionQuote}>{anchor.quote}</blockquote>
            <p className={styles.muted}>
              Offsets {anchor.startOffset}–{anchor.endOffset}
              {anchor.rect ? ` · ${anchor.rect.width}×${anchor.rect.height} px` : ''}
            </p>
            <p className={styles.muted}>Anchor path: {anchor.path || 'document body'}</p>
          </>
        ) : (
          <p className={styles.muted}>
            Select text in the Reader to capture its quote and anchor data. Comments and Marks
            arrive in the next step.
          </p>
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
