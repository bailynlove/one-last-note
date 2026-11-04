import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { listKnowledgeBases } from '../../../lib/knowledge-bases';
import { formatBytes, getNote } from '../../../lib/notes';
import { readSessionToken } from '../../../lib/session';
import styles from '../../workspace.module.css';
import { attachNoteAction, replaceNoteAction, updateNoteTitleAction } from '../actions';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const token = await readSessionToken();
  if (!token) {
    return { title: 'Note' };
  }
  const { id } = await params;
  const note = await getNote(token, id);
  return { title: note.ok ? note.data.title : 'Note' };
}

const statusMessages: Record<string, string> = {
  archive_not_allowed: 'Archives are not accepted.',
  encrypted_pdf: 'Encrypted PDFs are not accepted.',
  empty_file: 'The file is empty.',
  file_too_large: 'The file is larger than 25 MB.',
  invalid_text: 'Text files must be valid UTF-8.',
  mime_mismatch: 'The declared file type does not match this file.',
  malware_detected: 'The malware scan rejected this file.',
  scan_unavailable: 'The malware scanner is unavailable; try again later.',
  signature_mismatch: 'The file contents do not match its extension.',
  unsupported_type: 'This file type is not supported.',
};

export default async function NotePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const token = await readSessionToken();
  const { id } = await params;
  if (!token) {
    redirect(`/login?next=${encodeURIComponent(`/notes/${id}`)}`);
  }
  const query = await searchParams;
  const note = await getNote(token, id);
  if (!note.ok) {
    if (note.detail.toLowerCase().includes('not available')) {
      notFound();
    }
    return (
      <main className={styles.page}>
        <p className={`${styles.notice} ${styles.error}`}>{note.detail}</p>
      </main>
    );
  }

  const knowledgeBases = await listKnowledgeBases(token);
  const roles = new Map(
    knowledgeBases.ok
      ? knowledgeBases.data.map((knowledgeBase) => [knowledgeBase.id, knowledgeBase.role])
      : [],
  );
  const canManage = note.data.associations.some((association) => {
    const role = roles.get(association.knowledgeBaseId);
    return role === 'owner' || role === 'manager';
  });
  const managedAssociations = note.data.associations.filter((association) => {
    const role = roles.get(association.knowledgeBaseId);
    return role === 'owner' || role === 'manager';
  });
  const otherKnowledgeBases = knowledgeBases.ok
    ? knowledgeBases.data.filter(
        (knowledgeBase) =>
          !note.data.associations.some(
            (association) => association.knowledgeBaseId === knowledgeBase.id,
          ),
      )
    : [];
  const current = note.data.revisions.find(
    (revision) => revision.id === note.data.currentRevisionId,
  );
  const firstAssociation = note.data.associations[0];
  const backKnowledgeBase = firstAssociation?.knowledgeBaseName ?? 'Knowledge Base';
  const backHref = firstAssociation
    ? `/knowledge-bases/${firstAssociation.knowledgeBaseId}#notes`
    : '/';

  return (
    <main className={styles.page}>
      <div className={styles.topbar}>
        <a className={styles.brand} href="/">
          one last note
        </a>
        <div className={styles.identity}>
          <a className={styles.textButton} href={backHref}>
            {backKnowledgeBase}
          </a>
        </div>
      </div>

      <div className={styles.layout}>
        <aside className={styles.sidebar}>
          <p className={styles.sidebarHeading}>Note</p>
          <ul className={styles.kbList}>
            <li>
              <a className={styles.kbLink} href={backHref}>
                Back to Knowledge Base
              </a>
            </li>
          </ul>
        </aside>

        <section className={styles.main}>
          <h1 className={styles.heading}>{note.data.title}</h1>
          <p className={styles.lede}>
            {current
              ? `${current.originalFilename} · ${formatBytes(current.byteSize)} · ${current.mediaType}`
              : 'No current Revision is available.'}
          </p>

          {typeof query.error === 'string' ? (
            <p className={`${styles.notice} ${styles.error}`}>{query.error}</p>
          ) : null}

          <section className={styles.card}>
            <div className={styles.cardHeader}>
              <h2 className={styles.cardTitle}>Knowledge Bases</h2>
              <span className={styles.badge}>{note.data.associations.length}</span>
            </div>
            <ul className={styles.plainList}>
              {note.data.associations.map((association) => (
                <li key={association.id}>
                  <a
                    className={styles.textButton}
                    href={`/knowledge-bases/${association.knowledgeBaseId}#notes`}
                  >
                    {association.knowledgeBaseName}
                  </a>
                </li>
              ))}
            </ul>
            {canManage && otherKnowledgeBases.length > 0 ? (
              <form action={attachNoteAction} className={styles.form}>
                <input type="hidden" name="noteId" value={note.data.id} />
                {managedAssociations.length === 1 ? (
                  <input
                    type="hidden"
                    name="sourceKnowledgeBaseId"
                    value={managedAssociations[0]?.knowledgeBaseId}
                  />
                ) : (
                  <label className={styles.label}>
                    Share from
                    <select className={styles.input} name="sourceKnowledgeBaseId" required>
                      {managedAssociations.map((association) => (
                        <option key={association.id} value={association.knowledgeBaseId}>
                          {association.knowledgeBaseName}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <label className={styles.label}>
                  Share with another Knowledge Base
                  <select className={styles.input} name="targetKnowledgeBaseId" required>
                    {otherKnowledgeBases.map((knowledgeBase) => (
                      <option key={knowledgeBase.id} value={knowledgeBase.id}>
                        {knowledgeBase.name}
                      </option>
                    ))}
                  </select>
                </label>
                <button className={styles.buttonSecondary} type="submit">
                  Share Note
                </button>
              </form>
            ) : null}
          </section>

          <section className={styles.card}>
            <div className={styles.cardHeader}>
              <h2 className={styles.cardTitle}>Revisions</h2>
              <span className={styles.badge}>{note.data.revisions.length}</span>
            </div>
            <ul className={styles.plainList}>
              {note.data.revisions.map((revision) => (
                <li key={revision.id}>
                  <strong>Revision {revision.revisionNumber}</strong>{' '}
                  <span className={styles.muted}>
                    {revision.originalFilename} · {formatBytes(revision.byteSize)} ·{' '}
                    {revision.status}
                    {revision.id === note.data.currentRevisionId ? ' · current' : ''}
                  </span>
                  {revision.status === 'ready' ? (
                    <>
                      {' '}
                      <a
                        className={styles.textButton}
                        href={`/notes/${note.data.id}/revisions/${revision.id}/download`}
                      >
                        Download
                      </a>
                    </>
                  ) : null}
                  {revision.statusDetail ? (
                    <p className={styles.muted}>
                      {statusMessages[revision.statusDetail] ??
                        'This Revision could not be accepted.'}
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
            {canManage ? (
              <form
                action={replaceNoteAction}
                className={styles.form}
                encType="multipart/form-data"
              >
                <input type="hidden" name="noteId" value={note.data.id} />
                <label className={styles.label}>
                  New original
                  <input
                    className={styles.input}
                    type="file"
                    name="file"
                    required
                    accept=".pdf,.md,.markdown,.txt,.html,.htm,.png,.jpg,.jpeg,.gif,.webp"
                  />
                </label>
                <button className={styles.button} type="submit">
                  Upload replacement
                </button>
              </form>
            ) : null}
          </section>

          {canManage ? (
            <section className={styles.card}>
              <div className={styles.cardHeader}>
                <h2 className={styles.cardTitle}>Title</h2>
              </div>
              <form action={updateNoteTitleAction} className={styles.form}>
                <input type="hidden" name="noteId" value={note.data.id} />
                <label className={styles.label}>
                  Note title
                  <input
                    className={styles.input}
                    name="title"
                    defaultValue={note.data.title}
                    maxLength={200}
                    required
                  />
                </label>
                <button className={styles.buttonSecondary} type="submit">
                  Save title
                </button>
              </form>
            </section>
          ) : null}
        </section>
      </div>
    </main>
  );
}
