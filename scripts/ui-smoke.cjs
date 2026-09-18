const { chromium } = require('playwright');
const { pathToFileURL } = require('node:url');
const path = require('node:path');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const failures = [];
  page.on('pageerror', error => failures.push(`pageerror: ${error.message}`));
  page.on('console', message => {
    const text = message.text();
    if (message.type() === 'error' && !text.includes('version.json') && !text.includes('URL scheme "file"')) failures.push(`console: ${text}`);
  });
  await page.goto(pathToFileURL(path.resolve(__dirname, '../docs/index.html')).href, { waitUntil: 'networkidle' });
  const nav = await page.locator('nav button[data-vista]').evaluateAll(nodes =>
    nodes.map(node => ({ view: node.dataset.vista, text: node.textContent.trim() })));
  if (nav.length !== 9) throw new Error(`Expected 9 primary views, found ${nav.length}`);
  for (const item of nav) {
    await page.locator(`nav button[data-vista="${item.view}"]`).evaluate(button => button.click());
    await page.waitForTimeout(120);
    const selected = await page.locator(`nav button[data-vista="${item.view}"].activo`).count();
    if (selected !== 1) failures.push(`navigation: ${item.view} did not become active`);
  }
  if (failures.length) throw new Error(failures.join('\n'));
  console.log(`UI smoke passed: ${nav.map(x => x.view).join(', ')}`);
  await browser.close();
})().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
