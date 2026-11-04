import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { listAppExtensions } from '../../../../lib/app-extensions';
import { fetchSessionUser } from '../../../../lib/auth';
import { getKnowledgeBase } from '../../../../lib/knowledge-bases';
import { readSessionToken } from '../../../../lib/session';
import styles from '../../../workspace.module.css';
import {
  installExtensionAction,
  removeExtensionAction,
  toggleExtensionAction,
} from '../../extension-actions';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const token = await readSessionToken();
  if (!token) return { title: 'App Extensions' };
  const { id } = await params;
  const access = await getKnowledgeBase(token, id);
  return { title: access.ok ? `App Extensions · ${access.data.name}` : 'App Extensions' };
}

export default async function ExtensionsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const token = await readSessionToken();
  const { id } = await params;
  if (!token) redirect(`/login?next=/knowledge-bases/${id}/extensions`);
  const access = await getKnowledgeBase(token, id);
  if (!access.ok) {
    if (access.status === 404) notFound();
    return <main className={styles.page}>{access.detail}</main>;
  }
  await fetchSessionUser(token);
  const query = await searchParams;
  const canManage = access.data.role === 'owner' || access.data.role === 'manager';
  const result = await listAppExtensions(token, id);
  const installations = result.ok ? result.data : [];
  const grouped = new Map<string, typeof installations>();
  for (const installation of installations) {
    grouped.set(installation.extensionId, [
      ...(grouped.get(installation.extensionId) ?? []),
      installation,
    ]);
  }

  return (
    <main className={styles.page}>
      <div className={styles.topbar}>
        <a className={styles.brand} href="/">
          one last note
        </a>
        <div className={styles.identity}>
          <a className={styles.textButton} href={`/knowledge-bases/${id}`}>
            {access.data.name}
          </a>
          <span className={styles.role}>{access.data.role}</span>
        </div>
      </div>

      <header className={styles.pageHeader}>
        <div>
          <p className={styles.eyebrow}>App Extensions</p>
          <h1>{access.data.name}</h1>
          <p className={styles.lede}>
            Pinned packages add sandboxed Renderers to this Knowledge Base. Extensions cannot read
            cookies, the page DOM, your account, or the network; the host passes Revision bytes in.
          </p>
        </div>
        <div className={styles.headerActions}>
          <a className={styles.secondaryButton} href={`/knowledge-bases/${id}`}>
            Back to Knowledge Base
          </a>
        </div>
      </header>

      {typeof query.error === 'string' ? (
        <p className={`${styles.notice} ${styles.error}`}>{query.error}</p>
      ) : null}
      {!result.ok ? <p className={styles.notice}>{result.detail}</p> : null}

      {installations.length === 0 ? (
        <section className={styles.emptyState}>
          <h2>No App Extensions</h2>
          <p>Install a package to render additional file formats in this Knowledge Base.</p>
        </section>
      ) : (
        <div className={styles.extensionGrid}>
          {[...grouped.entries()].map(([extensionId, versions]) => {
            const current = versions.find((version) => version.enabled) ?? versions[0];
            if (!current) return null;
            return (
              <section className={styles.card} key={extensionId}>
                <div className={styles.cardHeader}>
                  <h2 className={styles.cardTitle}>{current.name}</h2>
                  <span className={styles.badge}>{current.enabled ? 'Enabled' : 'Disabled'}</span>
                </div>
                <p className={styles.panelHint}>
                  {extensionId} · v{current.version} · API {current.apiVersion} ·{' '}
                  {current.publisher}
                </p>
                <p className={styles.panelHint}>
                  SHA-256 <code>{current.packageHash.slice(0, 16)}…</code> · source {current.source}
                </p>
                <ul className={styles.plainList}>
                  {current.manifest.renderers.map((renderer) => (
                    <li key={renderer.id}>
                      <strong>{renderer.label}</strong> · {renderer.extensions.join(', ')} ·{' '}
                      {renderer.mediaTypes.join(', ')}
                    </li>
                  ))}
                </ul>
                <p className={styles.panelHint}>
                  Permissions: {current.manifest.permissions.join(', ') || 'none'}
                </p>
                <div className={styles.extensionVersions}>
                  <h3>Pinned versions</h3>
                  <ul className={styles.plainList}>
                    {versions.map((version) => (
                      <li key={version.id}>
                        <strong>v{version.version}</strong>{' '}
                        <span className={styles.badge}>
                          {version.enabled ? 'Enabled' : 'Disabled'}
                        </span>{' '}
                        <code>{version.packageHash.slice(0, 12)}…</code> · {version.source}
                        {canManage ? (
                          <span className={styles.inlineActions}>
                            <form action={toggleExtensionAction}>
                              <input type="hidden" name="knowledgeBaseId" value={id} />
                              <input type="hidden" name="installationId" value={version.id} />
                              <input
                                type="hidden"
                                name="enabled"
                                value={version.enabled ? 'false' : 'true'}
                              />
                              <button className={styles.textButton} type="submit">
                                {version.enabled ? 'Disable' : 'Enable'}
                              </button>
                            </form>
                            <form action={removeExtensionAction}>
                              <input type="hidden" name="knowledgeBaseId" value={id} />
                              <input type="hidden" name="installationId" value={version.id} />
                              <button className={styles.textButton} type="submit">
                                Remove
                              </button>
                            </form>
                          </span>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </div>
              </section>
            );
          })}
        </div>
      )}

      {canManage ? (
        <section className={styles.card}>
          <div className={styles.cardHeader}>
            <h2 className={styles.cardTitle}>Install a package</h2>
            <span className={styles.badge}>Manager</span>
          </div>
          <form action={installExtensionAction} className={styles.extensionForm}>
            <input type="hidden" name="knowledgeBaseId" value={id} />
            <label>
              Manifest JSON
              <textarea
                name="manifest"
                rows={10}
                required
                placeholder={`{
  "id": "acme.epub",
  "name": "EPUB Reader",
  "version": "1.0.0",
  "apiVersion": 1,
  "publisher": "Acme",
  "renderers": [{
    "id": "epub",
    "label": "EPUB",
    "extensions": ["epub"],
    "mediaTypes": ["application/epub+zip"],
    "entry": "renderer.js"
  }],
  "marks": [],
  "permissions": ["read-revision", "emit-anchors"]
}`}
              />
            </label>
            <label>
              Files JSON (path → text)
              <textarea
                name="files"
                rows={10}
                required
                placeholder={`{"renderer.js": "oln.root.textContent = oln.revision.filename"}`}
              />
            </label>
            <label>
              Source label
              <input name="source" placeholder="upload" />
            </label>
            <button className={styles.primaryButton} type="submit">
              Review and install
            </button>
          </form>
        </section>
      ) : null}
    </main>
  );
}
