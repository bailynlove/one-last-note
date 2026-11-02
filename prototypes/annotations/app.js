const variants = { A: "Anchored sidebar", B: "Inline stream", C: "Review feed" };
const state = {
  variant: new URLSearchParams(location.search).get("variant") || "A",
  format: "markdown",
  revision: 3,
  selectedText: "",
  annotations: [
    { id: "a1", kind: "comment", markType: null, text: "Should this anchor survive a new Revision?", author: "Mina Chen", avatar: "MC", createdAt: "10:14", revision: 3, anchor: { exact: "Selection is a relationship to immutable content", prefix: "In practice, ", suffix: ", not just a screen coordinate." }, replies: ["Keep the old Revision available."], extension: null },
    { id: "a2", kind: "mark", markType: "highlight", text: null, author: "Alex Rivera", avatar: "AR", createdAt: "10:18", revision: 3, anchor: { exact: "stable identity", prefix: "A ", suffix: " keeps the discussion attached." }, replies: [], extension: null },
    { id: "a3", kind: "mark", markType: "key-point", text: null, author: "Mina Chen", avatar: "MC", createdAt: "10:21", revision: 3, anchor: { exact: "stable identity", prefix: "A ", suffix: " keeps the discussion attached." }, replies: [], extension: { id: "example.marks", version: "1.0.0", payload: { emphasis: "key-point" } } }
  ]
};
if (!variants[state.variant]) state.variant = "A";

function cycleVariant(direction) {
  const keys = Object.keys(variants);
  state.variant = keys[(keys.indexOf(state.variant) + direction + keys.length) % keys.length];
  const params = new URLSearchParams(location.search);
  params.set("variant", state.variant);
  history.replaceState(null, "", `${location.pathname}?${params}`);
  render();
}

function documentMarkup() {
  const revisionNotice = state.revision === 2 ? `<div class="stale-banner">Viewing immutable Revision 2 · Revision 3 annotations need re-anchoring</div>` : "";
  const body = `<div class="article"><h2>Anchors, identity, and context</h2><p>In practice, <span class="mark-highlight">Selection is a relationship to immutable content</span>, not just a screen coordinate.</p><p>A <span class="overlap">stable identity</span> keeps the discussion attached. This sentence has overlapping Highlight and Key point Marks.</p><p>Select any text in this paragraph. The prototype will offer Highlight, Key point, or Comment. Only Comment accepts text.</p><p>Revision ${state.revision} · ${state.format.toUpperCase()} · Knowledge Base-scoped annotations.</p></div>`;
  if (state.format === "pdf") return `${revisionNotice}<div class="pdf-region"><div class="article"><h2>PDF page 1</h2><p>PDF text remains selectable through the text layer.</p><p>Select this sentence to create an anchored annotation.</p></div><div class="region-overlay">Existing custom Mark region · x=18%, y=42%, w=34%, h=12%</div></div>`;
  return revisionNotice + body;
}

function cardMarkup(annotation) {
  const stale = annotation.revision !== state.revision;
  const text = annotation.kind === "comment" ? `<p>${annotation.text}</p>` : `<p><em>No comment text — this is a Mark.</em></p>`;
  const replies = annotation.replies.map(reply => `<p class="reply">↳ ${reply}</p>`).join("");
  const replyButton = annotation.kind === "comment" ? `<button data-reply="${annotation.id}">Reply</button><button data-edit="${annotation.id}">Edit</button>` : "";
  return `<article class="annotation-card ${annotation.kind} ${stale ? "stale" : ""}"><div class="annotation-meta"><span class="avatar">${annotation.avatar}</span><strong>${annotation.author}</strong><span>${annotation.createdAt}</span><span>r${annotation.revision}</span></div><div class="kind-label">${annotation.kind === "mark" ? annotation.markType : "comment"}${annotation.extension ? " · App Extension" : ""}</div><div class="anchor-text">“${annotation.anchor.exact}”${stale ? " · NEEDS RE-ANCHORING" : ""}</div>${text}${replies}<div class="annotation-actions">${replyButton}<button data-delete="${annotation.id}">Delete</button></div></article>`;
}

function render() {
  document.querySelectorAll(".variant").forEach(el => el.classList.add("hidden"));
  document.querySelector(`#variant-${state.variant.toLowerCase()}`).classList.remove("hidden");
  document.querySelector("#formats").innerHTML = ["markdown", "html", "pdf"].map(format => `<button data-format="${format}" class="${state.format === format ? "active" : ""}">${format.toUpperCase()}</button>`).join("");
  document.querySelector("#revisions").innerHTML = [3, 2].map(revision => `<button data-revision="${revision}" class="${state.revision === revision ? "active" : ""}">Revision ${revision}</button>`).join("");
  document.querySelectorAll("[data-document]").forEach(el => el.innerHTML = documentMarkup());
  document.querySelectorAll("[data-list]").forEach(el => el.innerHTML = state.annotations.map(cardMarkup).join(""));
  document.querySelector("#review-count").textContent = `${state.annotations.length} annotations`;
  document.querySelector("#variant-label").textContent = `${state.variant} — ${variants[state.variant]}`;
  document.querySelector("#state-json").textContent = JSON.stringify({ variant: state.variant, format: state.format, revision: state.revision, selectedText: state.selectedText, annotations: state.annotations }, null, 2);
}

function addAnnotation(type, text = null) {
  const now = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  state.annotations.push({
    id: `a${Date.now()}`, kind: type === "comment" ? "comment" : "mark", markType: type === "comment" ? null : type,
    text, author: "You", avatar: "YO", createdAt: now, revision: state.revision,
    anchor: { exact: state.selectedText, prefix: "prototype prefix", suffix: "prototype suffix" },
    replies: [], extension: type === "key-point" ? { id: "example.marks", version: "1.0.0", payload: { emphasis: "key-point" } } : null
  });
  state.selectedText = "";
  document.querySelector("#selection-tools").classList.add("hidden");
  render();
}

document.addEventListener("mouseup", event => {
  const selection = window.getSelection().toString().trim();
  if (!selection || event.target.closest(".annotation-card, #state-panel")) return;
  state.selectedText = selection;
  document.querySelector("#selected-text").textContent = `“${selection.slice(0, 80)}”`;
  document.querySelector("#selection-tools").classList.remove("hidden");
  render();
});

document.addEventListener("click", event => {
  const button = event.target.closest("button");
  if (!button) return;
  if (button.dataset.format) state.format = button.dataset.format;
  if (button.dataset.revision) state.revision = Number(button.dataset.revision);
  if (button.id === "previous-variant") return cycleVariant(-1);
  if (button.id === "next-variant") return cycleVariant(1);
  if (button.dataset.create === "comment") {
    document.querySelector("#composer-anchor").textContent = `Anchor: “${state.selectedText}”`;
    document.querySelector("#composer").classList.remove("hidden");
    return;
  }
  if (button.dataset.create === "highlight") return addAnnotation("highlight");
  if (button.dataset.create === "key-point") return addAnnotation("key-point");
  if (button.dataset.delete) {
    const annotation = state.annotations.find(item => item.id === button.dataset.delete);
    if (annotation.kind === "comment" && annotation.replies.length) annotation.text = "Comment deleted";
    else state.annotations = state.annotations.filter(item => item.id !== button.dataset.delete);
  }
  if (button.dataset.reply) {
    const reply = prompt("Reply text");
    if (reply) state.annotations.find(item => item.id === button.dataset.reply).replies.push(reply);
  }
  if (button.dataset.edit) {
    const annotation = state.annotations.find(item => item.id === button.dataset.edit);
    const text = prompt("Edit Comment", annotation.text);
    if (text) annotation.text = text;
  }
  if (button.id === "save-comment") {
    const text = document.querySelector("#comment-text").value.trim();
    if (text) { addAnnotation("comment", text); document.querySelector("#composer").classList.add("hidden"); document.querySelector("#comment-text").value = ""; }
    return;
  }
  if (button.id === "cancel-comment") document.querySelector("#composer").classList.add("hidden");
  render();
});

document.addEventListener("keydown", event => {
  if (event.target.matches("input, textarea, [contenteditable]")) return;
  if (event.key === "ArrowLeft") cycleVariant(-1);
  if (event.key === "ArrowRight") cycleVariant(1);
});

render();
