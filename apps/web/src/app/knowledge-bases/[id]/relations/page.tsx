import type { RelationGraph } from '@oln/domain';
import { RELATION_LABELS, RELATION_TYPES } from '@oln/domain';
import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { RelationGraph as RelationGraphView } from '../../../../components/RelationGraph';
import { fetchSessionUser } from '../../../../lib/auth';
import { getKnowledgeBase } from '../../../../lib/knowledge-bases';
import { buildDisplayGraph, type DisplayEdge } from '../../../../lib/relation-layout';
import { fetchRelationGraph } from '../../../../lib/relations';
import { readSessionToken } from '../../../../lib/session';
import styles from '../../../workspace.module.css';
import { createRelationAction, deleteRelationAction } from '../../relation-actions';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const token = await readSessionToken();
  if (!token) return { title: 'Relations' };
  const { id } = await params;
  const access = await getKnowledgeBase(token, id);
  return { title: access.ok ? `Relations · ${access.data.name}` : 'Relations' };
}

function one(value: string | string[] | undefined): string {
  return typeof value === 'string' ? value : '';
}

function serialize(query: Record<string, string | string[] | undefined>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (key === 'error') continue;
    for (const item of Array.isArray(value) ? value : [value]) {
      if (typeof item === 'string') params.append(key, item);
    }
  }
  return params.toString();
}

function edgeRows(graph: RelationGraph): (DisplayEdge & { id: string; revision?: number })[] {
  return [
    ...graph.relations.map((relation) => ({
      id: relation.id,
      source: relation.sourceNoteId,
      target: relation.targetNoteId,
      type: relation.type,
      origin: 'manual' as const,
      family: relation.type,
      directed: relation.type !== 'related',
      label: RELATION_LABELS[relation.type],
      count: 1,
    })),
    ...graph.references.map((reference) => ({
      id: reference.id,
      source: reference.sourceNoteId,
      target: reference.targetNoteId,
      type: 'references',
      origin: 'content' as const,
      family: 'content' as const,
      directed: true,
      label: 'Content reference',
      count: 1,
      revision: reference.sourceRevisionNumber,
    })),
  ].sort(
    (a, b) =>
      a.source.localeCompare(b.source) ||
      a.target.localeCompare(b.target) ||
      a.id.localeCompare(b.id),
  );
}

export default async function RelationsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const token = await readSessionToken();
  const { id } = await params;
  if (!token) redirect(`/login?next=/knowledge-bases/${id}/relations`);
  const query = await searchParams;
  const access = await getKnowledgeBase(token, id);
  if (!access.ok) {
    if (access.status === 404) notFound();
    return <main className={styles.page}>{access.detail}</main>;
  }
  await fetchSessionUser(token);
  const canManage = access.data.role === 'owner' || access.data.role === 'manager';
  const revision = one(query.revision) || 'current';
  const filter = {
    revision,
    type: one(query.type),
    origin: one(query.origin),
    query: one(query.q),
  };
  const returnTo = serialize(query);
  const result = await fetchRelationGraph(token, id, filter);
  if (!result.ok) return <main className={styles.page}>{result.detail}</main>;
  const graph = result.data;
  const search: Record<string, string> = {};
  for (const key of ['view', 'note', 'type', 'origin', 'revision', 'q', 'expanded', 'page']) {
    const value = one(query[key]);
    if (value) search[key] = value;
  }
  const view = search.view === 'list' ? 'list' : 'graph';
  const expanded = new Set((search.expanded ?? '').split(',').filter(Boolean));
  let display = buildDisplayGraph(graph, expanded);
  const selectedNoteId = search.note ?? null;
  if (selectedNoteId && !display.nodes.some((node) => node.id === selectedNoteId)) {
    const cluster = display.clusters.find((node) => node.noteIds.includes(selectedNoteId));
    if (cluster) {
      expanded.add(cluster.id);
      display = buildDisplayGraph(graph, expanded);
    }
  }
  const selected = graph.notes.find((note) => note.id === selectedNoteId) ?? null;
  const selectedDisplay = display.nodes.find((node) => node.id === selectedNoteId) ?? null;
  const selectedCluster = selectedDisplay?.kind === 'cluster' ? selectedDisplay : null;
  const titles = new Map(graph.notes.map((note) => [note.id, note.title]));
  const rows = edgeRows(graph);
  const connected = new Set(rows.flatMap((row) => [row.source, row.target]));
  const isolated = graph.notes.filter((note) => !connected.has(note.id));
  const selectedRows = selectedNoteId
    ? rows.filter((row) => row.source === selectedNoteId || row.target === selectedNoteId)
    : [];
  const pageSize = 25;
  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));
  const page = Math.min(pageCount, Math.max(1, Number.parseInt(search.page ?? '1', 10) || 1));
  const pageRows = rows.slice((page - 1) * pageSize, page * pageSize);
  const noteHref = (noteId: string) => `/notes/${noteId}?kb=${id}`;

  function filterHref(next: Record<string, string | undefined>): string {
    const params = new URLSearchParams(search);
    for (const [key, value] of Object.entries(next)) {
      if (value) params.set(key, value);
      else params.delete(key);
    }
    params.delete('error');
    return `?${params.toString()}`;
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
          <p className={styles.eyebrow}>Relation page</p>
          <h1>{access.data.name}</h1>
          <p className={styles.lede}>
            Manual Relations persist across Revisions. Content references belong to the Revision
            they were found in.
          </p>
        </div>
        <div className={styles.headerActions}>
          <a className={styles.secondaryButton} href={filterHref({ view: 'graph' })}>
            Graph
          </a>
          <a className={styles.secondaryButton} href={filterHref({ view: 'list' })}>
            Accessible list
          </a>
        </div>
      </header>

      {one(query.error) ? (
        <p className={`${styles.notice} ${styles.error}`}>{one(query.error)}</p>
      ) : null}

      <form className={styles.relationFilters} method="get">
        {view === 'list' ? <input type="hidden" name="view" value="list" /> : null}
        {search.note ? <input type="hidden" name="note" value={search.note} /> : null}
        {search.expanded ? <input type="hidden" name="expanded" value={search.expanded} /> : null}
        <label>
          Find Notes
          <input name="q" defaultValue={filter.query} placeholder="Title contains…" />
        </label>
        <label>
          Type
          <select name="type" defaultValue={filter.type}>
            <option value="">All types</option>
            {RELATION_TYPES.map((type) => (
              <option key={type} value={type}>
                {RELATION_LABELS[type]}
              </option>
            ))}
          </select>
        </label>
        <label>
          Origin
          <select name="origin" defaultValue={filter.origin}>
            <option value="">All origins</option>
            <option value="manual">Manual</option>
            <option value="content">Content references</option>
          </select>
        </label>
        <label>
          Revision
          <select name="revision" defaultValue={revision}>
            <option value="current">Current Revisions</option>
            <option value="all">All Revisions</option>
            {revision !== 'current' && revision !== 'all' ? (
              <option value={revision}>Selected Revision</option>
            ) : null}
          </select>
        </label>
        <button type="submit">Apply filters</button>
        <a
          className={styles.textButton}
          href={filterHref({ q: '', type: '', origin: '', revision: 'current' })}
        >
          Clear
        </a>
      </form>

      {graph.truncated ? (
        <p className={styles.graphFootnote}>
          Showing the first 200 Notes. Narrow the search to find others.
        </p>
      ) : null}
      {graph.notes.length === 0 ? (
        <section className={styles.emptyState}>
          <h2>{filter.query ? 'No Notes match' : 'No Notes yet'}</h2>
          <p>
            {filter.query
              ? 'Try a different title or clear the search.'
              : 'Add Notes before drawing Relations.'}
          </p>
          <a className={styles.secondaryButton} href={`/knowledge-bases/${id}`}>
            Back to the Knowledge Base
          </a>
        </section>
      ) : (
        <div className={styles.relationLayout}>
          <section aria-label="Relation view">
            {view === 'graph' ? (
              <RelationGraphView
                notes={display.nodes}
                edges={display.edges}
                selectedNoteId={selectedNoteId}
                search={search}
              />
            ) : (
              <div className={styles.panel}>
                <p className={styles.panelHint}>
                  Every graph operation has a list equivalent. {rows.length} Relation
                  {rows.length === 1 ? '' : 's'} in this filtered view.
                </p>
                {rows.length === 0 ? (
                  <p className={styles.emptyStateText}>
                    {filter.query || filter.type || filter.origin
                      ? 'No Relations match these filters.'
                      : 'No Relations yet. Isolated Notes are listed below.'}
                  </p>
                ) : (
                  <div className={styles.tableWrap}>
                    <table>
                      <caption className={styles.srOnly}>Relations</caption>
                      <thead>
                        <tr>
                          <th>Source</th>
                          <th>Relation</th>
                          <th>Target</th>
                          <th>Origin</th>
                          <th>Revision</th>
                        </tr>
                      </thead>
                      <tbody>
                        {pageRows.map((row) => (
                          <tr key={row.id}>
                            <td>
                              <a href={filterHref({ note: row.source, page: '' })}>
                                {titles.get(row.source)}
                              </a>
                            </td>
                            <td>{row.label}</td>
                            <td>
                              <a href={filterHref({ note: row.target, page: '' })}>
                                {titles.get(row.target)}
                              </a>
                            </td>
                            <td>{row.origin}</td>
                            <td>
                              {row.revision ? `Revision ${row.revision}` : 'Across Revisions'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                {isolated.length > 0 ? (
                  <section className={styles.isolatedNotes}>
                    <h3>Isolated Notes</h3>
                    <ul>
                      {isolated.map((note) => (
                        <li key={note.id}>
                          <a href={filterHref({ note: note.id })}>{note.title}</a>
                        </li>
                      ))}
                    </ul>
                  </section>
                ) : null}
                {pageCount > 1 ? (
                  <nav className={styles.pagination} aria-label="Relation list pages">
                    {Array.from({ length: pageCount }, (_, index) => index + 1).map((number) => (
                      <a
                        key={number}
                        href={filterHref({ page: String(number) })}
                        aria-current={number === page ? 'page' : undefined}
                      >
                        {number}
                      </a>
                    ))}
                  </nav>
                ) : null}
              </div>
            )}
            <p className={styles.graphFootnote}>
              {graph.notes.length} Notes · {graph.relations.length} manual Relations ·{' '}
              {graph.references.length} Content references. Isolated Notes remain visible.
            </p>
          </section>

          <aside className={styles.inspector} aria-label="Relation inspector">
            <h2>{selected ? selected.title : (selectedCluster?.label ?? 'Inspector')}</h2>
            {selectedCluster ? (
              <>
                <p className={styles.panelHint}>
                  {selectedCluster.count} Notes in this {selectedCluster.family ?? 'Relation'}{' '}
                  cluster.
                </p>
                <a
                  className={styles.secondaryButton}
                  href={filterHref({
                    expanded: [...expanded, selectedCluster.id].sort().join(','),
                    note: '',
                  })}
                >
                  Expand cluster
                </a>
                <ul className={styles.relationList}>
                  {selectedCluster.noteIds.map((noteId) => (
                    <li key={noteId}>
                      <a href={filterHref({ note: noteId })}>{titles.get(noteId)}</a>
                    </li>
                  ))}
                </ul>
              </>
            ) : selected ? (
              <>
                <p className={styles.panelHint}>
                  {selectedRows.length} Relation{selectedRows.length === 1 ? '' : 's'} touch this
                  Note.
                </p>
                <a className={styles.secondaryButton} href={noteHref(selected.id)}>
                  Open Note
                </a>
                <ul className={styles.relationList}>
                  {selectedRows.map((row) => {
                    const outgoing = row.source === selected.id;
                    const other = outgoing ? row.target : row.source;
                    return (
                      <li key={row.id}>
                        <span>{outgoing ? row.label : `← ${row.label}`}</span>
                        <a href={filterHref({ note: other })}>{titles.get(other)}</a>
                        {row.origin === 'manual' && canManage ? (
                          <form action={deleteRelationAction}>
                            <input type="hidden" name="knowledgeBaseId" value={id} />
                            <input type="hidden" name="relationId" value={row.id} />
                            <input type="hidden" name="note" value={selected.id} />
                            <input type="hidden" name="returnTo" value={returnTo} />
                            <button className={styles.textButton} type="submit">
                              Remove
                            </button>
                          </form>
                        ) : (
                          <small>
                            {row.origin === 'content'
                              ? `Content reference · Revision ${row.revision}`
                              : 'Manual Relation'}
                          </small>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </>
            ) : (
              <p className={styles.panelHint}>
                Select a Note in the graph or list to inspect its neighborhood.
              </p>
            )}

            {canManage ? (
              <form action={createRelationAction} className={styles.relationForm}>
                <h3>Add a manual Relation</h3>
                <input type="hidden" name="knowledgeBaseId" value={id} />
                <input type="hidden" name="returnTo" value={returnTo} />
                <label>
                  From
                  <select name="sourceNoteId" defaultValue={selected?.id ?? ''} required>
                    <option value="">Choose a Note</option>
                    {graph.notes.map((note) => (
                      <option key={note.id} value={note.id}>
                        {note.title}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Relation
                  <select name="type" defaultValue="related" required>
                    {RELATION_TYPES.map((type) => (
                      <option key={type} value={type}>
                        {RELATION_LABELS[type]}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  To
                  <select name="targetNoteId" defaultValue="" required>
                    <option value="">Choose a Note</option>
                    {graph.notes
                      .filter((note) => note.id !== selected?.id)
                      .map((note) => (
                        <option key={note.id} value={note.id}>
                          {note.title}
                        </option>
                      ))}
                  </select>
                </label>
                <button type="submit">Create Relation</button>
              </form>
            ) : (
              <p className={styles.panelHint}>Viewers can explore Relations but not change them.</p>
            )}
          </aside>
        </div>
      )}
    </main>
  );
}
