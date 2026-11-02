const variants = { A: "Focused reader", B: "Split workspace", C: "Source workbench" };
const state = { variant: new URLSearchParams(location.search).get("variant") || "A", format: "markdown", revision: 3, failed: false };
if (!variants[state.variant]) state.variant = "A";

const samples = {
  markdown: {
    title: "Markdown · GitHub-flavored subset",
    raw: "# Annotation model\n\n- Select text\n- Preserve context\n\n**Revision 3**\n\n| Anchor | Status |\n| --- | --- |\n| Text | Ready |\n\n```js\nanchor.capture(selection)\n```\n\n<script>alert('removed')</script>",
    policy: "Raw HTML removed · task lists, tables and code enabled",
    html: `<div class="safety-note">GFM subset · raw HTML stripped · links restricted to safe schemes</div><div class="article-content"><h2>Annotation model</h2><ul><li>Select text</li><li>Preserve context</li></ul><p><strong>Revision <span class="revision-number"></span></strong></p><table><tr><th>Anchor</th><th>Status</th></tr><tr><td>Text</td><td>Ready</td></tr></table><pre>anchor.capture(selection)</pre><p>Select any sentence here to preview its anchor.</p></div>`
  },
  html: {
    title: "HTML · sandboxed original derivative",
    raw: "<h1>Annotation model</h1><p>Original source retained.</p><img src=\"https://external.example/tracker.png\"><script>alert('not executed')</script><a href=\"javascript:alert(1)\">Unsafe link</a>",
    policy: "Same-origin sandbox · scripts, forms, popups and top navigation disabled · external assets opt-in · parent selection listeners",
    html: `<div class="safety-note">Sandboxed original layout · scripts disabled · external assets require opt-in</div><div class="article-content"><h2>Annotation model</h2><p>Original source retained. Revision <span class="revision-number"></span>.</p><div class="asset-placeholder">External image blocked by default<br>No network request was made</div><p><a>Unsafe link disabled</a></p><p>Select this paragraph to preview a text anchor.</p></div>`
  },
  pdf: {
    title: "PDF.js-style · text layer and region overlays",
    raw: "Original PDF bytes preserved\nTarget: PDF.js-style text layer with app-controlled navigation\nThis throwaway prototype uses a native iframe only to demonstrate layout",
    policy: "PDF.js-style text layer · app-controlled page, zoom and search · region overlays for Comments and Marks",
    html: `<div class="safety-note">Target behavior: PDF.js-style text layer · Revision <span class="revision-number"></span> · app-controlled navigation and region overlays. The sample iframe demonstrates layout only.</div><iframe class="pdf-frame" src="/sample.pdf" title="Sample PDF"></iframe>`
  }
};

function cycleVariant(direction) {
  const keys = Object.keys(variants);
  state.variant = keys[(keys.indexOf(state.variant) + direction + keys.length) % keys.length];
  const params = new URLSearchParams(location.search);
  params.set("variant", state.variant);
  history.replaceState(null, "", `${location.pathname}?${params}`);
  render();
}

function contentMarkup() {
  if (state.failed) return `<div class="failure"><h2>Rendering failed safely</h2><p>The original file remains available. No partially sanitized content is shown.</p><button data-action="retry">Retry rendering</button><button data-action="download">Download original</button></div>`;
  return samples[state.format].html.replaceAll('<span class="revision-number"></span>', `<span class="revision-number">${state.revision}</span>`);
}

function contractMarkup() {
  const sample = samples[state.format];
  return `<div class="contract"><h2>Renderer contract</h2><dl><dt>Input</dt><dd>revisionId, mediaType, originalFileUrl, policy</dd><dt>Output</dt><dd>selectable content + navigation + diagnostics</dd><dt>Format</dt><dd>${state.format}</dd><dt>Policy</dt><dd>${sample.policy}</dd><dt>State</dt><dd>${state.failed ? "failed; original available" : "ready; selectable"}</dd><dt>Extension</dt><dd>same input/output boundary; built-ins are not special in this prototype</dd></dl></div>`;
}

function render() {
  document.querySelectorAll(".variant").forEach(el => el.classList.add("hidden"));
  document.querySelector(`#variant-${state.variant.toLowerCase()}`).classList.remove("hidden");
  document.querySelectorAll("[data-formats]").forEach(nav => {
    nav.innerHTML = Object.keys(samples).map(format => `<button data-format="${format}" class="${state.format === format ? "active" : ""}">${format.toUpperCase()}</button>`).join("");
  });
  document.querySelectorAll("[data-revisions]").forEach(nav => {
    nav.innerHTML = [3, 2].map(revision => `<button data-revision="${revision}" class="${state.revision === revision ? "active" : ""}">${revision === 3 ? "Current · r3" : "Previous · r2"}</button>`).join("");
  });
  document.querySelectorAll("[data-render]").forEach(el => el.innerHTML = contentMarkup());
  document.querySelectorAll("[data-contract]").forEach(el => el.innerHTML = contractMarkup());
  document.querySelector("#raw-source").textContent = state.failed ? "Original bytes are unchanged." : samples[state.format].raw;
  document.querySelector("#variant-label").textContent = `${state.variant} — ${variants[state.variant]}`;
  document.querySelector("#state-strip").textContent = `STATE · variant=${state.variant} · format=${state.format} · revision=r${state.revision} · ${state.failed ? "failed" : "ready"}`;
}

document.addEventListener("click", event => {
  const button = event.target.closest("button");
  if (!button) return;
  if (button.dataset.format) { state.format = button.dataset.format; state.failed = false; }
  if (button.dataset.revision) { state.revision = Number(button.dataset.revision); state.failed = false; }
  if (button.dataset.action === "failure") state.failed = true;
  if (button.dataset.action === "retry") state.failed = false;
  if (button.dataset.action === "download") alert("Prototype: original immutable Revision would download here.");
  if (button.id === "previous-variant") return cycleVariant(-1);
  if (button.id === "next-variant") return cycleVariant(1);
  render();
});

document.addEventListener("mouseup", () => {
  const selection = window.getSelection().toString().trim();
  const preview = document.querySelector("#selection-preview");
  if (!selection) { preview.classList.add("hidden"); return; }
  preview.textContent = `Selection preview · ${selection.slice(0, 100)}`;
  preview.classList.remove("hidden");
});

document.addEventListener("keydown", event => {
  if (event.target.matches("input, textarea, [contenteditable]")) return;
  if (event.key === "ArrowLeft") cycleVariant(-1);
  if (event.key === "ArrowRight") cycleVariant(1);
});

render();
