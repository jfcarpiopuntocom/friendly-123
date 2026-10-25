// Removal of the optional dark feature, authorized by JFC on 2026-10-25.
// Old device settings may remain, but are never read or changed by theme code.
// Chromium and WebKit are headless; this does not claim a physical Safari run.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { chromium, webkit } = require('playwright');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const fs = require('node:fs');
const URL = pathToFileURL(path.resolve(__dirname, '../docs/index.html')).href;

for (const engine of [chromium, webkit]) {
  test('light-only + historic dark preference ignored (' + engine.name() + ')', async () => {
    const browser = await engine.launch({ headless: true });
    try {
      const ctx = await browser.newContext({ colorScheme: 'dark', viewport: { width: 390, height: 844 } });
      const page = await ctx.newPage();
      await page.goto(URL, { waitUntil: 'domcontentloaded' });
      await page.evaluate(() => {
        localStorage.setItem('oc_tema', 'oscuro');
        localStorage.setItem('oc_preservation_check', 'intact');
      });
      await page.reload({ waitUntil: 'domcontentloaded' });
      const state = await page.evaluate(() => ({
        scheme: document.querySelector('meta[name="color-scheme"]')?.content,
        rootTheme: document.documentElement.getAttribute('data-tema'),
        filter: getComputedStyle(document.documentElement).filter,
        api: typeof window.OCTema,
        selector: !!document.querySelector('#selectTema'),
        toggle: !!document.querySelector('#oc-tema-toggle'),
        oldPref: localStorage.getItem('oc_tema'),
        otherPref: localStorage.getItem('oc_preservation_check'),
        timezone: !!document.querySelector('#selectTimezone'),
        expenses: !!document.querySelector('#btnGuardarGastos')
      }));
      assert.equal(state.scheme, 'light only');
      assert.equal(state.rootTheme, null);
      assert.equal(state.filter, 'none');
      assert.equal(state.api, 'undefined');
      assert.equal(state.selector, false);
      assert.equal(state.toggle, false);
      assert.equal(state.oldPref, 'oscuro', 'no delete of unrelated stored preferences');
      assert.equal(state.otherPref, 'intact');
      assert.equal(state.timezone, true);
      assert.equal(state.expenses, true);
      await page.waitForFunction(() => !!(window.OCHelp && window.OCHelp.abrir), null, { timeout: 15000 });
      await page.evaluate(() => {
        if (!document.getElementById('oc-logout')) {
          const b = document.createElement('button');
          b.id = 'oc-logout';
          (document.querySelector('header') || document.body).appendChild(b);
        }
        window.dispatchEvent(new Event('oc-login'));
      });
      await page.waitForSelector('#oc-sync-mini', { timeout: 10000 });
      const sync = await page.evaluate(() => {
        const el = document.querySelector('#oc-sync-mini');
        const txt = el.querySelector('.oc-sync-txt');
        return {
          label: el.getAttribute('aria-label'),
          dot: !!el.querySelector('span'),
          textVisible: getComputedStyle(txt).display !== 'none',
          toggle: !!document.querySelector('#oc-tema-toggle')
        };
      });
      assert.ok(sync.label && sync.label.length > 2, 'sync stays screen-reader accessible');
      assert.equal(sync.dot, true);
      assert.equal(sync.textVisible, false, 'mobile state keeps compact dot');
      assert.equal(sync.toggle, false);
      await ctx.close();
    } finally { await browser.close(); }
  });
}

test('no invert/rotate theme runtime remains in the app entry or help header', () => {
  const index = fs.readFileSync(path.resolve(__dirname, '../docs/index.html'), 'utf8');
  const help = fs.readFileSync(path.resolve(__dirname, '../docs/help-ui.js'), 'utf8');
  for (const src of [index, help]) {
    assert.doesNotMatch(src, /window\\.OCTema|oc-tema-toggle|selectTema|data-tema=|hue-rotate\\(180deg\\)/);
  }
});
