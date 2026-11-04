import { redirect } from 'next/navigation';
import styles from '../../page.module.css';

export const dynamic = 'force-dynamic';

interface VerifyPageProps {
  searchParams: Promise<{ token?: string }>;
}

export default async function VerifyPage({ searchParams }: VerifyPageProps) {
  const { token } = await searchParams;
  if (!token) {
    redirect('/login?error=invalid');
  }

  return (
    <main className={styles.page}>
      <p className={styles.eyebrow}>one last note</p>
      <h1 className={styles.title}>Continue sign-in</h1>
      <p className={styles.lede}>
        Confirm this sign-in to finish connecting your account. This link works once.
      </p>
      <form action="/auth/verify/confirm" method="post">
        <input type="hidden" name="token" value={token} />
        <button className={styles.button} type="submit">
          Continue
        </button>
      </form>
    </main>
  );
}
