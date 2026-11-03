// Three product-wide UI directions on one route, switchable via ?variant=A, B, or C.
const variants = { A: "Quiet workspace", B: "Command center", C: "Editorial canvas" };
const views = [
  ["library", "Notes"], ["reader", "Focused reader"], ["relations", "Relations"],
  ["members", "Members"], ["extensions", "App Extensions"], ["agents", "MCP"], ["saver", "Chrome Saver"]
];
const baseNotes = [
  { id: "n1", title: "Research roadmap", format: "MD", updated: "12 min ago", comments: 3, author: "Mina Chen" },
  { id: "n2", title: "Interview synthesis", format: "HTML", updated: "Yesterday", comments: 8, author: "Alex Rivera" },
  { id: "n3", title: "Annotation model", format: "PDF", updated: "May 18", comments: 5, author: "Mina Chen" },
  { id: "n4", title: "Saver architecture", format: "HTML", updated: "May 16", comments: 2, author: "Sam Lee" }
];
const state = {
  variant: new URLSearchParams(location.search).get("variant") || "A",
  view: "reader",
  role: "Manager",
  format: "markdown",
  annotationTab: "comments",
  selectedNote: "n1",
  notes: structuredClone(baseNotes),
  comments: [
    { id: "c1", author: "Alex Rivera", time: "10:42", anchor: "shared understanding", text: "Should this also cover re-anchoring after a replacement?", replies: ["Mina Chen · Yes, conservatively."] },
    { id: "c2", author: "Sam Lee", time: "09:18", anchor: "Review together", text: "I added the PDF region case to the checklist.", replies: [] }
  ],
  marks: [{ id: "m1", type: "core:highlight", author: "Mina Chen", anchor: "small, durable units" }],
  revision: 3,
  saverMode: "selection",
  saverTarget: "Research library",
  saverSaved: false,
  extensionEnabled: true,
  uploaded: false,
  shared: false,
  invited: false,
  message: "Select text to Comment or Highlight. Use the navigation to review every v1 flow."
};
if (!variants[state.variant]) state.variant = "A";

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
}
function nav(className = "") {
  return `<nav class="${className}" aria-label="Product areas">${views.map(([id, label]) => `<button data-view="${id}" class="${state.view === id ? "active" : ""}" ${state.view === id ? 'aria-current="page"' : ""}>${label}</button>`).join("")}</nav>`;
}
function roleControl() {
  return `<label class="role-control">Acting as <select id="role"><option>Manager</option><option>Viewer</option></select></label>`;
}
function contextHeader(kicker, title, detail, actions = "") {
  return `<header class="context-header"><div><span class="eyebrow">${kicker}</span><h1>${title}</h1><p>${detail}</p></div><div class="header-actions">${actions}</div></header>`;
}
function libraryActions() {
  return `${state.role === "Manager" ? '<button class="primary" data-action="upload">Upload Note</button><button data-action="share">Share Note</button>' : '<span class="permission-note">Viewer · read and annotate</span>'}<button data-view="relations">Relation page <span class="count">6</span></button>`;
}
function noteRows() {
  return state.notes.map(note => `<article class="note-row ${state.selectedNote === note.id ? "selected" : ""}">
    <button class="note-open" data-open-note="${note.id}"><span class="file-badge">${note.format}</span><span><strong>${escapeHtml(note.title)}</strong><small>${note.author} · ${note.updated}</small></span></button>
    <span class="note-meta">${note.comments} Comments</span>
    <button data-view="reader" aria-label="Open ${escapeHtml(note.title)}">Open</button>
    ${state.role === "Manager" ? `<button class="danger-text" data-delete-note="${note.id}" aria-label="Move ${escapeHtml(note.title)} to Trash">Trash</button>` : ""}
  </article>`).join("");
}
function libraryView(layout) {
  const listing = `<section class="note-collection"><div class="collection-toolbar"><label class="search"><span>Search Notes</span><input id="note-search" type="search" placeholder="Title, author, format"></label><select id="note-filter" aria-label="Filter Note format"><option>All formats</option><option>Markdown</option><option>HTML</option><option>PDF</option></select></div><div class="note-list">${noteRows()}</div><p class="microcopy">${state.notes.length} Notes · Annotations belong to Research library · Original files and Revisions are preserved</p></section>`;
  const side = `<aside class="library-aside"><h2>Research library</h2><p>4 members · 2 Managers</p><dl><div><dt>Your role</dt><dd>${state.role}</dd></div><div><dt>Shared elsewhere</dt><dd>${state.shared ? "1 Note" : "No new shares"}</dd></div><div><dt>Trash</dt><dd>30-day recovery</dd></div></dl><button data-view="members">Membership and Join Links</button>${state.shared ? '<div class="notice-card">Research roadmap is now also associated with Product notes. Existing annotations remain here.</div>' : ""}</aside>`;
  const body = `${contextHeader("RESEARCH LIBRARY / KNOWLEDGE BASE", "Notes", "Collect, read, and relate documents without losing their context.", libraryActions())}`;
  if (layout === "B") return `${body}<div class="b-library"><div>${listing}</div>${side}</div>`;
  if (layout === "C") return `${body}<div class="c-library">${listing}${side}</div>`;
  return `${body}<div class="a-library">${side}${listing}</div>`;
}
function formatControls() {
  return `<div class="segmented" aria-label="Renderer preview">${["markdown", "html", "pdf"].map(format => `<button data-format="${format}" class="${state.format === format ? "active" : ""}">${format === "markdown" ? "Markdown" : format.toUpperCase()}</button>`).join("")}</div>`;
}
function documentMarkup() {
  if (state.format === "pdf") return `<article class="document pdf-document"><div class="pdf-page"><span class="page-number">PAGE 2 / 18</span><h2>Annotation model</h2><p>A shared understanding of a document begins with small, durable units of meaning.</p><div class="pdf-highlight">Review together</div><p>The selected region remains attached to this Revision, even when later files replace it.</p><button data-action="comment">Comment on region</button><button data-action="mark">Highlight region</button></div></article>`;
  if (state.format === "html") return `<article class="document html-document"><span class="source-label">SAVED WEB PAGE · SANDBOXED HTML</span><h2>Designing a shared understanding</h2><p class="byline">Saved from example.org/research · assets allowed for this Note</p><p>Useful reading starts with <mark>small, durable units</mark> of meaning. A saved page keeps its source and a stable Revision.</p><h3>Review together</h3><p>Scripts and forms are blocked. Select this passage to add a Knowledge Base-scoped Annotation.</p><div class="selection-actions"><button data-action="comment">Comment</button><button data-action="mark">Highlight</button></div></article>`;
  return `<article class="document markdown-document"><span class="source-label">REVISION ${state.revision} · GFM · RAW HTML DISABLED</span><h2>Designing a shared understanding</h2><p>Notes become more useful when a team can build a <strong>shared understanding</strong> without losing the source.</p><blockquote>Work in <mark>small, durable units</mark>.</blockquote><h3>Review together</h3><ul><li>Selectable Markdown content</li><li>Revision-aware Anchors</li><li>Knowledge Base-scoped discussion</li></ul><div class="selection-actions"><button data-action="comment">Comment</button><button data-action="mark">Highlight</button></div></article>`;
}
function annotationContent() {
  const comments = state.comments.map(comment => `<article class="comment-card"><div class="author-line"><span class="avatar">${comment.author.split(" ").map(part => part[0]).join("")}</span><div><strong>${comment.author}</strong><small>${comment.time} · via Web</small></div></div><button class="anchor-link" data-action="anchor">“${escapeHtml(comment.anchor)}”</button><p>${escapeHtml(comment.text)}</p>${comment.replies.map(reply => `<div class="reply">${escapeHtml(reply)}</div>`).join("")}<button class="text-button" data-action="reply">Reply</button></article>`).join("");
  const marks = state.marks.map(mark => `<article class="mark-card"><span class="mark-swatch"></span><div><strong>Highlight</strong><button class="anchor-link" data-action="anchor">“${escapeHtml(mark.anchor)}”</button><small>${mark.author} · ${mark.type} · no comment text</small></div></article>`).join("");
  return `<div class="annotation-tabs"><button data-annotations="comments" class="${state.annotationTab === "comments" ? "active" : ""}">Comments ${state.comments.length}</button><button data-annotations="marks" class="${state.annotationTab === "marks" ? "active" : ""}">Marks ${state.marks.length}</button></div><div class="annotation-list">${state.annotationTab === "comments" ? comments : marks}</div><div class="composer"><label for="comment-input">Add an anchored Comment</label><textarea id="comment-input" rows="2" placeholder="Writer shown as Mina Chen"></textarea><button class="primary" data-action="comment">Add Comment</button></div>`;
}
function readerTools() {
  return `<div class="reader-tools"><div><button data-view="library">← Notes</button><span class="reader-title">Research roadmap</span></div>${formatControls()}<div><select id="revision" aria-label="Note Revision"><option value="3">Revision 3 · current</option><option value="2">Revision 2</option></select><button data-view="relations">Relations</button><button data-action="more">•••</button></div></div>`;
}
function readerView(layout) {
  const annotations = `<aside class="annotations"><div class="annotation-heading"><div><span class="eyebrow">RESEARCH LIBRARY</span><h2>Anchored discussion</h2></div><button data-action="close-annotations" aria-label="Collapse annotations">×</button></div>${annotationContent()}</aside>`;
  const doc = `<section class="reader-document">${documentMarkup()}</section>`;
  const index = `<aside class="reader-index"><span class="eyebrow">IN THIS NOTE</span><a href="#">Shared understanding</a><a href="#">Review together</a><a href="#">Revision history</a><hr><p>Revision ${state.revision}</p><p>Uploaded by Mina Chen</p><p>Comments and Marks are scoped to Research library.</p></aside>`;
  if (layout === "B") return `<div class="reader-shell b-reader">${readerTools()}<div class="b-reader-body">${doc}<section class="b-annotation-drawer">${annotationContent()}</section></div></div>`;
  if (layout === "C") return `<div class="reader-shell c-reader">${readerTools()}<div class="c-reader-body">${doc}<aside class="margin-notes"><span class="eyebrow">MARGIN / RESEARCH LIBRARY</span>${annotationContent()}</aside></div></div>`;
  return `<div class="reader-shell a-reader">${readerTools()}<div class="a-reader-body">${index}${doc}${annotations}</div></div>`;
}
function relationGraph() {
  return `<div class="relation-canvas"><svg viewBox="0 0 700 300" role="img" aria-label="Six Relations between four Notes"><defs><marker id="arrow-ui" markerWidth="8" markerHeight="8" refX="7" refY="3" orient="auto"><path d="M0,0 L0,6 L7,3 z"></path></marker></defs><line x1="160" y1="90" x2="360" y2="65" marker-end="url(#arrow-ui)"></line><line x1="170" y1="110" x2="340" y2="220" class="content-edge" marker-end="url(#arrow-ui)"></line><line x1="400" y1="85" x2="385" y2="205"></line><line x1="420" y1="215" x2="570" y2="130" marker-end="url(#arrow-ui)"></line>${[[100,60,"Research roadmap","n1"],[355,35,"Interview synthesis","n2"],[330,200,"Annotation model","n3"],[555,100,"Saver architecture","n4"]].map(([x,y,title,id]) => `<g class="relation-node ${state.selectedNote === id ? "selected" : ""}" data-open-note="${id}" tabindex="0" role="button" transform="translate(${x},${y})"><rect width="140" height="55" rx="7"></rect><text x="12" y="24">${title}</text><text x="12" y="42" class="node-meta">Open Note</text></g>`).join("")}</svg><div class="graph-legend"><span>Solid · manual Relation</span><span>Dashed · Content Reference</span><span>4 Notes shown · isolated Notes included in full data</span></div></div>`;
}
function relationsView(layout) {
  const inspector = `<aside class="relation-inspector"><span class="eyebrow">SELECTED NOTE</span><h2>Research roadmap</h2><p>3 Relations in Research library</p><ol class="relation-list"><li><strong>References</strong><br>Interview synthesis<small>Manual · Mina Chen</small></li><li><strong>Content Reference</strong><br>Annotation model<small>Source Revision 3</small></li><li><strong>Related to</strong><br>Saver architecture<small>Manual · Alex Rivera</small></li></ol><button class="primary" data-open-note="n1">Open Note</button><button data-action="add-relation">Add Relation</button><h3>Accessible list</h3><p class="microcopy">Every edge is also available as a source → label → target row. Filters and selected Note are shareable in the URL.</p></aside>`;
  return `${contextHeader("RESEARCH LIBRARY / RELATIONS", "A map of the material", "Manual Relations persist across Revisions; Content References name their source Revision.", '<button data-view="reader">Back to reader</button>')}<div class="relation-layout ${layout.toLowerCase()}-relations">${relationGraph()}${inspector}</div>`;
}
function membersView() {
  const people = [["Mina Chen", "Owner", "mina@example.org"], ["Alex Rivera", "Manager", "alex@example.org"], ["Sam Lee", "Viewer", "sam@example.org"], ["Jules Park", "Viewer", "jules@example.org"]];
  return `${contextHeader("RESEARCH LIBRARY / MEMBERS", "People and access", "One Owner, explicit roles, and authorship preserved after access changes.", state.role === "Manager" ? '<button class="primary" data-action="invite">Invite by email</button><button data-action="join-link">Create Join Link</button>' : "")}
  <div class="management-grid"><section class="panel"><div class="panel-heading"><h2>4 members</h2><span>Owner manages elevated roles</span></div>${people.map(([name, role, email]) => `<div class="member-row"><span class="avatar">${name.split(" ").map(part => part[0]).join("")}</span><div><strong>${name}</strong><small>${email}</small></div><select aria-label="Role for ${name}" ${state.role === "Viewer" || role === "Owner" ? "disabled" : ""}><option ${role === "Manager" ? "selected" : ""}>Manager</option><option ${role === "Viewer" ? "selected" : ""}>Viewer</option>${role === "Owner" ? '<option selected>Owner</option>' : ""}</select></div>`).join("")}</section><aside class="panel"><h2>Invitations and Join Links</h2><p>Invitations expire after seven days. Join Links have an explicit role and can be revoked.</p>${state.invited ? '<div class="notice-card">Invitation sent to new.reader@example.org as Viewer.</div>' : '<div class="empty-line">No pending Invitations</div>'}<label>Join Link role<select><option>Viewer</option><option>Manager</option></select></label><button data-action="join-link">Generate expiring link</button><hr><h3>Knowledge Base recovery</h3><p>Deletion moves the Knowledge Base to Trash for 30 days. Ownership transfer requires acceptance.</p></aside></div>`;
}
function extensionsView() {
  return `${contextHeader("RESEARCH LIBRARY / APP EXTENSIONS", "Extend the reader, keep the host in control", "Pinned, reviewable packages add Renderers and schema-driven Mark types.", state.role === "Manager" ? '<button class="primary" data-action="install-extension">Review new package</button>' : "")}
  <div class="extension-grid"><section class="panel extension-feature"><div class="extension-title"><span class="file-badge">EPUB</span><div><h2>Accessible EPUB Reader</h2><p>Version 1.4.2 · pinned hash · Renderer</p></div><span class="status ${state.extensionEnabled ? "on" : ""}">${state.extensionEnabled ? "Enabled" : "Disabled"}</span></div><p>Renders EPUB files inside a sandboxed iframe on a cookieless origin. The host mediates navigation, selections, and Anchors.</p><div class="permission-chips"><span>Read selected Revision</span><span>Report navigation</span><span>No network access</span></div><div class="button-row"><button data-action="toggle-extension">${state.extensionEnabled ? "Disable" : "Enable"}</button><button data-action="review-extension">Review update 1.5.0</button><button data-action="extension-data">Preserved data</button></div></section><aside class="panel"><h2>Custom Mark types</h2><div class="mark-type"><span class="mark-swatch"></span><div><strong>core:highlight</strong><small>Built in · always available</small></div></div><div class="mark-type"><span class="mark-swatch custom"></span><div><strong>review:needs-citation</strong><small>Schema v2 · enabled</small></div></div><hr><h3>Fallback is visible</h3><p>Disabling an App Extension never deletes its Anchors or Mark data. Unsupported files show diagnostics and the original download.</p></aside></div>`;
}
function agentsView() {
  return `${contextHeader("PERSONAL SETTINGS / MCP", "Let an Agent work as you", "A hosted, scoped interface with the same permissions and guarded operations as the web app.", '<button class="primary" data-action="create-token">Create token</button>')}
  <div class="agent-grid"><section class="panel"><span class="eyebrow">CONNECTION</span><h2>Hosted Streamable HTTP</h2><label>MCP endpoint<div class="copy-field"><code>https://api.onelastnote.example/mcp</code><button data-action="copy">Copy</button></div></label><ol class="setup-steps"><li><span>1</span><div><strong>Create a named personal access token</strong><p>Set an expiry and only the scopes the Agent needs.</p></div></li><li><span>2</span><div><strong>Add it to your MCP client</strong><p>Use the Authorization Bearer header; never share the token.</p></div></li><li><span>3</span><div><strong>Check authorship and audit</strong><p>Changes appear as “Mina Chen via Research Agent”.</p></div></li></ol></section><aside class="panel"><h2>Research Agent</h2><p>Expires in 27 days · Last used 8 minutes ago</p><div class="scope-list"><label><input type="checkbox" checked> Read Notes and Relations</label><label><input type="checkbox" checked> Create Comments and Marks</label><label><input type="checkbox"> Upload and replace Notes</label><label><input type="checkbox"> Manage App Extensions</label></div><button data-action="revoke-token">Revoke token</button><hr><p class="microcopy">The Agent can never exceed your Knowledge Base role. Destructive actions require their own scope and remain auditable.</p></aside></div>`;
}
function saverView(layout) {
  return `${contextHeader("CHROME SAVER / CAPTURE", "Save the useful part, not the noise", "A focused Manifest V3 popup that creates a clean HTML Note with copied media and source provenance.", '<button data-view="library">Open web app</button>')}
  <div class="saver-demo ${layout.toLowerCase()}-saver"><section class="web-page-preview"><div class="fake-browser-bar"><span></span><code>example.org/research/annotation</code></div><div class="web-page-copy"><span class="eyebrow">RESEARCH JOURNAL</span><h2>The life of an annotation</h2><p>Digital reading becomes collaborative when readers can attach meaning to a stable passage.</p><p class="web-selection">A selection can travel with its context while the original page remains only a source, not a dependency.</p><p>Advertisement, navigation, and unrelated page chrome are omitted by clean capture.</p></div></section><section class="saver-popup"><div class="saver-brand"><strong>One Last Note</strong><span>Saver</span></div><h2>Save to a Knowledge Base</h2><div class="capture-tabs"><button data-saver-mode="selection" class="${state.saverMode === "selection" ? "active" : ""}">Selection</button><button data-saver-mode="page" class="${state.saverMode === "page" ? "active" : ""}">Readable page</button></div><div class="capture-preview"><span class="source-label">${state.saverMode === "selection" ? "SELECTED PASSAGE" : "READABLE PAGE"}</span><p>${state.saverMode === "selection" ? "A selection can travel with its context…" : "The life of an annotation · clean article preview"}</p></div><label>Knowledge Base<select id="saver-target"><option>Research library</option><option>Product notes</option><option disabled>Read only archive · Viewer</option></select></label><div class="provenance"><span>Clean HTML</span><span>Source URL</span><span>Copied media</span></div><div class="duplicate-note">Possible duplicate: this canonical URL was saved on May 12. <button data-action="view-duplicate">Review</button></div><button class="primary save-button" data-action="save-web">${state.saverSaved ? "Saved · Open Note" : "Save Note"}</button><p class="microcopy">${state.saverSaved ? "Capture accepted. Media processing continues asynchronously; this attempt can be recovered." : "PKCE sign-in · writable Knowledge Bases only · no Feishu dependency"}</p></section></div>`;
}
function content(layout) {
  if (state.view === "library") return libraryView(layout);
  if (state.view === "reader") return readerView(layout);
  if (state.view === "relations") return relationsView(layout);
  if (state.view === "members") return membersView();
  if (state.view === "extensions") return extensionsView();
  if (state.view === "agents") return agentsView();
  return saverView(layout);
}
function variantA() {
  return `<div class="shell variant-a"><header class="a-topbar"><button class="brand" data-view="library"><span class="brand-mark">1</span><span>One Last Note</span></button><div class="kb-switcher"><span>Knowledge Base</span><strong>Research library</strong></div>${roleControl()}<span class="avatar">MC</span></header><div class="a-workspace"><aside class="a-sidebar">${nav("a-nav")}<div class="sidebar-foot"><strong>Research library</strong><span>Manager access</span><button data-view="members">Settings and members</button></div></aside><main class="a-main">${content("A")}</main></div></div>`;
}
function variantB() {
  return `<div class="shell variant-b"><header class="b-topbar"><button class="brand" data-view="library"><span class="brand-mark">1</span><span>ONE LAST NOTE</span></button>${nav("b-nav")}<div class="b-user">${roleControl()}<span class="avatar">MC</span></div></header><div class="b-command"><span><strong>Research library</strong> / ${views.find(([id]) => id === state.view)[1]}</span><label><span>Quick find</span><input placeholder="Notes, people, actions…"></label><span class="system-status">ALL CHANGES LOCAL</span></div><main class="b-main">${content("B")}</main></div>`;
}
function variantC() {
  return `<div class="shell variant-c"><header class="c-masthead"><button class="brand" data-view="library">One Last Note</button><p>A quieter place for shared reading.</p><div>${roleControl()}<span class="avatar">MC</span></div></header><div class="c-context"><span>Research library</span><span>Knowledge Base · ${state.role}</span></div>${nav("c-nav")}<main class="c-main">${content("C")}</main><footer class="c-footer">Notes are shared. Revisions are durable. Every Annotation has a home.</footer></div>`;
}
function render() {
  document.querySelector("#app").innerHTML = ({ A: variantA, B: variantB, C: variantC })[state.variant]();
  document.querySelector("#variant-label").textContent = `${state.variant} — ${variants[state.variant]}`;
  const role = document.querySelector("#role");
  if (role) role.value = state.role;
  const revision = document.querySelector("#revision");
  if (revision) revision.value = String(state.revision);
  const saverTarget = document.querySelector("#saver-target");
  if (saverTarget) saverTarget.value = state.saverTarget;
  document.querySelector("#state-json").textContent = JSON.stringify({ variant: state.variant, view: state.view, role: state.role, knowledgeBase: "Research library", selectedNote: state.selectedNote, renderer: state.format, revision: state.revision, annotationTab: state.annotationTab, comments: state.comments, marks: state.marks, saver: { mode: state.saverMode, target: state.saverTarget, saved: state.saverSaved }, extensionEnabled: state.extensionEnabled, shared: state.shared, invited: state.invited, message: state.message }, null, 2);
}
function cycleVariant(direction) {
  const keys = Object.keys(variants);
  state.variant = keys[(keys.indexOf(state.variant) + direction + keys.length) % keys.length];
  const params = new URLSearchParams(location.search);
  params.set("variant", state.variant);
  history.replaceState(null, "", `${location.pathname}?${params}`);
  state.message = `Showing ${variants[state.variant]}; the same product state is preserved.`;
  render();
}
function setView(view) {
  state.view = view;
  state.message = `Opened ${views.find(([id]) => id === view)[1]}. Navigation keeps Research library as the active context.`;
  render();
}
document.addEventListener("click", event => {
  const button = event.target.closest("button");
  if (!button) return;
  if (button.id === "previous-variant") return cycleVariant(-1);
  if (button.id === "next-variant") return cycleVariant(1);
  if (button.dataset.view) return setView(button.dataset.view);
  if (button.dataset.openNote) { state.selectedNote = button.dataset.openNote; state.format = state.selectedNote === "n3" ? "pdf" : state.selectedNote === "n2" || state.selectedNote === "n4" ? "html" : "markdown"; return setView("reader"); }
  if (button.dataset.format) { state.format = button.dataset.format; state.message = `${button.dataset.format} Renderer selected. Annotation and Revision controls stay in the same place.`; }
  if (button.dataset.annotations) { state.annotationTab = button.dataset.annotations; state.message = `Showing ${button.dataset.annotations}; Marks remain separate from Comments.`; }
  if (button.dataset.saverMode) { state.saverMode = button.dataset.saverMode; state.saverSaved = false; state.message = `${button.dataset.saverMode} capture selected.`; }
  if (button.dataset.deleteNote) { const note = state.notes.find(item => item.id === button.dataset.deleteNote); state.notes = state.notes.filter(item => item.id !== button.dataset.deleteNote); state.message = `${note.title} moved to 30-day association Trash with its Research library annotations.`; }
  if (button.dataset.action) {
    const action = button.dataset.action;
    if (action === "comment") { const input = document.querySelector("#comment-input"); state.comments.push({ id: `c${Date.now()}`, author: "Mina Chen", time: "Now", anchor: state.format === "pdf" ? "selected PDF region" : "selected passage", text: input && input.value.trim() ? input.value.trim() : "A new anchored Comment for this selection.", replies: [] }); state.annotationTab = "comments"; state.message = "Comment added with Mina Chen as writer and a Revision-aware Anchor."; }
    if (action === "mark") { state.marks.push({ id: `m${Date.now()}`, type: "core:highlight", author: "Mina Chen", anchor: state.format === "pdf" ? "selected PDF region" : "selected passage" }); state.annotationTab = "marks"; state.message = "Highlight added without comment text."; }
    if (action === "reply") state.message = "One-level reply composer would open beneath this Comment.";
    if (action === "anchor") state.message = "Anchor selected. The reader would reveal its passage or PDF region without changing Revisions.";
    if (action === "upload") { if (!state.uploaded) { state.notes.unshift({ id: "n5", title: "Uploaded field notes", format: "MD", updated: "Now", comments: 0, author: "Mina Chen" }); state.uploaded = true; } state.message = "Upload accepted: original file preserved, derivative processing queued, and Manager authorship recorded."; }
    if (action === "share") { state.shared = true; state.message = "Sharing requires another Manager in the target Knowledge Base. Annotations stay scoped to each association."; }
    if (action === "invite") { state.invited = true; state.message = "Viewer Invitation created with a seven-day expiry."; }
    if (action === "join-link") state.message = "Role-selectable Join Link created with an expiry and revoke control.";
    if (action === "add-relation") state.message = "Add Relation opens source, typed label, and target controls; self-links and exact duplicates are rejected.";
    if (action === "toggle-extension") { state.extensionEnabled = !state.extensionEnabled; state.message = `App Extension ${state.extensionEnabled ? "enabled" : "disabled"}. Existing Renderer and Mark data is preserved.`; }
    if (["review-extension", "install-extension", "extension-data"].includes(action)) state.message = "Package review shows the pinned version, hash, requested capabilities, lifecycle changes, and preserved fallback data.";
    if (["create-token", "revoke-token", "copy"].includes(action)) state.message = action === "copy" ? "MCP endpoint copied in this prototype." : "Token lifecycle is named, expiring, scoped, revocable, and visible in audit.";
    if (action === "save-web") { state.saverSaved = !state.saverSaved; state.message = state.saverSaved ? "Clean HTML Note accepted into Research library with copied media and source provenance." : "Saver reset for another capture."; }
    if (action === "view-duplicate") state.message = "Duplicate warning compares canonical URLs; the User can open the existing Note or save anyway.";
    if (["more", "close-annotations"].includes(action)) state.message = action === "more" ? "Note actions include original download, Revision history, sharing, replacement, and Trash according to role." : "Annotations collapse into a reopen control on small screens; no discussion is deleted.";
  }
  render();
});
document.addEventListener("change", event => {
  if (event.target.id === "role") { state.role = event.target.value; state.message = state.role === "Viewer" ? "Viewer mode: uploads, deletion, membership, and extension administration are unavailable; reading and annotation remain." : "Manager mode: collection and Viewer management actions are available."; render(); }
  if (event.target.id === "revision") { state.revision = Number(event.target.value); state.message = `Revision ${state.revision} selected. Anchors resolve against this immutable Revision.`; render(); }
  if (event.target.id === "saver-target") { state.saverTarget = event.target.value; state.saverSaved = false; state.message = `Saver will target ${state.saverTarget}; its annotation scope is explicit.`; render(); }
});
document.addEventListener("keydown", event => {
  if (event.target.matches("input, textarea, select, [contenteditable]")) return;
  if ((event.key === "Enter" || event.key === " ") && event.target.dataset.openNote) { event.preventDefault(); state.selectedNote = event.target.dataset.openNote; setView("reader"); return; }
  if (event.key === "ArrowLeft") cycleVariant(-1);
  if (event.key === "ArrowRight") cycleVariant(1);
});
render();
