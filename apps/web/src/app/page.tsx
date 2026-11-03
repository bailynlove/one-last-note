import { fetchReadiness } from '../lib/api';
import styles from './page.module.css';

export const dynamic = 'force-dynamic';

export default async function StatusPage() {
  const result = await fetchReadiness();
  const report = result.reachable ? result.report : null;
  const healthy = report?.status === 'ok';
  const checks = report ? Object.entries(report.checks) : [];

  return (
    <main className={styles.page}>
      <p className={styles.eyebrow}>one last note</p>
      <h1 className={styles.title}>Foundation status</h1>
      <p className={styles.lede}>
        Live view of the API and the services it needs. This page is intentionally thin — it only
        proves the foundation is wired together.
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
