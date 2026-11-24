'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { pathToFileURL } = require('node:url');
const { chromium, webkit } = require('playwright');

const DOCS = path.resolve(__dirname, '../docs');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
};

function startStaticDocs() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const urlPath = (req.url || '/').split('?')[0];
      const rel = urlPath === '/' ? '/index.html' : urlPath;
      const fp = path.join(DOCS, rel.replace(/^\/+/, ''));
      if (!fp.startsWith(DOCS) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) {
        res.writeHead(404);
        res.end('Not found');
        return;
      }
      const ext = path.extname(fp);
      res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
      res.end(fs.readFileSync(fp));
    });
    server.listen(0, '127.0.0.1', () => {
      resolve({
        server,
        url: `http://127.0.0.1:${server.address().port}/index.html`,
      });
    });
  });
}

test('static: docs/index.html declares safe CSP meta without unsafe-eval or frame-ancestors', () => {
  const html = fs.readFileSync(path.join(DOCS, 'index.html'), 'utf8');
  const m = html.match(/<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]+)"/i);
  assert.ok(m, 'CSP meta tag must exist in docs/index.html');
  const csp = m[1];
  assert.match(csp, /default-src\s+'self'/);
  assert.match(csp, /object-src\s+'none'/);
  assert.match(csp, /base-uri\s+'self'/);
  assert.match(csp, /form-action\s+'self'/);
  assert.doesNotMatch(csp, /unsafe-eval/i, 'CSP must not allow unsafe-eval');
  assert.doesNotMatch(csp, /frame-ancestors/i, 'frame-ancestors is invalid in meta CSP');
  assert.ok(html.indexOf(m[0]) < html.indexOf('<script'), 'CSP meta must precede scripts in <head>');
});

for (const engine of [chromium, webkit]) {
  test(`CSP browser (${engine.name()}): blocks eval, zero violations on HTTP boot, demo unlock, and all tabs`, async () => {
    const { server, url } = await startStaticDocs();
    let browser;
    try {
      browser = await engine.launch({ headless: true });
      const ctx = await browser.newContext({
        viewport: { width: 390, height: 844 },
        serviceWorkers: 'block',
      });
      const page = await ctx.newPage();
      const consoleCsp = [];
      const pageErrors = [];
      await page.addInitScript(() => {
        window.__cspViolations = [];
        document.addEventListener('securitypolicyviolation', (e) => {
          window.__cspViolations.push({
            directive: e.violatedDirective,
            effective: e.effectiveDirective,
            blockedURI: e.blockedURI,
            sourceFile: e.sourceFile,
          });
        });
      });
      page.on('pageerror', (err) => pageErrors.push(err.message));
      page.on('console', (msg) => {
        if (msg.type() === 'error' && /content security policy|csp/i.test(msg.text())) {
          consoleCsp.push(msg.text());
        }
      });

      await page.goto(url, { waitUntil: 'load' });
      await page.waitForFunction(() => window.__ocMockBackendReady && window.OCAuth && window.cargarHoy);

      // Unlock demo mode and traverse every main navigation tab
      await page.evaluate(() => {
        const demoBtn = document.getElementById('oc-modo-demo');
        if (demoBtn) demoBtn.click();
      });
      await page.waitForTimeout(400);
      const tabs = ['hoy', 'inventario', 'escanear', 'clientes', 'comisiones', 'gastos', 'avanzado'];
      for (const tab of tabs) {
        await page.evaluate((t) => {
          const btn = document.querySelector(`nav button[data-vista="${t}"]`);
          if (btn) btn.click();
        }, tab);
        await page.waitForTimeout(120);
      }

      // Assert ZERO CSP violations across the entire real app flow before running the negative enforcement probe
      const violations = await page.evaluate(() => window.__cspViolations);
      assert.deepEqual(violations, [], `${engine.name()} HTTP must have 0 CSP violations`);
      assert.deepEqual(consoleCsp, [], `${engine.name()} HTTP must have 0 CSP console errors`);
      assert.deepEqual(pageErrors, [], `${engine.name()} HTTP must have 0 page errors`);

      // Negative enforcement probe: run inside a page timer (outside Playwright's DevTools inspector frame)
      // to prove CSP actively blocks dynamic code execution (new Function) in real page execution.
      const fnBlocked = await page.evaluate(() => new Promise((resolve) => {
        setTimeout(() => {
          try {
            new Function('return 1')();
            resolve(false);
          } catch (e) {
            resolve(e instanceof EvalError || /Content Security Policy|eval/i.test(String(e)));
          }
        }, 0);
      }));
      assert.equal(fnBlocked, true, `${engine.name()} CSP must actively block new Function()`);

      // Also verify file:// compatibility (used by 200+ Playwright tests)
      const filePage = await ctx.newPage();
      const fileCsp = [];
      await filePage.addInitScript(() => {
        window.__cspViolations = [];
        document.addEventListener('securitypolicyviolation', (e) => {
          window.__cspViolations.push({ directive: e.violatedDirective, blockedURI: e.blockedURI });
        });
      });
      filePage.on('console', (msg) => {
        if (msg.type() === 'error' && /content security policy|csp/i.test(msg.text())) fileCsp.push(msg.text());
      });
      await filePage.goto(pathToFileURL(path.join(DOCS, 'index.html')).href, { waitUntil: 'load' });
      await filePage.waitForFunction(() => window.__ocMockBackendReady && window.OCAuth);
      const fileViolations = await filePage.evaluate(() => window.__cspViolations);
      await filePage.close();

      assert.deepEqual(fileViolations, [], `${engine.name()} file:// must have 0 CSP violations`);
      assert.deepEqual(fileCsp, [], `${engine.name()} file:// must have 0 CSP console errors`);
      await ctx.close();
    } finally {
      if (browser) await browser.close();
      server.close();
    }
  });
}
