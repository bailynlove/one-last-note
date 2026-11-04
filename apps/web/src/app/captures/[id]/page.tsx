import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getCapture } from '../../../lib/captures';
import { readSessionToken } from '../../../lib/session';
import { retryCaptureAction } from '../../notes/capture-actions';
import styles from '../../workspace.module.css';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Capture' };

export default async function CapturePage({ params }: { params: Promise<{ id: string }> }) {
  const token = await readSessionToken();
  const { id } = await params;
  if (!token) redirect(`/login?next=${encodeURIComponent(`/captures/${id}`)}`);
  const attempt = await getCapture(token, id);
  if (!attempt) notFound();
  const active = attempt.status === 'queued' || attempt.status === 'processing';

  return (
    <main className={styles.page}>
      <header className={styles.pageHeader}>
        <div>
          <p className={styles.eyebrow}>Web capture</p>
          <h1 className={styles.pageTitle}>
            {attempt.status === 'ready' ? 'Captured' : 'Capture status'}
          </h1>
        </div>
        <Link className={styles.textButton} href={`/knowledge-bases/${attempt.knowledgeBaseId}`}>
          Back to Knowledge Base
        </Link>
      </header>
      {active ? <meta httpEquiv="refresh" content="3" /> : null}
      <section className={styles.card}>
        <p className={styles.muted}>{attempt.url}</p>
        <p>
          Status: <strong>{attempt.status}</strong>
        </p>
        {attempt.duplicateOf ? (
          <p className={styles.notice}>
            This page may already be in this Knowledge Base as{' '}
            <Link className={styles.textButton} href={`/notes/${attempt.duplicateOf.noteId}`}>
              {attempt.duplicateOf.title}
            </Link>
            . Your capture was still kept.
          </p>
        ) : null}
        {attempt.status === 'failed' ? (
          <>
            <p className={`${styles.notice} ${styles.error}`}>
              {attempt.errorDetail ?? 'The page could not be captured.'}
            </p>
            <form action={retryCaptureAction}>
              <input type="hidden" name="attemptId" value={attempt.id} />
              <button className={styles.button} type="submit">
                Retry this capture
              </button>
            </form>
          </>
        ) : null}
        {attempt.noteId ? (
          <p>
            <Link className={styles.button} href={`/notes/${attempt.noteId}`}>
              Open captured Note
            </Link>
          </p>
        ) : null}
      </section>
    </main>
  );
}
