import { loadWebConfig } from '@oln/config';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { requestMagicLink } from '../../lib/auth';
import styles from '../page.module.css';

export const dynamic = 'force-dynamic';

interface LoginPageProps {
  searchParams: Promise<{ sent?: string; error?: string }>;
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = await searchParams;
  const googleEnabled = Boolean(loadWebConfig().GOOGLE_CLIENT_ID);

  async function sendMagicLink(formData: FormData) {
    'use server';

    const email = String(formData.get('email') ?? '').trim();
    if (!email) {
      redirect('/login?error=missing');
    }

    const forwardedFor = (await headers()).get('x-forwarded-for');
    const result = await requestMagicLink(email, forwardedFor);
    redirect(result === 'sent' ? '/login?sent=1' : `/login?error=${result}`);
  }

  return (
    <main className={styles.page}>
      <p className={styles.eyebrow}>one last note</p>
      <h1 className={styles.title}>Sign in</h1>
      <p className={styles.lede}>
        One account for your notes. Sign in with a link or with Google — either way, your verified
        email connects you to the same user.
      </p>

      {params.sent ? (
        <p className={styles.notice} role="status">
          If that address can sign in, a link is on its way. It expires in 15 minutes and works
          once.
        </p>
      ) : null}
      {params.error ? (
        <p className={styles.error} role="alert">
          {params.error === 'rate_limited'
            ? 'Too many sign-in attempts. Try again in 15 minutes.'
            : 'That sign-in did not work. Try again.'}
        </p>
      ) : null}

      <section className={styles.card} aria-labelledby="email-heading">
        <header className={styles.cardHeader}>
          <h2 className={styles.cardTitle} id="email-heading">
            Email link
          </h2>
        </header>
        <form className={styles.authForm} action={sendMagicLink}>
          <label className={styles.field}>
            <span>Email</span>
            <input
              className={styles.input}
              name="email"
              type="email"
              autoComplete="email"
              placeholder="you@example.com"
              required
            />
          </label>
          <button className={styles.button} type="submit">
            Send sign-in link
          </button>
        </form>
      </section>

      {googleEnabled ? (
        <section className={styles.card} aria-labelledby="google-heading">
          <header className={styles.cardHeader}>
            <h2 className={styles.cardTitle} id="google-heading">
              Google
            </h2>
          </header>
          <div className={styles.authForm}>
            <a className={styles.button} href="/auth/google/start">
              Continue with Google
            </a>
          </div>
        </section>
      ) : null}

      <p className={styles.footer}>
        <a href="/">Back to status</a>
      </p>
    </main>
  );
}
