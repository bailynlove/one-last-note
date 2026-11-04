import type { Metadata } from 'next';
import { joinLinkPreview } from '../../../lib/knowledge-bases';
import { readSessionToken } from '../../../lib/session';
import { acceptJoinLinkAction } from '../../knowledge-bases/actions';
import styles from '../../workspace.module.css';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Join Knowledge Base' };

export default async function JoinPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { token } = await params;
  const { error } = await searchParams;
  const [preview, sessionToken] = await Promise.all([joinLinkPreview(token), readSessionToken()]);

  return (
    <main className={styles.page}>
      <div className={styles.topbar}>
        <a className={styles.brand} href="/">
          one last note
        </a>
      </div>
      <section className={styles.main}>
        {!preview.ok ? (
          <>
            <h1 className={styles.heading}>Join link unavailable</h1>
            <p className={styles.lede}>{preview.detail}</p>
          </>
        ) : (
          <>
            <h1 className={styles.heading}>Join {preview.data.knowledgeBaseName}</h1>
            <p className={styles.lede}>
              This link adds you as a <strong>{preview.data.role}</strong>. It expires{' '}
              {new Date(preview.data.expiresAt).toLocaleString()}.
            </p>
            {error ? <p className={`${styles.notice} ${styles.error}`}>{error}</p> : null}
            {sessionToken ? (
              <form action={acceptJoinLinkAction} className={styles.card}>
                <input type="hidden" name="token" value={token} />
                <p className={styles.empty}>
                  Anyone with this link can join until it expires or the Owner revokes it.
                </p>
                <button className={styles.button} type="submit">
                  Join Knowledge Base
                </button>
              </form>
            ) : (
              <section className={styles.card}>
                <p className={styles.empty}>Sign in, then return to this page to join.</p>
                <a className={styles.button} href={`/login?next=/join/${token}`}>
                  Sign in
                </a>
              </section>
            )}
          </>
        )}
      </section>
    </main>
  );
}
