import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { readSessionToken } from '../../../lib/session';
import { acceptOwnershipTransferAction } from '../../knowledge-bases/actions';
import styles from '../../workspace.module.css';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Ownership transfer' };

export default async function OwnershipTransferPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { id } = await params;
  const { error } = await searchParams;
  const token = await readSessionToken();
  if (!token) {
    redirect(`/login?next=/ownership-transfers/${id}`);
  }

  return (
    <main className={styles.page}>
      <div className={styles.topbar}>
        <a className={styles.brand} href="/">
          one last note
        </a>
      </div>
      <section className={styles.main}>
        <h1 className={styles.heading}>Accept ownership</h1>
        <p className={styles.lede}>
          If you are the Manager named in this transfer, accepting makes you the Owner. The previous
          Owner becomes a Manager.
        </p>
        {error ? <p className={`${styles.notice} ${styles.error}`}>{error}</p> : null}
        <form action={acceptOwnershipTransferAction} className={styles.card}>
          <input type="hidden" name="transferId" value={id} />
          <button className={styles.button} type="submit">
            Accept ownership
          </button>
        </form>
      </section>
    </main>
  );
}
