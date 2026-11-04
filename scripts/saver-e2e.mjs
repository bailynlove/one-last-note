import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright-core';

const root = process.cwd();
const extensionPath = path.join(root, 'apps/saver');
const executablePath = process.env.CHROMIUM_PATH
  ? process.env.CHROMIUM_PATH
  : path.join(process.env.HOME ?? '', '.cache/ms-playwright/chromium-1148/chrome-linux/chrome');

function extensionIdFromPath() {
  const digest = createHash('sha256').update(extensionPath).digest('hex').slice(0, 32);
  return [...digest].map((char) => String.fromCharCode(97 + Number.parseInt(char, 16))).join('');
}

async function until(check, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check().catch(() => false)) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Timed out waiting for condition');
}

const userDataDir = await mkdtemp(path.join(tmpdir(), 'oln-saver-e2e-'));
const context = await chromium.launchPersistentContext(userDataDir, {
  headless: false,
  executablePath,
  args: [
    `--disable-extensions-except=${extensionPath}`,
    `--load-extension=${extensionPath}`,
    '--no-first-run',
    '--no-default-browser-check',
  ],
});

let worker = context.serviceWorkers()[0];
if (!worker) {
  worker = await context.waitForEvent('serviceworker', { timeout: 10_000 }).catch(() => null);
}
const extensionId = worker?.url().split('/')[2] ?? extensionIdFromPath();

const auth = {
  token: 'e2e-token',
  expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
  refreshToken: 'e2e-refresh',
  refreshExpiresAt: new Date(Date.now() + 86400 * 1000).toISOString(),
  user: {
    id: 'user-1',
    email: 'owner@example.com',
    displayName: 'Owner',
    avatarUrl: null,
    createdAt: new Date().toISOString(),
  },
};

let duplicateConfirmed = false;
let attemptStatus = 'queued';
let lastCaptureBody = null;
let lastCaptureTarget = null;

await context.route('http://localhost:4000/**', async (route) => {
  const request = route.request();
  const url = new URL(request.url());
  const method = request.method();

  if (url.pathname === '/auth/me') {
    await route.fulfill({ json: { user: auth.user } });
    return;
  }
  if (url.pathname === '/knowledge-bases' && method === 'GET') {
    await route.fulfill({
      json: [
        {
          id: 'kb-owner',
          name: 'Field Notes',
          description: null,
          ownerId: 'user-1',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          role: 'owner',
        },
        {
          id: 'kb-manager',
          name: 'Shared Desk',
          description: null,
          ownerId: 'user-2',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          role: 'manager',
        },
        {
          id: 'kb-viewer',
          name: 'Reading Room',
          description: null,
          ownerId: 'user-2',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          role: 'viewer',
        },
      ],
    });
    return;
  }
  if (url.pathname.endsWith('/captures') && method === 'POST') {
    const body = request.postDataJSON();
    lastCaptureBody = body;
    lastCaptureTarget = url.pathname.split('/')[2];
    if (!body.confirmDuplicate && !duplicateConfirmed) {
      await route.fulfill({
        status: 409,
        contentType: 'application/problem+json',
        json: {
          title: 'Duplicate capture',
          status: 409,
          detail: 'A Note with this address already exists in this Knowledge Base.',
          duplicate: { noteId: 'note-old', title: 'Earlier capture' },
        },
      });
      return;
    }
    duplicateConfirmed = true;
    await route.fulfill({
      status: 202,
      json: {
        attempt: {
          id: '11111111-1111-4111-8111-111111111111',
          knowledgeBaseId: 'kb-owner',
          userId: 'user-1',
          url: 'https://example.com/article',
          canonicalUrl: 'https://example.com/article',
          selectionHtml: null,
          selectionText: null,
          status: 'queued',
          noteId: null,
          revisionId: null,
          duplicateOf: null,
          errorCode: null,
          errorDetail: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          completedAt: null,
        },
      },
    });
    return;
  }
  if (url.pathname.startsWith('/captures/11111111') && method === 'GET') {
    if (attemptStatus === 'queued') attemptStatus = 'ready';
    await route.fulfill({
      json: {
        id: '11111111-1111-4111-8111-111111111111',
        knowledgeBaseId: 'kb-owner',
        userId: 'user-1',
        url: 'https://example.com/article',
        canonicalUrl: 'https://example.com/article',
        selectionHtml: null,
        selectionText: null,
        status: attemptStatus,
        noteId: 'note-1',
        revisionId: 'revision-1',
        duplicateOf: null,
        errorCode: null,
        errorDetail: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
      },
    });
    return;
  }
  await route.fulfill({ status: 404, json: { detail: 'not mocked' } });
});

const popup = await context.newPage();
await popup.addInitScript(() => {
  const fakeTab = { id: 1, url: 'https://example.com/article', title: 'Example article' };
  Object.defineProperty(chrome.tabs, 'query', {
    value: async () => [fakeTab],
    configurable: true,
  });
});
await popup.goto(`chrome-extension://${extensionId}/popup.html`);
await popup.evaluate(async (value) => {
  await chrome.storage.local.set({ auth: value });
}, auth);
await popup.reload();

await until(async () => await popup.$eval('#form', (form) => !form.hidden), 5_000);
await until(async () => (await popup.$$eval('#target option', (options) => options.length)) > 0);
const targets = await popup.$$eval('#target option', (options) =>
  options.map((option) => option.textContent),
);
assert.deepEqual(targets, ['Field Notes', 'Shared Desk']);
assert.equal(await popup.$eval('#connect', (connect) => connect.hidden), true);

await popup.click('#save');
await popup.waitForSelector('#duplicate:not([hidden])');
assert.match(await popup.textContent('#duplicate-detail'), /Earlier capture/);
await popup.$eval('#target', (target) => {
  target.value = 'kb-manager';
  target.dispatchEvent(new Event('change', { bubbles: true }));
});
await popup.click('#save');
await popup.waitForSelector('#duplicate:not([hidden])');
assert.equal(lastCaptureTarget, 'kb-manager');
assert.equal(lastCaptureBody.confirmDuplicate, false);
await popup.click('#save');
await popup.waitForSelector('#progress:not([hidden])');
await until(async () => (await popup.textContent('#progress-title')) === 'Saved', 5_000);
assert.equal(await popup.isVisible('#open-note'), true);

await popup.click('#done');
await popup.waitForSelector('#save:not([hidden])');

await context.close();
await rm(userDataDir, { recursive: true, force: true });
console.log('Saver E2E passed: role filtering, duplicate confirmation, capture recovery/result.');
