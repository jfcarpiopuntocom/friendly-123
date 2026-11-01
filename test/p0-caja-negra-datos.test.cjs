'use strict';
// JFC 2026-11-01: nothing is lost. Every boot keeps an internal full copy of local state (last 10) before sync.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startServer, openDevice, enterAs } = require('./helpers/e2e-app.cjs');
const { chromium } = require('playwright');
let server, base, web;
before(async () => { ({ srv: server, base } = await startServer()); web = await chromium.launch(); });
after(async () => { await web.close(); await new Promise(r => server.close(r)); });
const snaps = page => page.evaluate(() => new Promise(res => {
  const names = indexedDB.databases ? indexedDB.databases() : Promise.resolve([]);
  names.then(list => {
    const d = (list || []).find(x => /f123-caja-negra-datos/.test(x.name)); if (!d) return res({ n: 0 });
    const q = indexedDB.open(d.name); q.onsuccess = () => { const db = q.result;
      const r = db.transaction('snaps').objectStore('snaps').getAll(); r.onsuccess = () => { db.close();
        res({ n: r.result.length, ultimo: r.result.length ? JSON.parse(r.result[r.result.length - 1].crudo) : null }); }; };
  });
}));
test('boot keeps an internal full-state copy of the business, bounded to the last 10', { timeout: 300000 }, async () => {
  const d = await openDevice(web, base); await enterAs(d.page, 'dueno');
  const p = await d.page.evaluate(async () => (await (await fetch('/api/productos', { method: 'POST', body: JSON.stringify({ nombre: 'Caja negra 1', barcode: 'CN-1', stockInicial: 7, precio: 10, costo: 4 }) })).json()));
  assert.ok(p && (p.id || (p.producto && p.producto.id)));
  await d.page.waitForTimeout(1200);
  for (let i = 0; i < 11; i++) { await d.page.reload({ waitUntil: 'domcontentloaded' }); await d.page.waitForFunction(() => window.OCSync && window.OCYjs); await d.page.waitForTimeout(400); }
  const s = await snaps(d.page);
  assert.equal(s.n, 10, 'keeps exactly the last 10 boot copies');
  assert.ok(JSON.stringify(s.ultimo).includes('Caja negra 1'), 'the copy contains the business data');
  await d.ctx.close();
});
