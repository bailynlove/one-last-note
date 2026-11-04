'use client';

import { useEffect, useRef, useState } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';
import styles from '../app/workspace.module.css';

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString();

const LOAD_TIMEOUT_MS = 60_000;

export function PdfViewer({ url, title }: { url: string; title: string }) {
  const [page, setPage] = useState(1);
  const [numPages, setNumPages] = useState(0);
  const [scale, setScale] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const timerRef = useRef<number | null>(null);

  function clearTimer() {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: url/reload identify the document.
  useEffect(() => {
    setPage(1);
    setNumPages(0);
    setScale(1);
    setError(null);
    timerRef.current = window.setTimeout(
      () => setError('This PDF took too long to load. Try again.'),
      LOAD_TIMEOUT_MS,
    );
    return clearTimer;
  }, [reload, url]);

  function retry() {
    setError(null);
    setReload((value) => value + 1);
  }

  return (
    <div className={styles.pdfViewer}>
      <div className={styles.pdfToolbar} role="toolbar" aria-label="PDF controls">
        <button
          className={styles.buttonSecondary}
          type="button"
          onClick={() => setPage((value) => Math.max(1, value - 1))}
          disabled={page <= 1}
        >
          Previous
        </button>
        <span className={styles.pdfPage}>
          Page{' '}
          <input
            aria-label="Page number"
            className={styles.pageInput}
            type="number"
            min={1}
            max={numPages || 1}
            value={page}
            onChange={(event) => {
              const next = Number(event.target.value);
              if (Number.isFinite(next)) {
                setPage(Math.min(Math.max(1, next), numPages || 1));
              }
            }}
          />{' '}
          of {numPages || '—'}
        </span>
        <button
          className={styles.buttonSecondary}
          type="button"
          onClick={() => setPage((value) => Math.min(numPages || 1, value + 1))}
          disabled={!numPages || page >= numPages}
        >
          Next
        </button>
        <span className={styles.pdfZoom}>
          <button
            className={styles.buttonSecondary}
            type="button"
            aria-label="Zoom out"
            onClick={() => setScale((value) => Math.max(0.5, value - 0.25))}
          >
            −
          </button>
          <span>{Math.round(scale * 100)}%</span>
          <button
            className={styles.buttonSecondary}
            type="button"
            aria-label="Zoom in"
            onClick={() => setScale((value) => Math.min(3, value + 0.25))}
          >
            +
          </button>
        </span>
      </div>

      {error ? (
        <div className={`${styles.notice} ${styles.error}`} role="alert">
          {error}{' '}
          <button className={styles.textButton} type="button" onClick={retry}>
            Retry
          </button>
        </div>
      ) : (
        <div className={styles.pdfPages}>
          <Document
            key={reload}
            file={url}
            loading={<p className={styles.muted}>Loading PDF…</p>}
            noData={<p className={styles.muted}>This PDF has no pages.</p>}
            onLoadSuccess={({ numPages: next }) => {
              clearTimer();
              setNumPages(next);
              setPage((value) => Math.min(value, next));
            }}
            onLoadError={() => {
              clearTimer();
              setError('This PDF could not be loaded. Download it to inspect it.');
            }}
          >
            <Page
              pageNumber={page}
              scale={scale}
              renderTextLayer
              renderAnnotationLayer={false}
              loading={<p className={styles.muted}>Loading page…</p>}
            />
          </Document>
        </div>
      )}
      <p className={styles.muted}>
        <a className={styles.textButton} href={url}>
          Download {title}
        </a>
      </p>
    </div>
  );
}
