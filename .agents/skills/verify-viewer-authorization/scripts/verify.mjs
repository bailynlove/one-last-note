import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const sourcePath = resolve(root, "prototypes/web-app/app.js");
const source = readFileSync(sourcePath, "utf8");
const script = new vm.Script(source, { filename: sourcePath });
const depth = 3;
const operations = [
  { label: "Upload Note", dataset: { action: "upload" } },
  { label: "Share Note", dataset: { action: "share" } },
  { label: "Invite by email", dataset: { action: "invite" } },
  { label: "Generate Join Link", dataset: { action: "join-link" } },
  { label: "Review new App Extension package", dataset: { action: "install-extension" } },
  { label: "Review App Extension update", dataset: { action: "review-extension" } },
  { label: "Disable or enable App Extension", dataset: { action: "toggle-extension" } },
  ...["n1", "n2", "n3", "n4"].map(id => ({
    label: `Move ${id} to Trash`,
    dataset: { deleteNote: id }
  }))
];

function productState(context) {
  const state = vm.runInContext("state", context);
  const { message, ...product } = state;
  return JSON.parse(JSON.stringify(product));
}

function firstDifference(before, after, path = "state") {
  if (JSON.stringify(before) === JSON.stringify(after)) return null;
  if (typeof before !== "object" || before === null || typeof after !== "object" || after === null) {
    return { path, before, after };
  }
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    const difference = firstDifference(before[key], after[key], `${path}.${key}`);
    if (difference) return difference;
  }
  return null;
}

function startViewerSession() {
  const elements = new Map();
  const listeners = {};
  const document = {
    querySelector(selector) {
      if (!elements.has(selector)) {
        elements.set(selector, { innerHTML: "", textContent: "", value: "" });
      }
      return elements.get(selector);
    },
    addEventListener(type, listener) {
      listeners[type] = listener;
    }
  };
  const context = vm.createContext({
    console,
    Date,
    document,
    history: { replaceState() {} },
    location: { pathname: "/", search: "?variant=A" },
    structuredClone,
    URLSearchParams
  });
  script.runInContext(context);
  listeners.change({ target: { id: "role", value: "Viewer" } });
  return { context, listeners };
}

function click(listeners, dataset) {
  const button = { dataset, id: "" };
  listeners.click({ target: { closest: selector => selector === "button" ? button : null } });
}

function check(sequence) {
  const { context, listeners } = startViewerSession();
  const initial = productState(context);
  for (const operation of sequence) {
    const before = productState(context);
    click(listeners, operation.dataset);
    const after = productState(context);
    const difference = firstDifference(before, after);
    if (difference) {
      return { sequence, initial, difference };
    }
  }
  return null;
}

const failures = [];
let checked = 0;

function explore(sequence) {
  checked += 1;
  const failure = check(sequence);
  if (failure) failures.push(failure);
  if (sequence.length === depth) return;
  for (const operation of operations) explore([...sequence, operation]);
}

explore([]);
const sequencesChecked = checked - 1;
const counterexamples = failures.filter(failure => failure.sequence.length === 1);

if (failures.length > 0) {
  console.error("FAIL: Viewer authorization — a Viewer can change Manager-owned product state.");
  console.error(`Found ${failures.length} failing sequences among ${sequencesChecked} generated sequences (length 1–${depth}).`);
  console.error("Shortest counterexamples, after selecting Acting as = Viewer:");
  for (const failure of counterexamples) {
    const { label } = failure.sequence[0];
    const { path, before, after } = failure.difference;
    console.error(`- ${label}: ${path} changed from ${JSON.stringify(before)} to ${JSON.stringify(after)}.`);
  }
  console.error("Scope: actual prototypes/web-app/app.js event handlers and in-memory state; synthetic clicks include hidden controls.");
  process.exitCode = 1;
} else {
  console.log(`PASS: Viewer authorization held for all ${sequencesChecked} generated Manager-action sequences of length 1–${depth}.`);
  console.log("Scope: actual prototypes/web-app/app.js event handlers and in-memory state; no backend or browser security is covered.");
}
