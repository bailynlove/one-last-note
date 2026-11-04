import Link from 'next/link';
import { redirect } from 'next/navigation';
import { listAgentTokens } from '../../../lib/agent-tokens';
import { readSessionToken } from '../../../lib/session';
import styles from '../../workspace.module.css';
import { AgentTokenForm } from './AgentTokenForm';
import { revokeTokenAction } from './actions';

export const dynamic = 'force-dynamic';

export default async function AgentTokensPage() {
  const session = await readSessionToken();
  if (!session) redirect('/login');
  const tokens = await listAgentTokens(session);
  return (
    <main className={styles.page}>
      <header className={styles.topbar}>
        <div>
          <p className={styles.eyebrow}>Settings</p>
          <h1>Agent access</h1>
        </div>
        <div className={styles.pageHeaderActions}>
          <Link className={styles.secondaryButton} href="/">
            Back to workspace
          </Link>
        </div>
      </header>
      <section className={styles.card}>
        <h2>Agent tokens</h2>
        <p className={styles.muted}>
          Tokens let an MCP client act as you, with the scopes you choose. They never expose your
          password or session cookie.
        </p>
        <AgentTokenForm />
      </section>
      <section className={styles.card}>
        <h2>Active tokens</h2>
        {tokens.length === 0 ? (
          <p className={styles.muted}>No Agent tokens yet.</p>
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Scopes</th>
                  <th>Created</th>
                  <th>Last used</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {tokens.map((token) => (
                  <tr key={token.id}>
                    <td>{token.name}</td>
                    <td>{token.scopes.join(', ')}</td>
                    <td>{new Date(token.createdAt).toLocaleDateString()}</td>
                    <td>
                      {token.lastUsedAt ? new Date(token.lastUsedAt).toLocaleString() : 'Never'}
                    </td>
                    <td>
                      <form action={revokeTokenAction}>
                        <input type="hidden" name="id" value={token.id} />
                        <button className={styles.dangerButton} type="submit">
                          Revoke
                        </button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
