import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { chromium } from 'playwright-core';

const executablePath =
  process.env.CHROMIUM_PATH ??
  `${process.env.HOME}/.cache/ms-playwright/chromium-1148/chrome-linux/chrome`;
const baseUrl = process.env.A11Y_BASE_URL ?? 'http://127.0.0.1:3000';
const paths = (process.env.A11Y_PATHS ?? '/login,/').split(',');
const sessionToken = process.env.A11Y_SESSION_TOKEN;
const require = createRequire(import.meta.url);
const axeSource = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
const browser = await chromium.launch({ executablePath, headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage();
if (sessionToken) {
  await page
    .context()
    .addCookies([{ name: 'oln_session', value: sessionToken, domain: '127.0.0.1', path: '/' }]);
}
const failures = [];

for (const path of paths) {
  await page.goto(`${baseUrl}${path}`, { waitUntil: 'networkidle' });
  await page.addScriptTag({ content: axeSource });
  const result = await page.evaluate(async () => {
    return await window.axe.run(document, {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] },
    });
  });
  for (const violation of result.violations) {
    if (violation.impact === 'critical' || violation.impact === 'serious') {
      failures.push({
        path,
        id: violation.id,
        impact: violation.impact,
        nodes: violation.nodes.length,
      });
    }
  }
  console.log(
    JSON.stringify({
      path,
      violations: result.violations.length,
      criticalOrSerious: failures.filter((f) => f.path === path).length,
    }),
  );
}

await browser.close();
if (failures.length > 0) {
  console.error(JSON.stringify({ failures }, null, 2));
  process.exit(1);
}
