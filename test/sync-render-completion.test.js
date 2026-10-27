const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('./helpers/page-source.cjs');
const path = require('node:path');
const { chromium, webkit } = require('playwright');
const html = fs.readFileSync(path.join(__dirname, '../docs/index.html'), 'utf8');
const start = html.indexOf('window.OCSyncRender = (function () {');
const source = html.slice(start, html.indexOf('\nwindow.addEventListener("oc-sync-merge"', start));

for (const [engineName, browserType] of [['Chromium', chromium], ['WebKit', webkit]]) {
  describe(engineName + ' visible delivery receipts', () => {
    let browser;
    before(async () => { browser = await browserType.launch({ headless: true }); });
    after(async () => { if (browser) await browser.close(); });
    async function fixture() {
      const page = await browser.newPage();
      try {
        await page.setContent('<section id="vista-hoy" class="activa"><span>Before</span></section>');
        await page.evaluate(source => (0, eval)(source), source);
        return page;
      } catch (error) {
        await page.close();
        throw error;
      }
    }

    test(engineName + ': visible completion waits for async DOM commit and a paint opportunity', async () => {
      const page = await fixture();
      try {
        await page.evaluate(() => {
          window.done = null;
          window.cargarHoy = () => new Promise(resolve => {
            window.release = () => { document.querySelector('span').textContent = 'Synced'; resolve(true); };
          });
          OCSyncRender.solicitar();
          OCSyncRender.esperar().then(value => { window.done = value; });
        });
        assert.equal(await page.evaluate(() => window.done), null);
        await page.evaluate(() => window.release());
        await page.waitForFunction(() => window.done !== null);
        assert.equal(await page.evaluate(() => window.done), true);
        assert.equal(await page.locator('span').textContent(), 'Synced');
        assert.equal(await page.evaluate(() => OCSyncRender.esperar()), false, 'old render receipt cannot acknowledge a later update');
      } finally { await page.close(); }
    });

    for (const mode of ['failure', 'no-commit', 'unconfirmed', 'hidden', 'editing', 'inactive']) {
      test(engineName + ': no visible receipt for ' + mode, async () => {
        const page = await fixture();
        try {
          const result = await page.evaluate(async mode => {
            window.cargarHoy = async () => {
              if (mode === 'failure') throw new Error('view unavailable');
              if (mode !== 'no-commit') document.querySelector('span').textContent = 'Attempted';
              return mode === 'unconfirmed' ? undefined : true;
            };
            if (mode === 'hidden') Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
            if (mode === 'editing') { const input = document.createElement('input'); document.body.append(input); input.focus(); }
            if (mode === 'inactive') document.querySelector('section').classList.remove('activa');
            OCSyncRender.solicitar();
            return OCSyncRender.esperar();
          }, mode);
          assert.equal(result, false);
        } finally { await page.close(); }
      });
    }

    test(engineName + ': a newer change waits for the latest render without concurrent loaders', async () => {
      const page = await fixture();
      try {
        await page.evaluate(() => {
          window.calls = 0; window.active = 0; window.maxActive = 0; window.done = null;
          window.cargarHoy = () => new Promise(resolve => {
            const n = ++window.calls; window.active++; window.maxActive = Math.max(window.maxActive, window.active);
            window['release' + n] = () => {
              document.querySelector('span').textContent = 'Revision ' + n;
              window.active--; resolve(true);
            };
          });
          OCSyncRender.solicitar();
          OCSyncRender.esperar().then(value => { window.done = value; });
        });
        await page.evaluate(() => OCSyncRender.solicitar() && undefined);
        assert.equal(await page.evaluate(() => window.calls), 1);
        await page.evaluate(() => window.release1());
        await page.waitForFunction(() => window.calls === 2);
        assert.equal(await page.evaluate(() => window.done), null);
        await page.evaluate(() => window.release2());
        await page.waitForFunction(() => window.done !== null);
        assert.equal(await page.evaluate(() => window.done), true);
        assert.equal(await page.evaluate(() => window.maxActive), 1);
        assert.equal(await page.locator('span').textContent(), 'Revision 2');
      } finally { await page.close(); }
    });

    test(engineName + ': hiding the page during an async render never acknowledges visible delivery', async () => {
      const page = await fixture();
      try {
        const result = await page.evaluate(async () => {
          window.cargarHoy = async () => {
            document.querySelector('span').textContent = 'Changed while hidden';
            Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
            return true;
          };
          return OCSyncRender.solicitar();
        });
        assert.equal(result, false);
      } finally { await page.close(); }
    });

    test(engineName + ': navigation between render and paint invalidates the active-view receipt', async () => {
      const page = await fixture();
      try {
        await page.evaluate(() => {
          window.frames = []; window.done = null;
          window.requestAnimationFrame = fn => window.frames.push(fn);
          window.cargarHoy = async () => { document.querySelector('span').textContent = 'Committed'; return true; };
          OCSyncRender.solicitar().then(ok => { window.done = ok; });
        });
        await page.waitForFunction(() => window.frames.length === 1);
        await page.evaluate(() => {
          window.frames.shift()();
          document.querySelector('section').classList.remove('activa');
          const next = document.createElement('section'); next.id = 'vista-unsupported'; next.className = 'activa';
          document.body.append(next);
          window.frames.shift()();
        });
        await page.waitForFunction(() => window.done !== null);
        assert.equal(await page.evaluate(() => window.done), false);
      } finally { await page.close(); }
    });

    test(engineName + ': a skipped edit refresh resumes after blur without retroactively acknowledging the skipped receipt', async () => {
      const page = await fixture();
      try {
        const skipped = await page.evaluate(async () => {
          window.cargarHoy = async () => { document.querySelector('span').textContent = 'Refreshed after editing'; return true; };
          const input = document.createElement('input'); document.body.append(input); input.focus();
          return OCSyncRender.solicitar();
        });
        assert.equal(skipped, false);
        assert.equal(await page.locator('span').textContent(), 'Before');
        await page.evaluate(() => document.querySelector('input').blur());
        await page.waitForFunction(() => document.querySelector('span').textContent === 'Refreshed after editing');
      } finally { await page.close(); }
    });
  });
}
