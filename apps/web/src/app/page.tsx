import { fetchReadiness } from '../lib/api';
import { fetchSessionUser } from '../lib/auth';
import { readSessionToken } from '../lib/session';
import styles from './page.module.css';

export const dynamic = 'force-dynamic';

export default async function StatusPage() {
  const [result, sessionToken] = await Promise.all([fetchReadiness(), readSessionToken()]);
  const user = sessionToken ? await fetchSessionUser(sessionToken) : null;
  const report = result.reachable ? result.report : null;
  const healthy = report?.status === 'ok';
  const checks = report ? Object.entries(report.checks) : [];

  return (
    <main className={styles.page}>
      <div className={styles.topbar}>
        <p className={styles.eyebrow}>one last note</p>
        {user ? (
          <div className={styles.identity}>
            <span className={styles.identityName}>{user.displayName}</span>
            <form action="/logout" method="post">
              <button className={styles.textButton} type="submit">
                Sign out
              </button>
            </form>
          </div>
        ) : (
          <a className={styles.textButton} href="/login">
            Sign in
          </a>
        )}
      </div>
      <h1 className={styles.title}>{user ? `Hello, ${user.displayName}` : 'Foundation status'}</h1>
      <p className={styles.lede}>
        {user
          ? 'Your account is connected. The foundation view below shows the services behind it.'
          : 'Sign in to make this your account. The foundation view below shows the services behind it.'}
      </p>

      <section className={styles.card} aria-labelledby="readiness-heading">
        <header className={styles.cardHeader}>
          <h2 className={styles.cardTitle} id="readiness-heading">
            Readiness
          </h2>
          <span className={`${styles.badge} ${healthy ? styles.ok : styles.degraded}`}>
            {!result.reachable ? 'unreachable' : (report?.status ?? 'unknown')}
          </span>
        </header>

        {checks.length > 0 ? (
          <table className={styles.checks}>
            <thead>
              <tr>
                <th scope="col">Dependency</th>
                <th scope="col">Status</th>
                <th scope="col">Latency</th>
              </tr>
            </thead>
            <tbody>
              {checks.map(([name, check]) => (
                <tr key={name}>
                  <td>{name}</td>
                  <td className={styles.checkStatus}>
                    {check.status === 'ok' ? 'ok' : (check.message ?? 'unavailable')}
                  </td>
                  <td className={styles.checkDetail}>{check.latencyMs} ms</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className={styles.note}>
            {result.reachable
              ? 'The API reported no dependency checks.'
              : 'The API did not answer. Start it with `pnpm dev` and reload.'}
          </p>
        )}
      </section>

      {report ? (
        <p className={styles.note}>Checked at {new Date(report.checkedAt).toLocaleString()}.</p>
      ) : null}

      <p className={styles.footer}>API health lives at /health and /ready on the API service.</p>
    </main>
  );
}
