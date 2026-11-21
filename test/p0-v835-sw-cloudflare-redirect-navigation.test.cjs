'use strict';
// P0 v835 RED-first: Cloudflare Workers static assets answer /index.html and /dashboard.html with 307
// (-> / and /dashboard). The SW precaches those shell URLs, stores redirected Responses, and the browser
// REJECTS a redirected Response for a navigation -> blank page after SW activation. Local server, no customer data.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http'), fs = require('node:fs'), path = require('node:path');
const { chromium } = require('playwright');
const DOCS = path.join(__dirname, '..', 'docs');
const TYPES = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };

function cloudflareLike() {
  return http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x'); let p = decodeURIComponent(u.pathname);
    if (/\.html$/.test(p)) { const to = p === '/index.html' ? '/' : p.replace(/\.html$/, ''); res.writeHead(307, { Location: to + u.search }); return res.end(); }
    if (p === '/') p = '/index.html'; else if (!path.extname(p) && fs.existsSync(path.join(DOCS, p + '.html'))) p += '.html';
    const f = path.join(DOCS, p);
    if (!f.startsWith(DOCS) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-cache' }); fs.createReadStream(f).pipe(res);
  });
}

test('after SW activation on a Cloudflare-like origin, /dashboard and / still navigate (no redirected-response failure)', { timeout: 120000 }, async () => {
  const srv = cloudflareLike(); await new Promise(r => srv.listen(0, '127.0.0.1', r)); const base = 'http://127.0.0.1:' + srv.address().port;
  const web = await chromium.launch();
  try {
    const ctx = await web.newContext(); const page = await ctx.newPage();
    const fails = []; page.on('requestfailed', r => { if (r.resourceType() === 'document') fails.push(r.url() + ' ' + (r.failure() && r.failure().errorText)); });
    await page.goto(base + '/', { waitUntil: 'load' });
    await page.waitForFunction(() => navigator.serviceWorker && navigator.serviceWorker.controller, null, { timeout: 60000 }).catch(() => {});
    if (!(await page.evaluate(() => !!navigator.serviceWorker.controller))) { await page.reload({ waitUntil: 'load' }); await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 60000 }); }
    await page.waitForTimeout(4000); // let the resilient precache store the shell (incl. redirected /dashboard.html, /index.html)
    for (const target of ['/dashboard.html', '/dashboard', '/index.html', '/']) {
      const resp = await page.goto(base + target, { waitUntil: 'domcontentloaded' }).catch(e => ({ error: e.message }));
      const ok = resp && !resp.error && resp.status() === 200;
      const body = ok ? await page.evaluate(() => document.body ? document.body.innerHTML.length : 0) : 0;
      assert.ok(ok && body > 200, `navigation to ${target} under the SW: ${resp && resp.error ? resp.error : resp && resp.status()} body=${body} fails=${fails.join(' | ')}`);
    }
    await ctx.close();
  } finally { await web.close(); await new Promise(r => srv.close(r)); }
});
