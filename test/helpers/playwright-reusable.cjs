'use strict';
// Shared browser, fresh isolated context per case. No real client notebooks.
// The existing production-network blocker remains mandatory in focused runs.
require('./sin-red-produccion.cjs');
const { after } = require('node:test');
const playwright = require('playwright');
const pool = new Map();
const ENGINES = new Set(['chromium', 'webkit', 'firefox']);

async function sharedBrowser(engine = 'chromium') {
  if (!ENGINES.has(engine)) throw new Error(`Unknown Playwright engine: ${engine}`);
  if (!pool.has(engine)) {
    const options = { headless: true };
    // Avoid Chromium GPU/Vulkan initialization failures on Windows CI.
    if (engine === 'chromium') options.args = ['--disable-gpu', '--use-angle=swiftshader'];
    const pending = playwright[engine].launch(options).catch(error => {
      pool.delete(engine);
      throw error;
    });
    pool.set(engine, pending);
  }
  return pool.get(engine);
}

async function withIsolatedPage(engine, callback, options = {}) {
  const browser = await sharedBrowser(engine);
  const context = await browser.newContext({
    viewport: options.viewport || { width: 1280, height: 900 },
    serviceWorkers: 'block',
    storageState: { cookies: [], origins: [] },
  });
  try {
    // Network is localhost-only; page.setContent works for entirely offline cases.
    await context.route(/^https?:\/\//, route => {
      const host = new URL(route.request().url()).hostname;
      return host === 'localhost' || host === '127.0.0.1' ? route.continue() : route.abort();
    });
    const page = await context.newPage();
    return await callback({ page, context, browser });
  } finally {
    await context.close();
  }
}

after(async () => {
  const browsers = await Promise.allSettled([...pool.values()]);
  await Promise.all(browsers.filter(r => r.status === 'fulfilled').map(r => r.value.close()));
  pool.clear();
});
module.exports = { sharedBrowser, withIsolatedPage };
