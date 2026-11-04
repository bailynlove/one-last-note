import { isExtensionRedirectUri, isPkceChallenge } from '@oln/domain';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { authRequest, fetchSessionUser } from '../../../lib/auth';
import { readSessionToken } from '../../../lib/session';
import styles from '../../page.module.css';

export const dynamic = 'force-dynamic';

interface ExtensionAuthPageProps {
  searchParams: Promise<{ challenge?: string; redirect_uri?: string; state?: string }>;
}

export default async function ExtensionAuthPage({ searchParams }: ExtensionAuthPageProps) {
  const params = await searchParams;
  const challenge = params.challenge ?? '';
  const redirectUri = params.redirect_uri ?? '';
  const state = params.state ?? '';
  const valid = isPkceChallenge(challenge) && isExtensionRedirectUri(redirectUri);
  const token = await readSessionToken();
  const user = token ? await fetchSessionUser(token) : null;

  async function authorize(formData: FormData) {
    'use server';

    const sessionToken = await readSessionToken();
    if (!sessionToken) {
      redirect('/login');
    }
    const formChallenge = String(formData.get('challenge') ?? '');
    const formRedirect = String(formData.get('redirect_uri') ?? '');
    const formState = String(formData.get('state') ?? '');
    if (!isPkceChallenge(formChallenge) || !isExtensionRedirectUri(formRedirect)) {
      redirect('/auth/extension?error=invalid');
    }

    const response = await authRequest('/auth/extension/authorize', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${sessionToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ challenge: formChallenge, redirectUri: formRedirect }),
    });
    if (!response.ok) {
      redirect('/auth/extension?error=failed');
    }
    const body: unknown = await response.json();
    const code =
      typeof body === 'object' && body !== null && 'code' in body && typeof body.code === 'string'
        ? body.code
        : null;
    if (!code) {
      redirect('/auth/extension?error=failed');
    }

    const target = new URL(formRedirect);
    target.searchParams.set('code', code);
    if (formState) target.searchParams.set('state', formState);
    redirect(target.toString());
  }

  return (
    <main className={styles.page}>
      <p className={styles.eyebrow}>one last note</p>
      <h1 className={styles.title}>Chrome Saver</h1>
      <p className={styles.lede}>
        The Saver asks to use your signed-in account to capture pages into a Knowledge Base you
        manage.
      </p>

      {!valid ? (
        <p className={styles.error} role="alert">
          This authorization link is invalid. Start again from the Saver extension.
        </p>
      ) : null}

      {valid && !user ? (
        <p className={styles.notice} role="status">
          Sign in to One Last Note in this browser first, then start the Saver again.{' '}
          <Link href="/login">Go to sign in</Link>
        </p>
      ) : null}

      {valid && user ? (
        <section className={styles.card} aria-labelledby="authorize-heading">
          <header className={styles.cardHeader}>
            <h2 className={styles.cardTitle} id="authorize-heading">
              Authorize the Saver
            </h2>
          </header>
          <p className={styles.lede}>
            Signed in as {user.displayName}. The Saver will receive a session that can save captures
            on your behalf.
          </p>
          <form className={styles.authForm} action={authorize}>
            <input type="hidden" name="challenge" value={challenge} />
            <input type="hidden" name="redirect_uri" value={redirectUri} />
            <input type="hidden" name="state" value={state} />
            <button className={styles.button} type="submit">
              Authorize Chrome Saver
            </button>
          </form>
        </section>
      ) : null}
    </main>
  );
}
