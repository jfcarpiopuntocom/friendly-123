'use strict';
// E2E helper (v557 audit): serves docs/ on 127.0.0.1 and opens the REAL app in Chromium.
// No network to production: external hosts are aborted. Synthetic data only.
const http = require('node:http'), fs = require('node:fs'), path = require('node:path');
const { chromium } = require('playwright');
const DOCS = process.env.E2E_DOCS ? path.resolve(process.env.E2E_DOCS) : path.resolve(__dirname, '../../docs');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.ico': 'image/x-icon' };
async function startServer() {
  const srv = http.createServer((q, r) => {
    let p = decodeURIComponent(q.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html';
    const f = path.join(DOCS, p);
    if (!f.startsWith(DOCS) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end(''); }
    r.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' });
    fs.createReadStream(f).pipe(r);
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  return { srv, base: 'http://127.0.0.1:' + srv.address().port };
}
// Opens one "device": its own browser context (own localStorage/IndexedDB).
async function openDevice(browser, base, { width = 390, height = 844, errors, license = 'F123-SYNTHETIC-AUDIT-ONLY' } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, serviceWorkers: 'block' });
  // Synthetic owned notebook (no demo seeds) and no live relay/WebSocket: sync is moved by hand between devices.
  await ctx.addInitScript(lic => {
    try { if (!localStorage.getItem('f123_owned')) localStorage.setItem('f123_owned', JSON.stringify({ licenseCode: lic })); } catch (_) {}
    window.WebSocket = class { constructor() { throw new Error('no network in e2e'); } };
  }, license);
  await ctx.route(u => !u.href.startsWith(base) && !u.href.startsWith('data:') && !u.href.startsWith('blob:'), r => r.abort());
  const page = await ctx.newPage();
  if (errors) { page.on('pageerror', e => errors.push(e.message)); }
  await page.goto(base + '/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.OCAuth && window.OCSync && window.OCYjs && window.cargarHoy);
  return { ctx, page };
}
// Enters as owner without the PIN pad (same shortcut the existing browser tests use).
async function enterAs(page, rol = 'dueno', lang = 'es') {
  await page.evaluate(([rol, lang]) => { OCAuth.rolActual = () => rol; OCI18n.setLang(lang); document.getElementById('oc-gate')?.remove(); }, [rol, lang]);
}
async function go(page, vista) {
  await page.evaluate(v => { document.querySelector('nav button[data-vista="' + v + '"]').click(); }, vista);
  await page.waitForTimeout(250);
}
module.exports = { startServer, openDevice, enterAs, go, chromium };
// Two-device sync pump: every Yjs update produced on one device is captured
// (doc 'update' event, i.e. exactly what the relay would carry) and applied on the other.
async function installPump(devices) {
  // Initial full-state exchange (like a fresh peer join), then incremental updates only.
  const full = [];
  for (const d of devices) full.push(await d.page.evaluate(() => Array.from(Y.encodeStateAsUpdate(OCYjs.doc))));
  for (const [i, d] of devices.entries()) for (const [j, u] of full.entries()) if (i !== j)
    await d.page.evaluate(arr => { Y.applyUpdate(OCYjs.doc, new Uint8Array(arr), 'red'); try { OCYjs._store.aplicar(); } catch (_) {} }, u);
  for (const d of devices) await d.page.evaluate(() => {
    window.__out = []; window.__pumpOn = true;
    const hook = doc => doc && doc.on('update', (u, origin) => { if (origin !== 'red' && window.__pumpOn) window.__out.push(Array.from(u)); });
    hook(OCYjs.doc);
  });
}
async function pump(a, b, ms = 400, rounds = 12) {
  // Several short rounds: the app publishes to Yjs asynchronously (seed, then update).
  let quiet = 0;
  for (let r = 0; r < rounds && quiet < 3; r++) {
    await a.page.waitForTimeout(ms);
    let moved = 0;
    for (const [from, to] of [[a, b], [b, a]]) {
      const ups = await from.page.evaluate(() => window.__out.splice(0));
      moved += ups.length;
      if (ups.length) await to.page.evaluate(arr => { for (const u of arr) Y.applyUpdate(OCYjs.doc, new Uint8Array(u), 'red'); try { OCYjs._store.aplicar(); } catch (e) { window.__aplicarErr = String(e); } }, ups);
    }
    quiet = moved ? 0 : quiet + 1;
  }
}
module.exports.installPump = installPump; module.exports.pump = pump;
