import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

const filters = ['@oln/api', '@oln/worker', '@oln/web'];
const processes = [];
const logs = new Map();

function start(filter) {
  const child = spawn('pnpm', ['--filter', filter, 'start'], {
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  });

  logs.set(filter, '');
  const record = (chunk) => {
    logs.set(filter, (logs.get(filter) ?? '') + chunk.toString());
  };
  child.stdout.on('data', record);
  child.stderr.on('data', record);
  processes.push(child);
  return child;
}

async function waitFor(name, predicate, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const output = logs.get(name) ?? '';
    if (predicate(output)) {
      return;
    }
    await delay(250);
  }

  throw new Error(`Timed out waiting for ${name}. Last output:\n${logs.get(name) ?? ''}`);
}

async function waitForHttp(url, accepted, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2_000) });
      if (accepted.includes(response.status)) {
        return response;
      }
    } catch {
      // service still starting
    }
    await delay(250);
  }

  throw new Error(`Timed out waiting for ${url}`);
}

function signalGroup(child, signal) {
  try {
    if (child.pid) {
      process.kill(-child.pid, signal);
    }
  } catch {
    // already gone
  }
}

async function stopAll() {
  for (const child of processes) {
    signalGroup(child, 'SIGTERM');
  }

  await Promise.all(
    processes.map(
      (child) =>
        new Promise((resolve) => {
          if (child.exitCode !== null) {
            resolve();
            return;
          }
          const timer = setTimeout(() => {
            signalGroup(child, 'SIGKILL');
            resolve();
          }, 5_000);
          child.once('exit', () => {
            clearTimeout(timer);
            resolve();
          });
        }),
    ),
  );

  for (const child of processes) {
    child.stdout.destroy();
    child.stderr.destroy();
  }
}

try {
  for (const filter of filters) {
    start(filter);
  }

  await waitFor('@oln/worker', (output) => output.includes('worker ready'));
  const ready = await waitForHttp('http://127.0.0.1:4000/ready', [200]);
  const readyBody = await ready.json();
  if (readyBody.status !== 'ok') {
    throw new Error(`API reported ${readyBody.status}: ${JSON.stringify(readyBody.checks)}`);
  }

  const health = await waitForHttp('http://127.0.0.1:4000/health', [200]);
  if (!health.headers.get('x-request-id')) {
    throw new Error('API response is missing the x-request-id header');
  }

  const webHealth = await waitForHttp('http://127.0.0.1:3000/health', [200]);
  if ((await webHealth.json()).status !== 'ok') {
    throw new Error('Web health endpoint did not report ok');
  }

  const page = await waitForHttp('http://127.0.0.1:3000/', [200]);
  if (!(await page.text()).includes('Foundation status')) {
    throw new Error('Web status page did not render');
  }

  if (processes.some((child) => child.exitCode !== null)) {
    throw new Error('A service process exited before the smoke test finished');
  }

  console.log('smoke passed: api, worker, web and backing services are wired together');
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  for (const [name, output] of logs) {
    console.error(`\n--- ${name} ---\n${output}`);
  }
  process.exitCode = 1;
} finally {
  await stopAll();
}

process.exit(process.exitCode ?? 0);
