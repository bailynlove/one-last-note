import { fetchReadiness } from '../lib/api';
import { fetchSessionUser } from '../lib/auth';
import { listKnowledgeBases } from '../lib/knowledge-bases';
import { readSessionToken } from '../lib/session';
import styles from './workspace.module.css';

export const dynamic = 'force-dynamic';

export default async function WorkspacePage() {
  const sessionToken = await readSessionToken();
  const user = sessionToken ? await fetchSessionUser(sessionToken) : null;

  if (!sessionToken || !user) {
    const result = await fetchReadiness();
    const report = result.reachable ? result.report : null;
    return (
      <main className={styles.page}>
        <div className={styles.topbar}>
          <a className={styles.brand} href="/">
            one last note
          </a>
          <a className={styles.textButton} href="/login">
            Sign in
          </a>
        </div>
        <div className={styles.main}>
          <h1 className={styles.heading}>A quiet place for what you are still thinking about.</h1>
          <p className={styles.lede}>
            Keep notes, sources, and the conversations around them together. Sign in to open your
            workspace.
          </p>
          <section className={styles.card}>
            <div className={styles.cardHeader}>
              <h2 className={styles.cardTitle}>Workspace</h2>
              <span className={styles.badge}>{report?.status ?? 'unknown'}</span>
            </div>
            <p className={styles.empty}>
              {report
                ? 'The API is reachable. Sign in to create or open a Knowledge Base.'
                : 'The API is not reachable. Start it with `pnpm dev` and reload.'}
            </p>
          </section>
        </div>
      </main>
    );
  }

  const knowledgeBases = await listKnowledgeBases(sessionToken);
  const items = knowledgeBases.ok ? knowledgeBases.data : [];

  return (
    <main className={styles.page}>
      <div className={styles.topbar}>
        <a className={styles.brand} href="/">
          one last note
        </a>
        <div className={styles.identity}>
          <span>{user.displayName}</span>
          <form action="/logout" method="post">
            <button className={styles.textButton} type="submit">
              Sign out
            </button>
          </form>
        </div>
      </div>

      <div className={styles.layout}>
        <aside className={styles.sidebar}>
          <p className={styles.sidebarHeading}>Knowledge bases</p>
          <ul className={styles.kbList}>
            {items.map((knowledgeBase) => (
              <li key={knowledgeBase.id}>
                <a className={styles.kbLink} href={`/knowledge-bases/${knowledgeBase.id}`}>
                  <span>{knowledgeBase.name}</span>
                  <span className={styles.role}>{knowledgeBase.role}</span>
                </a>
              </li>
            ))}
          </ul>
          <p className={styles.muted} style={{ marginTop: 14 }}>
            <a className={styles.textButton} href="/knowledge-bases/new">
              New Knowledge Base
            </a>
          </p>
        </aside>

        <section className={styles.main}>
          <h1 className={styles.heading}>Knowledge bases</h1>
          <p className={styles.lede}>
            Choose a Knowledge Base to work in, or start a new one. Membership decides what you can
            change.
          </p>
          <p>
            <a className={styles.secondaryButton} href="/settings/agent-tokens">
              Agent access
            </a>
          </p>

          {!knowledgeBases.ok ? (
            <p className={`${styles.notice} ${styles.error}`}>{knowledgeBases.detail}</p>
          ) : null}

          {items.length === 0 ? (
            <section className={styles.card}>
              <h2 className={styles.cardTitle}>Nothing here yet</h2>
              <p className={styles.empty}>
                Create your first Knowledge Base. You become its Owner, and you can invite people
                once it exists.
              </p>
              <p style={{ marginBottom: 0 }}>
                <a className={styles.button} href="/knowledge-bases/new">
                  Create a Knowledge Base
                </a>
              </p>
            </section>
          ) : (
            <div style={{ display: 'grid', gap: 12 }}>
              {items.map((knowledgeBase) => (
                <a
                  className={styles.card}
                  href={`/knowledge-bases/${knowledgeBase.id}`}
                  key={knowledgeBase.id}
                  style={{ display: 'block', color: 'inherit', textDecoration: 'none' }}
                >
                  <div className={styles.cardHeader} style={{ marginBottom: 6 }}>
                    <h2 className={styles.cardTitle}>{knowledgeBase.name}</h2>
                    <span className={styles.badge}>{knowledgeBase.role}</span>
                  </div>
                  <p className={styles.empty} style={{ margin: 0 }}>
                    {knowledgeBase.description || 'No description yet.'}
                  </p>
                </a>
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
