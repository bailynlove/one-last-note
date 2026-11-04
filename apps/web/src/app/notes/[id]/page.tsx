import { renderRevision } from '@oln/application';
import type { RendererResult } from '@oln/domain';
import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { PdfViewerClient } from '../../../components/PdfViewerClient';
import { ReaderSelection } from '../../../components/ReaderSelection';
import { listAnnotations } from '../../../lib/annotations';
import { fetchSessionUser } from '../../../lib/auth';
import { listKnowledgeBases } from '../../../lib/knowledge-bases';
import { fetchRevisionBytes, formatBytes, getNote } from '../../../lib/notes';
import { readSessionToken } from '../../../lib/session';
import { trashAssociationAction } from '../../knowledge-bases/lifecycle-actions';
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
  const user = await fetchSessionUser(token);
  if (!user) redirect(`/login?next=${encodeURIComponent(`/notes/${id}`)}`);
  const note = await getNote(token, id);
  if (!note.ok) {
    if (note.status === 404) {
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
  const requestedRevision =
    typeof query.revision === 'string'
      ? note.data.revisions.find((revision) => revision.id === query.revision)
      : undefined;
  const selected = requestedRevision ?? current;
  const assetsAllowed = query.assets === '1';
  let rendered: RendererResult | null = null;
  if (selected?.status === 'ready') {
    if (selected.mediaType === 'application/pdf' || selected.mediaType.startsWith('image/')) {
      rendered = renderRevision({
        filename: selected.originalFilename,
        mediaType: selected.mediaType,
        bytes: new Uint8Array(),
        assetsAllowed,
      });
    } else {
      const bytes = await fetchRevisionBytes(token, note.data.id, selected.id);
      if (bytes.ok) {
        rendered = renderRevision({
          filename: selected.originalFilename,
          mediaType: selected.mediaType,
          bytes: bytes.data,
          assetsAllowed,
        });
      }
    }
  }
  const downloadHref = selected
    ? `/notes/${note.data.id}/revisions/${selected.id}/download`
    : undefined;
  const visibleAssociations = note.data.associations.filter((association) =>
    roles.has(association.knowledgeBaseId),
  );
  const firstAssociation = visibleAssociations[0];
  if (!firstAssociation) {
    notFound();
  }
  const requestedKnowledgeBaseId =
    typeof query.kb === 'string' &&
    visibleAssociations.some((association) => association.knowledgeBaseId === query.kb)
      ? query.kb
      : undefined;
  const contextAssociation =
    visibleAssociations.find(
      (association) => association.knowledgeBaseId === requestedKnowledgeBaseId,
    ) ?? firstAssociation;
  const contextRole = contextAssociation
    ? roles.get(contextAssociation.knowledgeBaseId)
    : undefined;
  const canModerateContext = contextRole === 'owner' || contextRole === 'manager';
  const backKnowledgeBase = contextAssociation?.knowledgeBaseName ?? 'Knowledge Base';
  const backHref = contextAssociation
    ? `/knowledge-bases/${contextAssociation.knowledgeBaseId}#notes`
    : '/';
  const contextQuery = contextAssociation ? `&kb=${contextAssociation.knowledgeBaseId}` : '';
  const annotationsResult =
    contextAssociation && selected
      ? await listAnnotations(
          token,
          contextAssociation.knowledgeBaseId,
          note.data.id,
          selected.id === note.data.currentRevisionId ? selected.id : undefined,
        )
      : { ok: true as const, data: [] };
  const annotations = annotationsResult.ok ? annotationsResult.data : [];
  const annotationError =
    typeof query.annotationError === 'string'
      ? query.annotationError
      : annotationsResult.ok
        ? undefined
        : annotationsResult.detail;

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
          <p className={styles.sidebarHeading}>Knowledge Bases</p>
          <ul className={styles.kbList}>
            {knowledgeBases.ok ? (
              knowledgeBases.data.map((knowledgeBase) => (
                <li key={knowledgeBase.id}>
                  <a
                    className={`${styles.kbLink} ${
                      contextAssociation?.knowledgeBaseId === knowledgeBase.id
                        ? styles.kbLinkActive
                        : ''
                    }`}
                    href={`/knowledge-bases/${knowledgeBase.id}#notes`}
                  >
                    {knowledgeBase.name}
                    <span className={styles.role}>{knowledgeBase.role}</span>
                  </a>
                </li>
              ))
            ) : (
              <li>
                <a className={styles.kbLink} href={backHref}>
                  Back to Knowledge Base
                </a>
              </li>
            )}
          </ul>
        </aside>

        <section className={styles.main}>
          <h1 className={styles.heading}>{note.data.title}</h1>
          <p className={styles.lede}>
            {selected
              ? `${selected.originalFilename} · ${formatBytes(selected.byteSize)} · ${selected.mediaType}`
              : 'No current Revision is available.'}
          </p>

          {note.data.source ? (
            <p className={styles.sourceLine}>
              Captured from{' '}
              <a href={note.data.source.canonicalUrl} rel="noopener noreferrer" target="_blank">
                {note.data.source.siteName ?? new URL(note.data.source.canonicalUrl).hostname}
              </a>{' '}
              on {new Date(note.data.source.capturedAt).toLocaleDateString()}
            </p>
          ) : null}

          {typeof query.error === 'string' ? (
            <p className={`${styles.notice} ${styles.error}`}>{query.error}</p>
          ) : null}

          <ReaderSelection
            revisionNumber={selected?.revisionNumber}
            byteSize={selected ? formatBytes(selected.byteSize) : ''}
            downloadHref={downloadHref}
            annotations={annotations}
            knowledgeBaseId={contextAssociation?.knowledgeBaseId}
            noteId={note.data.id}
            revisionId={selected?.status === 'ready' ? selected.id : undefined}
            annotationError={annotationError}
            viewerId={user.id}
            revisionNumbers={
              new Map(note.data.revisions.map((revision) => [revision.id, revision.revisionNumber]))
            }
            canModerate={canModerateContext}
          >
            <div className={styles.readerToolbar}>
              <div className={styles.revisionTabs}>
                {note.data.revisions.map((revision) => (
                  <a
                    key={revision.id}
                    className={
                      revision.id === selected?.id ? styles.revisionTabActive : styles.revisionTab
                    }
                    href={`?revision=${revision.id}${contextQuery}`}
                  >
                    Rev {revision.revisionNumber}
                    {revision.id === note.data.currentRevisionId ? ' · current' : ''}
                  </a>
                ))}
              </div>
              {rendered?.kind === 'html' || rendered?.kind === 'markdown' ? (
                <a
                  className={styles.textButton}
                  href={`?revision=${selected?.id ?? ''}&assets=${assetsAllowed ? '0' : '1'}${contextQuery}`}
                >
                  {assetsAllowed ? 'Block external assets' : 'Load external assets'}
                </a>
              ) : null}
            </div>

            <div data-reader-content>
              {!selected ? (
                <p className={styles.notice}>
                  {note.data.revisions.length === 0
                    ? 'This Note has no Revisions yet.'
                    : 'No current Revision is available. Choose a Revision above.'}
                </p>
              ) : selected.status !== 'ready' ? (
                <div className={styles.notice}>
                  <strong>
                    Revision {selected.revisionNumber} is {selected.status}.
                  </strong>{' '}
                  {selected.statusDetail
                    ? (statusMessages[selected.statusDetail] ??
                      'This Revision could not be accepted.')
                    : 'It will be available after processing.'}
                </div>
              ) : rendered?.kind === 'markdown' || rendered?.kind === 'html' ? (
                // allow-same-origin is deliberate: the annotation selection bridge reads the frame's
                // document. Keep scripts/forms/popups disabled and sanitize content before rendering.
                <iframe
                  className={styles.htmlFrame}
                  title={`${note.data.title} rendered content`}
                  sandbox="allow-same-origin allow-top-navigation-by-user-activation"
                  srcDoc={`<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${rendered.contentSecurityPolicy ?? "default-src 'none'"}"><style>body{font-family:system-ui,sans-serif;line-height:1.6;margin:24px;color:#1d1d1b;background:#fff}img{max-width:100%;height:auto}a{color:#1f5c4a}table{border-collapse:collapse}td,th{border:1px solid #ddd;padding:6px 9px;text-align:left}code,pre{font-family:ui-monospace,monospace;background:#f6f5f2}pre{padding:12px;overflow:auto}</style></head><body>${rendered.html ?? ''}</body></html>`}
                />
              ) : rendered?.kind === 'text' ? (
                <pre className={`${styles.readerText} ${styles.readerContent}`}>
                  {rendered.text}
                </pre>
              ) : rendered?.kind === 'unsupported' ? (
                <div className={styles.notice}>
                  <p>{rendered.diagnostics[0]?.message}</p>
                  {downloadHref ? (
                    <a className={styles.textButton} href={downloadHref}>
                      Download original
                    </a>
                  ) : null}
                </div>
              ) : rendered?.kind === 'pdf' && downloadHref ? (
                <PdfViewerClient url={downloadHref} title={note.data.title} />
              ) : rendered?.kind === 'image' && downloadHref ? (
                <div className={styles.imageFrame}>
                  {/* biome-ignore lint/performance/noImgElement: authenticated revision bytes bypass Next image optimization. */}
                  <img src={downloadHref} alt={`Revision ${selected.revisionNumber}`} />
                </div>
              ) : (
                <div className={styles.notice}>
                  <p>The original could not be loaded.</p>
                  {downloadHref ? (
                    <a className={styles.textButton} href={downloadHref}>
                      Download original
                    </a>
                  ) : null}{' '}
                  <a
                    className={styles.textButton}
                    href={`?revision=${selected?.id ?? ''}${contextQuery}`}
                  >
                    Retry
                  </a>
                </div>
              )}
            </div>
          </ReaderSelection>

          <section className={styles.card}>
            <div className={styles.cardHeader}>
              <h2 className={styles.cardTitle}>Knowledge Bases</h2>
              <span className={styles.badge}>{note.data.associations.length}</span>
            </div>
            <ul className={styles.plainList}>
              {visibleAssociations.map((association) => {
                const role = roles.get(association.knowledgeBaseId);
                const canRemove = role === 'owner' || role === 'manager';
                return (
                  <li key={association.id} className={styles.associationRow}>
                    <a
                      className={styles.textButton}
                      href={`/knowledge-bases/${association.knowledgeBaseId}#notes`}
                    >
                      {association.knowledgeBaseName}
                    </a>
                    {canRemove ? (
                      <form action={trashAssociationAction}>
                        <input type="hidden" name="id" value={association.knowledgeBaseId} />
                        <input type="hidden" name="noteId" value={note.data.id} />
                        <button
                          className={`${styles.textButton} ${styles.buttonDanger}`}
                          type="submit"
                        >
                          Move to Trash
                        </button>
                      </form>
                    ) : null}
                  </li>
                );
              })}
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
