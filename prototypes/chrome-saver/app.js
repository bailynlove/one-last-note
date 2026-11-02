// Three Chrome Saver popup variants on a mock source page, switchable via ?variant=.
const variants = { A: "Focused capture", B: "Preview-first review", C: "One-click quick save" };
const knowledgeBases = ["Research library", "Product inspiration", "Engineering reading"];
const state = {
  variant: new URLSearchParams(location.search).get("variant") || "A",
  scenario: "ready",
  signedIn: true,
  captureMode: "page",
  title: "Designing notes that survive their sources",
  target: "Research library",
  status: "idle",
  duplicateAcknowledged: false,
  handoff: null,
  attemptId: null,
  snapshot: null
};
if (!variants[state.variant]) state.variant = "A";

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
}

function cycleVariant(direction) {
  const keys = Object.keys(variants);
  state.variant = keys[(keys.indexOf(state.variant) + direction + keys.length) % keys.length];
  const params = new URLSearchParams(location.search);
  params.set("variant", state.variant);
  history.replaceState(null, "", `${location.pathname}?${params}`);
  render();
}

function resetScenario(scenario) {
  state.scenario = scenario;
  state.signedIn = scenario !== "signed-out";
  state.captureMode = scenario === "selection" ? "selection" : "page";
  state.status = ({ duplicate: "duplicate", offline: "offline", permission: "permission", unsupported: "unsupported", recovered: "saving" })[scenario] || "idle";
  state.duplicateAcknowledged = false;
  state.handoff = null;
  state.attemptId = scenario === "recovered" ? "attempt-recovered-7f2a" : null;
  state.snapshot = scenario === "recovered" ? makeSnapshot() : null;
}

function makeSnapshot() {
  return {
    captureMode: state.captureMode,
    title: state.title,
    sourceUrl: "https://example.com/resilient-notes",
    canonicalUrl: "https://example.com/resilient-notes",
    author: "Mina Chen",
    publishedAt: "2026-10-18",
    capturedAt: "2026-11-02T10:24:00Z",
    html: state.captureMode === "selection" ? "<blockquote>…selected passage…</blockquote>" : "<article>…allowlisted clean HTML…</article>",
    frozen: true
  };
}

function header() {
  return `<div class="popup-header"><div class="brand"><span class="brand-dot"></span>One Last Note <span class="account">SAVER</span></div><span class="account">${state.signedIn ? "you@example.com" : "Not connected"}</span></div>`;
}

function modeSwitch() {
  return `<div class="mode-switch"><button data-action="mode" data-mode="page" class="${state.captureMode === "page" ? "active" : ""}">Full page</button><button data-action="mode" data-mode="selection" class="${state.captureMode === "selection" ? "active" : ""}">Selected passage</button></div>`;
}

function titleField() {
  return `<div class="field"><label for="note-title">Note title</label><input id="note-title" data-field="title" value="${escapeHtml(state.title)}"></div>`;
}

function targetField() {
  return `<div class="field"><label for="note-target">Knowledge Base · Managers only</label><select id="note-target" data-field="target">${knowledgeBases.map(name => `<option ${state.target === name ? "selected" : ""}>${name}</option>`).join("")}</select></div>`;
}

function captureSummary() {
  const selection = state.captureMode === "selection";
  return `<div class="capture-summary"><strong>${selection ? "Selected passage" : "Readable page"}</strong><p>${selection ? "“A selected passage needs the same clean structure and provenance…”" : "Article body, headings, quote, and safe links. Navigation, forms, and scripts excluded."}</p><div class="metadata"><span>example.com</span><span>Mina Chen</span><span>Captured just now</span></div></div>`;
}

function notice() {
  if (state.status === "duplicate" && !state.duplicateAcknowledged) return `<div class="notice warning"><strong>A Note from this canonical URL already exists here</strong>“Designing notes that survive their sources” was saved 3 days ago. This remains a separate save; no automatic merge.<div class="result-actions"><button class="secondary" data-action="open-note">Open existing</button><button class="text-button" data-action="save">Save anyway</button></div></div>`;
  if (state.status === "offline") return `<div class="notice error"><strong>Could not reach One Last Note</strong>Your reviewed snapshot is still in this popup. Check the connection and retry with the same attempt ID.<div class="result-actions"><button class="secondary" data-action="retry">Retry save</button></div></div>`;
  if (state.status === "permission") return `<div class="notice error"><strong>Manager access required</strong>You are now a Viewer in ${escapeHtml(state.target)}. Choose another Knowledge Base; no Note was created.</div>`;
  if (state.status === "unsupported") return `<div class="notice error"><strong>This browser page cannot be captured</strong>Open an HTTP(S) page and invoke Saver again. Chrome internal pages and the Web Store are unsupported.</div>`;
  if (state.status === "saving") return `<div class="notice progress"><strong>Saving your frozen snapshot…</strong>Attempt ${state.attemptId || "new"} · safe to close and reopen this popup.</div>`;
  if (state.status === "success") return `<div class="notice success"><strong>${state.handoff ? "Handoff ready" : "Saved as a new Note"}</strong>${escapeHtml(state.title)} → ${escapeHtml(state.target)}<div class="result-actions"><button class="primary" data-action="open-note">${state.handoff === "note" ? "Note opened in web app" : "Open Note"}</button><button class="secondary" data-action="open-kb">Open Knowledge Base</button></div></div>`;
  return "";
}

function cleanPreview() {
  const selection = state.captureMode === "selection";
  return `<div class="preview-label">SANITIZED HTML · EXACT SNAPSHOT TO SAVE</div><div class="clean-preview"><h2>${escapeHtml(state.title)}</h2>${selection ? "<blockquote>A selected passage needs the same clean structure and provenance as a full page, without silently becoming a full-page capture.</blockquote>" : "<p>A useful note keeps its source, its structure, and the reason it mattered.</p><blockquote>A selected passage needs the same clean structure and provenance as a full page.</blockquote><h3>Capture is a reviewable snapshot</h3><p>Links, headings, lists, and images retain their meaning while active page code is left behind.</p>"}<hr><small>Source: example.com · Mina Chen · Captured just now</small></div>`;
}

function signedOut() {
  return `${header()}<div class="signed-out"><span class="brand-dot"></span><h2>Connect Saver to your Notes</h2><p>Sign in through the web app. Saver receives only your identity and Knowledge Bases where you can add Notes.</p><button class="primary full" data-action="sign-in">Sign in to One Last Note</button><p class="fine-print">No page content leaves the browser until you review and save.</p></div>`;
}

function variantA() {
  return `${header()}<div class="popup-body">${modeSwitch()}${notice()}${titleField()}${targetField()}${captureSummary()}<button class="primary full" data-action="save">Save as new Note</button><p class="fine-print">Clean HTML · source URL, author, publication date, and capture time retained.</p></div>`;
}

function variantB() {
  return `${header()}${notice()}<div class="review-grid"><div>${cleanPreview()}</div><div>${modeSwitch()}${titleField()}${targetField()}<div class="field"><span class="field-label">Source metadata</span><div class="metadata"><span>Canonical URL detected</span><span>Author: Mina Chen</span><span>Published: 2026-10-18</span></div></div></div></div><div class="review-footer"><span class="fine-print">Preview and save use the same frozen snapshot.</span><button class="primary" data-action="save">Save Note</button></div>`;
}

function variantC() {
  return `${header()}<div class="quick-hero"><span class="quick-icon">↓</span><h2>${state.captureMode === "selection" ? "Save this passage" : "Save this page"}</h2><p>as a clean HTML Note</p></div>${notice()}<div class="quick-target"><div><small>SAVE TO</small><strong>${escapeHtml(state.target)}</strong></div><button class="text-button" data-action="cycle-target">Change</button></div><div class="quick-actions"><button class="primary full" data-action="save">Save ${state.captureMode === "selection" ? "passage" : "page"}</button><div class="quick-secondary"><button class="secondary" data-action="mode" data-mode="${state.captureMode === "selection" ? "page" : "selection"}">Use ${state.captureMode === "selection" ? "full page" : "selection"}</button><button class="secondary" data-action="preview">Review HTML</button></div></div><details><summary>Title, source, and save details</summary>${titleField()}${captureSummary()}<p class="fine-print">Every deliberate save creates a distinct Note. Technical retries reuse one attempt.</p></details>`;
}

function render() {
  const popup = document.querySelector("#popup");
  popup.className = `popup ${state.variant === "B" ? "review" : state.variant === "C" ? "quick" : "focused"}`;
  popup.innerHTML = !state.signedIn ? signedOut() : ({ A: variantA, B: variantB, C: variantC })[state.variant]();
  document.querySelector("#scenario").value = state.scenario;
  document.querySelector("#selected-passage").style.background = state.captureMode === "selection" ? "#fff0a8" : "#fff9d9";
  document.querySelector("#variant-label").textContent = `${state.variant} — ${variants[state.variant]}`;
  document.querySelector("#state-json").textContent = JSON.stringify({ variant: state.variant, scenario: state.scenario, signedIn: state.signedIn, targetKnowledgeBase: state.target, status: state.status, duplicateAcknowledged: state.duplicateAcknowledged, attemptId: state.attemptId, handoff: state.handoff, reviewedSnapshot: state.snapshot }, null, 2);
}

function beginSave() {
  if (state.status === "unsupported" || state.status === "permission" || state.status === "saving") return;
  if (state.status === "duplicate" && !state.duplicateAcknowledged) {
    state.duplicateAcknowledged = true;
  }
  state.status = "saving";
  state.attemptId = state.attemptId || "attempt-9b31-same-on-retry";
  state.snapshot = makeSnapshot();
  render();
  if (state.scenario !== "recovered") {
    setTimeout(() => {
      state.status = "success";
      render();
    }, 700);
  }
}

document.addEventListener("click", event => {
  const button = event.target.closest("button");
  if (!button) return;
  const action = button.dataset.action;
  if (button.id === "previous-variant") return cycleVariant(-1);
  if (button.id === "next-variant") return cycleVariant(1);
  if (action === "sign-in") resetScenario("ready");
  if (action === "mode") {
    state.captureMode = button.dataset.mode;
    state.status = "idle";
    state.snapshot = null;
  }
  if (action === "cycle-target") state.target = knowledgeBases[(knowledgeBases.indexOf(state.target) + 1) % knowledgeBases.length];
  if (action === "save" || action === "retry") return beginSave();
  if (action === "open-note") {
    if (state.status === "duplicate") state.status = "success";
    state.handoff = "note";
  }
  if (action === "open-kb") state.handoff = "knowledge-base";
  if (action === "preview") {
    state.variant = "B";
    const params = new URLSearchParams(location.search);
    params.set("variant", "B");
    history.replaceState(null, "", `${location.pathname}?${params}`);
  }
  render();
});

document.addEventListener("input", event => {
  if (event.target.dataset.field === "title") state.title = event.target.value;
  if (event.target.dataset.field === "target") state.target = event.target.value;
  state.snapshot = null;
  render();
});

document.querySelector("#scenario").addEventListener("change", event => {
  resetScenario(event.target.value);
  render();
});

document.addEventListener("keydown", event => {
  if (event.target.matches("input, textarea, select, [contenteditable]")) return;
  if (event.key === "ArrowLeft") cycleVariant(-1);
  if (event.key === "ArrowRight") cycleVariant(1);
});

render();
