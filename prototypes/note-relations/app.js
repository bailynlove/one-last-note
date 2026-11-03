// Three Relation Page variants on one Knowledge Base, switchable via ?variant=.
const variants = { A: "Graph + inspector", B: "Cluster canvas", C: "Accessible list first" };
const notes = [
  { id: "n1", title: "Research roadmap", format: "MD", x: 80, y: 65 },
  { id: "n2", title: "Interview synthesis", format: "HTML", x: 330, y: 55 },
  { id: "n3", title: "Annotation model", format: "MD", x: 195, y: 235 },
  { id: "n4", title: "Saver architecture", format: "HTML", x: 455, y: 245 },
  { id: "n5", title: "PKCE reference", format: "PDF", x: 615, y: 85 },
  { id: "n6", title: "Personal scratch", format: "MD", x: 625, y: 390 },
  { id: "n7", title: "Archived draft", format: "PDF", x: 75, y: 400 }
];
const initialRelations = [
  { id: "r1", source: "n1", target: "n2", type: "related", origin: "manual", author: "Mina Chen", revision: null, previousRevision: null },
  { id: "r2", source: "n1", target: "n3", type: "references", origin: "manual", author: "Alex Rivera", revision: null, previousRevision: null },
  { id: "r3", source: "n3", target: "n4", type: "content", origin: "content", author: "System", revision: 3, previousRevision: 2 },
  { id: "r4", source: "n4", target: "n1", type: "supersedes", origin: "manual", author: "Mina Chen", revision: null, previousRevision: null },
  { id: "r5", source: "n2", target: "n3", type: "content", origin: "content", author: "System", revision: 5, previousRevision: 4 },
  { id: "r6", source: "n3", target: "n2", type: "references", origin: "manual", author: "Alex Rivera", revision: null, previousRevision: null }
];
const state = {
  variant: new URLSearchParams(location.search).get("variant") || "A",
  role: "Manager",
  view: "graph",
  search: "",
  typeFilter: "all",
  revision: "current",
  selectedNote: "n1",
  empty: false,
  relations: structuredClone(initialRelations),
  navigation: null,
  message: "Select a Note or Relation. Directed edges have arrows; Content References are dashed."
};
if (!variants[state.variant]) state.variant = "A";

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
}
function note(id) { return notes.find(item => item.id === id); }
function relationName(relation) { return relation.type === "content" ? "Content Reference" : relation.type === "related" ? "Related to" : relation.type === "references" ? "References" : "Supersedes"; }
function cycleVariant(direction) {
  const keys = Object.keys(variants);
  state.variant = keys[(keys.indexOf(state.variant) + direction + keys.length) % keys.length];
  const params = new URLSearchParams(location.search);
  params.set("variant", state.variant);
  history.replaceState(null, "", `${location.pathname}?${params}`);
  render();
}
function visibleRelations() {
  if (state.empty) return [];
  const search = state.search.toLowerCase();
  return state.relations.filter(relation => {
    const typeMatch = state.typeFilter === "all" || (state.typeFilter === "manual" ? relation.origin === "manual" : state.typeFilter === "content" ? relation.origin === "content" : relation.type === state.typeFilter);
    const revisionMatch = relation.origin === "manual" || (state.revision === "current" ? relation.revision : relation.previousRevision);
    const searchMatch = !search || note(relation.source).title.toLowerCase().includes(search) || note(relation.target).title.toLowerCase().includes(search);
    return typeMatch && revisionMatch && searchMatch;
  });
}
function visibleNotes(relations) {
  const search = state.search.toLowerCase();
  return notes.filter(item => !search || item.title.toLowerCase().includes(search) || relations.some(relation => relation.source === item.id || relation.target === item.id));
}
function viewTabs() {
  return `<div class="view-tabs"><button data-view="graph" class="${state.view === "graph" ? "active" : ""}">Graph</button><button data-view="list" class="${state.view === "list" ? "active" : ""}">Accessible list</button></div>`;
}
function graphMarkup(relations, compact = false) {
  const shownNotes = visibleNotes(relations);
  const lines = relations.map(relation => {
    const source = note(relation.source), target = note(relation.target);
    const x1 = source.x + 65, y1 = source.y + 26, x2 = target.x + 65, y2 = target.y + 26;
    const directed = relation.type !== "related";
    return `<line class="edge ${relation.type}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" ${directed ? 'marker-end="url(#arrow)"' : ""}></line><text class="edge-label" x="${(x1 + x2) / 2}" y="${(y1 + y2) / 2 - 7}" text-anchor="middle">${relationName(relation)}</text>`;
  }).join("");
  const nodeMarkup = shownNotes.map(item => `<g class="node ${state.selectedNote === item.id ? "selected" : ""}" data-node="${item.id}" tabindex="0" role="button" aria-label="Select ${escapeHtml(item.title)}" transform="translate(${item.x},${item.y})"><rect width="130" height="52"></rect><text x="10" y="21">${escapeHtml(item.title.slice(0, 19))}</text><text class="node-type" x="10" y="38">${item.format} · ${relations.filter(relation => relation.source === item.id || relation.target === item.id).length} Relations</text></g>`).join("");
  return `<div class="graph-wrap"><svg viewBox="0 0 790 500" aria-label="Note Relation graph"><defs><marker id="arrow" markerWidth="8" markerHeight="8" refX="7" refY="3" orient="auto"><path d="M0,0 L0,6 L7,3 z" fill="#66756c"></path></marker></defs>${lines}${nodeMarkup}</svg></div><div class="legend"><span>Related to · symmetric</span><span class="directed">Directed manual Relation</span><span class="content">Content Reference · Revision-specific</span></div>`;
}
function inspectorMarkup(relations) {
  const selected = note(state.selectedNote);
  const related = relations.filter(relation => relation.source === selected.id || relation.target === selected.id);
  return `<aside class="inspector"><span class="eyebrow">SELECTED NOTE</span><h2>${escapeHtml(selected.title)}</h2><p class="muted">${selected.format} · current Knowledge Base: Research library<br>${related.length} visible Relations</p><div class="button-row"><button class="primary" data-open-note="${selected.id}">Open Note</button><button class="secondary" data-center="${selected.id}">Clear selection</button></div><h3>Connections</h3><div class="detail-list">${related.length ? related.map(relation => `<div class="detail-item ${relation.origin}"><strong>${relationName(relation)}</strong><span>${escapeHtml(note(relation.source).title)} → ${escapeHtml(note(relation.target).title)}</span><br><small>${relation.origin === "manual" ? `Manual · ${escapeHtml(relation.author)}` : `Source Revision ${state.revision === "current" ? relation.revision : relation.previousRevision}`}</small></div>`).join("") : "<p class='muted'>No visible Relations. This Note remains visible as an isolated node.</p>"}</div></aside>`;
}
function listMarkup(relations) {
  return `<section class="list-card"><div class="card-header"><h2>Accessible Relation list</h2><small>${relations.length} Relations · source and target always named</small></div><table class="relation-table"><thead><tr><th>Source</th><th>Relation</th><th>Target</th><th>Origin / Revision</th><th>Actions</th></tr></thead><tbody>${relations.map(relation => `<tr><td><button data-open-note="${relation.source}">${escapeHtml(note(relation.source).title)}</button></td><td><span class="type-pill ${relation.type}">${relationName(relation)}</span></td><td><button data-open-note="${relation.target}">${escapeHtml(note(relation.target).title)}</button></td><td>${relation.origin === "manual" ? `Manual · ${escapeHtml(relation.author)}` : `Content · r${state.revision === "current" ? relation.revision : relation.previousRevision}`}</td><td>${state.role === "Manager" && relation.origin === "manual" ? `<button data-remove-relation="${relation.id}">Remove</button>` : "<span>Read only</span>"}</td></tr>`).join("")}</tbody></table></section>`;
}
function emptyMarkup() {
  return `<div class="empty"><h2>No Relations match this view</h2><p>Notes without Relations stay in the Knowledge Base. Clear filters, switch Revisions, or ${state.role === "Manager" ? "add a manual Relation" : "ask a Manager to add one"}.</p><button class="secondary" data-clear-filters="true">Clear filters and restore demo</button></div>`;
}
function variantA(relations) {
  if (!relations.length) return `<div class="workspace"><section class="graph-card"><div class="card-header"><h2>No Relations yet · isolated Notes remain visible</h2>${viewTabs()}</div>${graphMarkup([])}</section>${inspectorMarkup([])}</div>`;
  const content = state.view === "graph" ? `<div class="workspace"><section class="graph-card"><div class="card-header"><h2>Relation graph</h2>${viewTabs()}</div>${graphMarkup(relations)}</section>${inspectorMarkup(relations)}</div>` : `<div class="workspace"><section class="graph-card"><div class="card-header"><h2>Relation list</h2>${viewTabs()}</div></section>${listMarkup(relations)}</div>`;
  return content;
}
function clustersMarkup(relations) {
  const shown = visibleNotes(relations);
  const unseen = new Set(shown.map(item => item.id));
  const clusters = [];
  while (unseen.size) {
    const first = unseen.values().next().value;
    const cluster = new Set([first]);
    const queue = [first];
    unseen.delete(first);
    while (queue.length) {
      const current = queue.pop();
      relations.forEach(relation => {
        const next = relation.source === current ? relation.target : relation.target === current ? relation.source : null;
        if (next && unseen.has(next)) { cluster.add(next); unseen.delete(next); queue.push(next); }
      });
    }
    clusters.push([...cluster]);
  }
  return `<div class="clusters">${clusters.map((cluster, index) => `<section class="cluster-card"><h2>${cluster.length === 1 ? `Isolated Note · Cluster ${index + 1}` : `Connected cluster ${index + 1} · ${cluster.length} Notes`}</h2><div class="cluster-nodes">${cluster.map(id => `<button class="cluster-node ${state.selectedNote === id ? "selected" : ""}" data-node="${id}">${escapeHtml(note(id).title)}</button>`).join("")}</div><div class="cluster-edges">${relations.filter(relation => cluster.includes(relation.source) && cluster.includes(relation.target)).map(relation => `${escapeHtml(note(relation.source).title)} —${relationName(relation)}→ ${escapeHtml(note(relation.target).title)}`).join("<br>") || "No Relations; retained as an isolated cluster."}</div></section>`).join("")}</div>`;
}
function variantB(relations) {
  if (!relations.length) return emptyMarkup();
  return `<div class="cluster-layout"><aside class="filter-rail"><h2>Explore clusters</h2><p>Connected Notes group together. Isolated Notes never disappear.</p><button data-cluster-filter="all" class="${state.typeFilter === "all" ? "active" : ""}">All Relations</button><button data-cluster-filter="manual" class="${state.typeFilter === "manual" ? "active" : ""}">Manual links</button><button data-cluster-filter="content" class="${state.typeFilter === "content" ? "active" : ""}">Content References</button><hr><p>${relations.length} visible Relations<br>Revision view: ${state.revision}</p><button data-open-note="${state.selectedNote}">Open selected Note</button></aside>${clustersMarkup(relations)}</div>`;
}
function variantC(relations) {
  if (!relations.length) return emptyMarkup();
  return `<div class="list-first">${listMarkup(relations)}<section class="graph-card"><div class="card-header"><h2>Graph preview</h2><small>Secondary to the accessible list</small></div>${graphMarkup(relations, true)}</section></div>`;
}
function render() {
  const relations = visibleRelations();
  document.querySelector("#relation-count").textContent = state.empty ? 0 : state.relations.length;
  document.querySelector("#role").value = state.role;
  document.querySelector("#search").value = state.search;
  document.querySelector("#type-filter").value = state.typeFilter;
  document.querySelector("#revision").value = state.revision;
  document.querySelector("#empty-toggle").textContent = state.empty ? "Restore Relations" : "Show empty state";
  document.querySelector("#add-relation").hidden = state.role !== "Manager";
  document.querySelector("#notice").textContent = state.message;
  document.querySelector("#relation-page").innerHTML = ({ A: variantA, B: variantB, C: variantC })[state.variant](relations);
  document.querySelector("#variant-label").textContent = `${state.variant} — ${variants[state.variant]}`;
  document.querySelector("#state-json").textContent = JSON.stringify({ variant: state.variant, role: state.role, view: state.view, revisionView: state.revision, filters: { search: state.search, type: state.typeFilter }, selectedNote: state.selectedNote, navigation: state.navigation, visibleRelations: relations, isolatedNotes: visibleNotes(relations).filter(item => !relations.some(relation => relation.source === item.id || relation.target === item.id)).map(item => item.id) }, null, 2);
}
function openRelationDialog() {
  const options = notes.map(item => `<option value="${item.id}">${escapeHtml(item.title)}</option>`).join("");
  document.querySelector("#relation-source").innerHTML = options;
  document.querySelector("#relation-target").innerHTML = options;
  document.querySelector("#relation-source").value = state.selectedNote;
  document.querySelector("#relation-target").value = state.selectedNote === "n1" ? "n2" : "n1";
  document.querySelector("#relation-dialog").showModal();
}

document.addEventListener("click", event => {
  const button = event.target.closest("button");
  if (!button) return;
  if (button.id === "previous-variant") return cycleVariant(-1);
  if (button.id === "next-variant") return cycleVariant(1);
  if (button.id === "add-relation") return openRelationDialog();
  if (button.id === "cancel-relation") document.querySelector("#relation-dialog").close();
  if (button.id === "empty-toggle") { state.empty = !state.empty; state.message = state.empty ? "Empty state shown; underlying in-memory Relations are retained." : "Demo Relations restored."; }
  if (button.dataset.view) state.view = button.dataset.view;
  if (button.dataset.node) { state.selectedNote = button.dataset.node; state.message = `${note(state.selectedNote).title} selected.`; }
  if (button.dataset.center) { state.selectedNote = "n1"; state.message = "Selection reset to Research roadmap."; }
  if (button.dataset.openNote) { state.navigation = { noteId: button.dataset.openNote, knowledgeBase: "Research library", revision: state.revision }; state.message = `Would open ${note(button.dataset.openNote).title} in Research library with its current annotations and permissions.`; }
  if (button.dataset.removeRelation) { const relation = state.relations.find(item => item.id === button.dataset.removeRelation); state.relations = state.relations.filter(item => item.id !== button.dataset.removeRelation); state.message = `Removed manual ${relationName(relation)} Relation. In production this action is audited.`; }
  if (button.dataset.clusterFilter) state.typeFilter = button.dataset.clusterFilter;
  if (button.dataset.clearFilters) { state.empty = false; state.search = ""; state.typeFilter = "all"; state.revision = "current"; state.message = "Filters cleared; demo Relations restored."; }
  render();
});
document.querySelector("#role").addEventListener("change", event => { state.role = event.target.value; state.message = state.role === "Viewer" ? "Viewer mode: Relations are read and navigate only; management actions disappear." : "Manager mode: manual Relations can be added or removed."; render(); });
document.querySelector("#search").addEventListener("input", event => { state.search = event.target.value; render(); });
document.querySelector("#type-filter").addEventListener("change", event => { state.typeFilter = event.target.value; render(); });
document.querySelector("#revision").addEventListener("change", event => { state.revision = event.target.value; state.message = "Manual Relations persist; Content References now show their source Revision for this view."; render(); });
document.querySelector("#relation-form").addEventListener("submit", event => {
  event.preventDefault();
  const source = document.querySelector("#relation-source").value, target = document.querySelector("#relation-target").value, type = document.querySelector("#relation-label").value;
  if (source === target) { state.message = "Rejected: a Note cannot relate to itself."; document.querySelector("#relation-dialog").close(); return render(); }
  const duplicate = state.relations.some(relation => relation.origin === "manual" && relation.type === type && (type === "related" ? ((relation.source === source && relation.target === target) || (relation.source === target && relation.target === source)) : relation.source === source && relation.target === target));
  if (duplicate) { state.message = "Rejected: this exact manual Relation already exists."; document.querySelector("#relation-dialog").close(); return render(); }
  state.relations.push({ id: `r${Date.now()}`, source, target, type, origin: "manual", author: "You", revision: null, previousRevision: null });
  state.empty = false;
  state.message = `Created ${relationName({ type })} from ${note(source).title} to ${note(target).title}.`;
  document.querySelector("#relation-dialog").close();
  render();
});
document.addEventListener("keydown", event => {
  if (event.target.matches("input, textarea, select, [contenteditable]")) return;
  if ((event.key === "Enter" || event.key === " ") && event.target.dataset.node) { event.preventDefault(); state.selectedNote = event.target.dataset.node; render(); return; }
  if (event.key === "ArrowLeft") cycleVariant(-1);
  if (event.key === "ArrowRight") cycleVariant(1);
});
render();
