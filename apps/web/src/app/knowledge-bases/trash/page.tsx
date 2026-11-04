import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { listDeletedKnowledgeBases } from '../../../lib/lifecycle';
import { readSessionToken } from '../../../lib/session';
import styles from '../../workspace.module.css';
import { restoreKnowledgeBaseAction } from '../lifecycle-actions';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Deleted Knowledge Bases' };

export default async function DeletedKnowledgeBasesPage() {
  const token = await readSessionToken();
  if (!token) redirect('/login?next=/knowledge-bases/trash');
  const result = await listDeletedKnowledgeBases(token);

  return (
    <main className={styles.page}>
      <div className={styles.topbar}>
        <a className={styles.brand} href="/">
          one last note
        </a>
        <a className={styles.textButton} href="/">
          All Knowledge Bases
        </a>
      </div>
      <section className={styles.main}>
        <h1 className={styles.heading}>Deleted Knowledge Bases</h1>
        <p className={styles.lede}>
          Owners can restore a deleted Knowledge Base for 30 days. After that, it and its unshared
          Notes are purged automatically.
        </p>
        {!result.ok ? (
          <p className={`${styles.notice} ${styles.error}`}>{result.detail}</p>
        ) : result.data.knowledgeBases.length === 0 ? (
          <p className={styles.notice}>No Knowledge Bases are in Trash.</p>
        ) : (
          <ul className={styles.plainList}>
            {result.data.knowledgeBases.map((knowledgeBase) => {
              const days = Math.max(
                0,
                Math.ceil((new Date(knowledgeBase.purgeAfter).getTime() - Date.now()) / 86_400_000),
              );
              return (
                <li key={knowledgeBase.id} className={styles.associationRow}>
                  <span>
                    {knowledgeBase.name}
                    <span className={styles.annotationMeta}>
                      {' '}
                      · {knowledgeBase.noteCount} Notes · {days} days until purge
                    </span>
                  </span>
                  <form action={restoreKnowledgeBaseAction}>
                    <input type="hidden" name="id" value={knowledgeBase.id} />
                    <button className={styles.buttonSecondary} type="submit">
                      Restore
                    </button>
                  </form>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </main>
  );
}
