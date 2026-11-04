import type { Metadata } from 'next';
import { invitationPreview } from '../../../lib/knowledge-bases';
import { readSessionToken } from '../../../lib/session';
import { acceptInvitationAction } from '../../knowledge-bases/actions';
import styles from '../../workspace.module.css';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Invitation' };

export default async function InvitationPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { token } = await params;
  const { error } = await searchParams;
  const [preview, sessionToken] = await Promise.all([invitationPreview(token), readSessionToken()]);

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
            <h1 className={styles.heading}>Invitation unavailable</h1>
            <p className={styles.lede}>{preview.detail}</p>
          </>
        ) : (
          <>
            <h1 className={styles.heading}>Join {preview.data.knowledgeBaseName}</h1>
            <p className={styles.lede}>
              You were invited as a <strong>{preview.data.role}</strong> using {preview.data.email}.
              The invitation expires {new Date(preview.data.expiresAt).toLocaleString()}.
            </p>
            {error ? <p className={`${styles.notice} ${styles.error}`}>{error}</p> : null}
            {sessionToken ? (
              <form action={acceptInvitationAction} className={styles.card}>
                <input type="hidden" name="token" value={token} />
                <p className={styles.empty}>
                  Accepting adds this Knowledge Base to your workspace. Sign in with the invited
                  email if you have not already.
                </p>
                <button className={styles.button} type="submit">
                  Accept invitation
                </button>
              </form>
            ) : (
              <section className={styles.card}>
                <p className={styles.empty}>
                  Sign in with {preview.data.email}, then return to this page to accept.
                </p>
                <a className={styles.button} href={`/login?next=/invitations/${token}`}>
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
