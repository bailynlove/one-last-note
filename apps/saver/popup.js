import { API_BASE_URL, WEB_APP_URL } from './config.js';

const AUTH_KEY = 'auth';
const DRAFT_KEY = 'captureDraft';

const state = {
  auth: null,
  targets: [],
  tab: null,
  mode: 'page',
  targetId: null,
  selection: null,
  duplicate: null,
  attempt: null,
  draft: null,
  busy: false,
  error: null,
};

const $ = (id) => document.getElementById(id);
const connect = $('connect');
const form = $('form');
const target = $('target');
const save = $('save');
const duplicate = $('duplicate');
const error = $('error');
const progress = $('progress');

function base64url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

async function createVerifier() {
  return base64url(crypto.getRandomValues(new Uint8Array(32)));
}

async function challengeFor(verifier) {
  return base64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
}

async function readAuth() {
  const value = await chrome.storage.local.get(AUTH_KEY);
  return value[AUTH_KEY] ?? null;
}

async function writeAuth(auth) {
  state.auth = auth;
  if (auth) await chrome.storage.local.set({ [AUTH_KEY]: auth });
  else await chrome.storage.local.remove(AUTH_KEY);
}

async function readDraft() {
  const value = await chrome.storage.local.get(DRAFT_KEY);
  return value[DRAFT_KEY] ?? null;
}

async function writeDraft(draft) {
  state.draft = draft;
  if (!draft) {
    await chrome.storage.local.remove(DRAFT_KEY);
    return;
  }
  // Keep captured HTML/selection only in memory; the API owns the snapshot after enqueue.
  const { targetId, url, mode, idempotencyKey, attemptId, createdAt } = draft;
  await chrome.storage.local.set({
    [DRAFT_KEY]: { targetId, url, mode, idempotencyKey, attemptId, createdAt },
  });
}

function authHeaders(auth = state.auth) {
  return auth ? { authorization: `Bearer ${auth.token}` } : {};
}

async function rawRefresh() {
  if (!state.auth?.refreshToken) throw new Error('Connect the Saver again.');
  const response = await fetch(`${API_BASE_URL}/auth/extension/refresh`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ refreshToken: state.auth.refreshToken }),
  });
  if (!response.ok) throw new Error('The Saver session expired. Connect again.');
  const body = await response.json();
  await writeAuth({
    token: body.token,
    expiresAt: body.expiresAt,
    refreshToken: body.refreshToken,
    refreshExpiresAt: body.refreshExpiresAt,
    user: body.user,
  });
}

async function api(path, init = {}, retry = true) {
  if (!state.auth) throw new Error('Connect the Saver first.');
  if (Date.parse(state.auth.expiresAt) - Date.now() < 60_000) {
    await rawRefresh();
  }

  const headers = new Headers(init.headers);
  for (const [key, value] of Object.entries(authHeaders())) headers.set(key, value);
  const response = await fetch(`${API_BASE_URL}${path}`, { ...init, headers });

  if (response.status === 401 && retry) {
    await rawRefresh();
    return api(path, init, false);
  }
  return response;
}

async function errorMessage(response) {
  try {
    const body = await response.json();
    if (typeof body.detail === 'string') return body.detail;
    if (typeof body.title === 'string') return body.title;
  } catch {
    // Fall through to a generic message.
  }
  return `The request failed (${response.status}).`;
}

function launchWebAuth(url) {
  return new Promise((resolve, reject) => {
    chrome.identity.launchWebAuthFlow({ url, interactive: true }, (redirect) => {
      const message = chrome.runtime.lastError?.message;
      if (message) reject(new Error(message));
      else if (redirect) resolve(redirect);
      else reject(new Error('Authorization was cancelled.'));
    });
  });
}

async function connectAccount() {
  setBusy(true);
  clearError();
  try {
    const verifier = await createVerifier();
    const challenge = await challengeFor(verifier);
    const redirectUri = chrome.identity.getRedirectURL();
    const stateParam = base64url(crypto.getRandomValues(new Uint8Array(16)));
    const url = new URL('/auth/extension', WEB_APP_URL);
    url.searchParams.set('challenge', challenge);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('state', stateParam);
    const redirect = await launchWebAuth(url.toString());
    const callback = new URL(redirect);
    if (callback.searchParams.get('state') !== stateParam) {
      throw new Error('Authorization state did not match.');
    }
    const code = callback.searchParams.get('code');
    if (!code) throw new Error('Authorization did not return a code.');

    const response = await fetch(`${API_BASE_URL}/auth/extension/exchange`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code, verifier, redirectUri }),
    });
    if (!response.ok) throw new Error(await errorMessage(response));
    const body = await response.json();
    await writeAuth({
      token: body.token,
      expiresAt: body.expiresAt,
      refreshToken: body.refreshToken,
      refreshExpiresAt: body.refreshExpiresAt,
      user: body.user,
    });
    await loadWorkspace();
  } catch (cause) {
    setError(cause instanceof Error ? cause.message : 'Could not connect the Saver.');
  } finally {
    setBusy(false);
    render();
  }
}

async function loadWorkspace() {
  const me = await api('/auth/me');
  if (!me.ok) throw new Error('The Saver session is not valid. Connect again.');
  const user = await me.json();
  state.auth.user = user.user;
  await writeAuth(state.auth);

  const response = await api('/knowledge-bases');
  if (!response.ok) throw new Error(await errorMessage(response));
  const all = await response.json();
  state.targets = all.filter((item) => item.role === 'owner' || item.role === 'manager');
  if (state.targets.length === 0) {
    throw new Error('You need to own or manage a Knowledge Base before saving.');
  }
  if (!state.targets.some((item) => item.id === target.value)) {
    target.value = state.targets[0].id;
  }
  await inspectTab();
}

async function inspectTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  state.tab = tab ?? null;
  if (!tab?.url || !/^https?:\/\//.test(tab.url)) {
    throw new Error('This browser page cannot be captured. Open a public web page.');
  }
}

async function readSelection() {
  if (!state.tab?.id) return null;
  try {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId: state.tab.id },
      func: () => {
        const selection = window.getSelection();
        if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null;
        const range = selection.getRangeAt(0);
        const container = document.createElement('div');
        container.append(range.cloneContents());
        return { html: container.innerHTML, text: selection.toString() };
      },
    });
    return result?.result ?? null;
  } catch {
    return null;
  }
}

async function setMode(mode) {
  if (state.attempt) return;
  if (state.draft && !state.draft.attemptId) await writeDraft(null);
  if (mode === 'selection') {
    const selection = await readSelection();
    if (!selection?.text?.trim()) {
      setError('Select a passage on the page first.');
      return;
    }
    state.selection = selection;
  }
  state.mode = mode;
  state.duplicate = null;
  clearError();
  render();
}

async function saveCapture(confirmDuplicate = false) {
  if (!state.auth) return;
  if (!state.tab?.url) {
    setError('This browser page cannot be captured.');
    return;
  }
  if (state.mode === 'selection' && !state.selection) {
    setError('Select a passage on the page first.');
    return;
  }

  setBusy(true);
  clearError();
  try {
    if (
      state.draft &&
      !state.draft.attemptId &&
      (state.draft.targetId !== target.value ||
        state.draft.mode !== state.mode ||
        state.draft.url !== state.tab.url ||
        (state.mode === 'selection' && state.draft.selectionText !== state.selection?.text))
    ) {
      await writeDraft(null);
    }
    if (!state.draft || state.draft.attemptId) {
      state.draft = {
        targetId: target.value,
        url: state.tab.url,
        mode: state.mode,
        selectionHtml: state.selection?.html ?? null,
        selectionText: state.selection?.text ?? null,
        idempotencyKey: crypto.randomUUID(),
        attemptId: null,
        createdAt: new Date().toISOString(),
      };
      await writeDraft(state.draft);
    }

    const response = await api(`/knowledge-bases/${state.draft.targetId}/captures`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        url: state.draft.url,
        selectionHtml: state.draft.selectionHtml,
        selectionText: state.draft.selectionText,
        idempotencyKey: state.draft.idempotencyKey,
        confirmDuplicate,
      }),
    });

    if (response.status === 409) {
      const body = await response.json();
      state.duplicate = body.duplicate ?? null;
      render();
      return;
    }
    if (!response.ok) throw new Error(await errorMessage(response));

    const body = await response.json();
    state.attempt = body.attempt;
    state.duplicate = null;
    state.draft.attemptId = state.attempt.id;
    await writeDraft(state.draft);
    render();
    schedulePoll();
  } catch (cause) {
    setError(cause instanceof Error ? cause.message : 'The capture could not start.');
  } finally {
    setBusy(false);
    render();
  }
}

let pollTimer = null;

function schedulePoll() {
  if (pollTimer) clearTimeout(pollTimer);
  pollTimer = setTimeout(pollAttempt, 1800);
}

async function pollAttempt() {
  if (!state.attempt) return;
  try {
    const response = await api(`/captures/${state.attempt.id}`);
    if (!response.ok) throw new Error(await errorMessage(response));
    state.attempt = await response.json();
    render();
    if (state.attempt.status === 'queued' || state.attempt.status === 'processing') {
      schedulePoll();
    }
  } catch (cause) {
    setError(cause instanceof Error ? cause.message : 'Could not read the capture progress.');
    schedulePoll();
  }
}

async function retryCapture() {
  if (!state.attempt) return;
  setBusy(true);
  clearError();
  try {
    const response = await api(`/captures/${state.attempt.id}/retry`, { method: 'POST' });
    if (!response.ok) throw new Error(await errorMessage(response));
    state.attempt = await response.json();
    render();
    schedulePoll();
  } catch (cause) {
    setError(cause instanceof Error ? cause.message : 'The capture could not be retried.');
  } finally {
    setBusy(false);
    render();
  }
}

function openNote() {
  if (state.attempt?.noteId) {
    window.open(`${WEB_APP_URL}/notes/${state.attempt.noteId}`, '_blank', 'noopener');
  }
}

async function done() {
  await writeDraft(null);
  state.attempt = null;
  state.duplicate = null;
  state.selection = null;
  state.mode = 'page';
  clearError();
  render();
}

async function disconnect() {
  if (state.auth) {
    try {
      if (state.auth.refreshToken) {
        await fetch(`${API_BASE_URL}/auth/extension/revoke`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ refreshToken: state.auth.refreshToken }),
        });
      }
      await fetch(`${API_BASE_URL}/auth/logout`, {
        method: 'POST',
        headers: authHeaders(),
      });
    } catch {
      // Local sign-out still clears the extension state.
    }
  }
  await writeAuth(null);
  await writeDraft(null);
  state.auth = null;
  state.targets = [];
  state.attempt = null;
  render();
}

function setBusy(busy) {
  state.busy = busy;
}

function setError(message) {
  state.error = message;
  render();
}

function clearError() {
  state.error = null;
}

function render() {
  connect.hidden = Boolean(state.auth);
  form.hidden = !state.auth;
  $('disconnect').hidden = !state.auth;

  for (const button of [$('mode-page'), $('mode-selection')]) {
    button.classList.toggle('active', button.id === `mode-${state.mode}`);
  }

  target.replaceChildren(
    ...state.targets.map((item) => {
      const option = document.createElement('option');
      option.value = item.id;
      option.textContent = item.name;
      return option;
    }),
  );
  const selected = state.targetId ?? state.draft?.targetId;
  if (selected && state.targets.some((item) => item.id === selected)) {
    target.value = selected;
  }
  state.targetId = target.value || null;
  target.disabled = Boolean(state.attempt) || state.busy;

  duplicate.hidden = !state.duplicate;
  if (state.duplicate) {
    $('duplicate-detail').textContent =
      `"${state.duplicate.title}" already exists in this Knowledge Base. Saving again creates another Note.`;
    $('duplicate-open').hidden = !state.duplicate.noteId;
  }

  error.hidden = !state.error;
  error.textContent = state.error ?? '';

  const attempt = state.attempt;
  progress.hidden = !attempt || attempt.status === 'failed' || attempt.status === 'ready';
  if (attempt && progress.hidden === false) {
    $('progress-title').textContent = attempt.status === 'queued' ? 'Queued…' : 'Reading the page…';
    $('progress-detail').textContent =
      attempt.status === 'queued'
        ? 'The Saver is waiting for a worker.'
        : 'Extracting the readable page and private media. This can take a moment.';
  }

  const active = attempt && (attempt.status === 'queued' || attempt.status === 'processing');
  save.hidden = Boolean(attempt);
  save.disabled = state.busy || active;
  save.textContent = state.duplicate
    ? 'Save anyway'
    : state.draft && !attempt
      ? 'Resume save'
      : 'Save page';

  const result = attempt?.status === 'ready' || attempt?.status === 'failed';
  $('result-actions').hidden = !result;
  if (attempt?.status === 'failed') {
    $('open-note').hidden = true;
    $('done').textContent = 'Discard';
    const retry = ensureRetryButton();
    retry.hidden = false;
  } else {
    $('open-note').hidden = false;
    $('done').textContent = 'Done';
    const retry = $('retry');
    if (retry) retry.hidden = true;
  }

  if (attempt?.status === 'ready') {
    progress.hidden = false;
    progress.className = 'notice success';
    $('progress-title').textContent = 'Saved';
    $('progress-detail').textContent = attempt.duplicateOf
      ? 'This page was saved again. The earlier Note is still available.'
      : 'The readable page is now a Note.';
  } else {
    progress.className = 'notice progress';
  }

  if (attempt?.status === 'failed') {
    progress.hidden = false;
    progress.className = 'notice error';
    $('progress-title').textContent = 'Capture failed';
    $('progress-detail').textContent =
      attempt.errorDetail ?? 'The page could not be captured. You can retry.';
  }
}

function ensureRetryButton() {
  let button = $('retry');
  if (!button) {
    button = document.createElement('button');
    button.id = 'retry';
    button.type = 'button';
    button.className = 'secondary';
    button.textContent = 'Retry';
    button.addEventListener('click', () => void retryCapture());
    $('result-actions').prepend(button);
  }
  return button;
}

$('target').addEventListener(
  'change',
  () =>
    void (async () => {
      if (state.attempt) return;
      if (state.draft && !state.draft.attemptId) await writeDraft(null);
      state.targetId = target.value;
      state.duplicate = null;
      duplicate.hidden = true;
    })(),
);
$('duplicate-open').addEventListener('click', () => {
  if (state.duplicate)
    window.open(`${WEB_APP_URL}/notes/${state.duplicate.noteId}`, '_blank', 'noopener');
});
$('connect-button').addEventListener('click', () => void connectAccount());
$('mode-page').addEventListener('click', () => void setMode('page'));
$('mode-selection').addEventListener('click', () => void setMode('selection'));
save.addEventListener('click', () => void saveCapture(Boolean(state.duplicate)));
$('open-note').addEventListener('click', openNote);
$('done').addEventListener('click', () => void done());
$('disconnect').addEventListener('click', () => void disconnect());

async function init() {
  state.auth = await readAuth();
  state.draft = await readDraft();
  try {
    if (state.auth) {
      await loadWorkspace();
      if (state.draft?.attemptId) {
        const response = await api(`/captures/${state.draft.attemptId}`);
        if (response.ok) {
          state.attempt = await response.json();
          if (state.attempt.status === 'queued' || state.attempt.status === 'processing') {
            schedulePoll();
          }
        }
      } else if (state.draft) {
        // An unsent snapshot is intentionally discarded on close.
        await writeDraft(null);
      }
    }
  } catch (cause) {
    setError(cause instanceof Error ? cause.message : 'Could not load the Saver.');
    if (!state.auth) render();
  }
  render();
}

void init();
