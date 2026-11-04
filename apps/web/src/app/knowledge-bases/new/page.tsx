import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { readSessionToken } from '../../../lib/session';
import styles from '../../workspace.module.css';
import { createKnowledgeBaseAction } from '../actions';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'New Knowledge Base' };

export default async function NewKnowledgeBasePage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const token = await readSessionToken();
  if (!token) {
    redirect('/login?next=/knowledge-bases/new');
  }
  const { error } = await searchParams;

  return (
    <main className={styles.page}>
      <div className={styles.topbar}>
        <a className={styles.brand} href="/">
          one last note
        </a>
        <a className={styles.textButton} href="/">
          Back to workspace
        </a>
      </div>
      <section className={styles.main}>
        <h1 className={styles.heading}>New Knowledge Base</h1>
        <p className={styles.lede}>
          A Knowledge Base holds Notes, people, and the context around them. You will be its Owner.
        </p>
        {error ? <p className={`${styles.notice} ${styles.error}`}>{error}</p> : null}
        <form action={createKnowledgeBaseAction} className={`${styles.card} ${styles.form}`}>
          <label className={styles.field}>
            Name
            <input className={styles.input} name="name" required maxLength={120} />
          </label>
          <label className={styles.field}>
            Description <span className={styles.muted}>(optional)</span>
            <textarea className={styles.textarea} name="description" maxLength={1000} />
          </label>
          <div>
            <button className={styles.button} type="submit">
              Create Knowledge Base
            </button>
          </div>
        </form>
      </section>
    </main>
  );
}
