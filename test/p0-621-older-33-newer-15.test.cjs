'use strict';
// P0 #621: the owner confirms 15 is the MOST RECENT physical count in Opera.
// PWA 33 is an older valid count. This test uses two isolated synthetic browser
// contexts and deliberately disables all external connections. It cannot
// certify iOS WebSocket delivery/ACK, but it can detect a causal merge regression.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startServer, openDevice, enterAs, installPump, pump } = require('./helpers/e2e-app.cjs');
const { chromium } = require('playwright');

let server, base, web;
before(async () => { ({ srv: server, base } = await startServer()); web = await chromium.launch(); });
after(async () => {
  if (web) await web.close();
  if (server) await new Promise(r => server.close(r));
});
const api = (page, u, method = 'GET', body) => page.evaluate(async ([u, method, body]) => {
  const res = await fetch(u, { method, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, value: await res.json() };
}, [u, method, body]);
async function product(page, id) {
  const r = await api(page, '/api/productos');
  const rows = Array.isArray(r.value) ? r.value : (r.value.productos || []);
  return rows.find(x => x.id === id);
}
async function physicalCount(page, id, amount) {
  const r = await api(page, '/api/productos/' + id + '/ajustar', 'POST', {
    stockFisico: amount, motivo: 'synthetic owner count #621'
  });
  assert.equal(r.status, 200, 'a physical count must commit locally before any sync');
  const p = await product(page, id);
  assert.equal(p.stockActual, amount, 'local stock readback');
}

test('P0 #621: OLD PWA 33 must NOT override LATER Opera 15, even when old device seeds again (two A-B-A cycles)', { timeout: 300000 }, async () => {
  const PWA = await openDevice(web, base), Opera = await openDevice(web, base);
  try {
    await enterAs(PWA.page, 'dueno');
    await enterAs(Opera.page, 'dueno');
    await PWA.page.waitForFunction(() => OCYjs.estado === 'activo');
    await Opera.page.waitForFunction(() => OCYjs.estado === 'activo');
    await installPump([PWA, Opera]);
    const created = await api(PWA.page, '/api/productos', 'POST', {
      nombre: 'P0-621 synthetic Spray — NOT real inventory', barcode: 'P0-621-SYN',
      precio: 10, costo: 4, stockInicial: 1
    });
    const id = created.value.id || (created.value.producto && created.value.producto.id);
    assert.ok(id, JSON.stringify(created.value));
    await pump(PWA, Opera);
    assert.equal((await product(Opera.page, id)).stockActual, 1);

    for (const [older, newer] of [[33, 15], [14, 13]]) {
      // A writes an older physical fact and B receives it.
      await physicalCount(PWA.page, id, older);
      await pump(PWA, Opera);
      assert.equal((await product(Opera.page, id)).stockActual, older);

      // B then writes the NEWER physical fact while A still has its old count.
      await physicalCount(Opera.page, id, newer);
      assert.equal((await product(PWA.page, id)).stockActual, older,
        'the old peer still has the previous count before pump');

      // An old peer wakes/reseeds while a fresh physical count is in flight.
      await PWA.page.evaluate(() => window.dispatchEvent(new CustomEvent('oc-catalogo-cambiado')));
      await pump(PWA, Opera);

      assert.equal((await product(Opera.page, id)).stockActual, newer,
        'newer physical count must remain on the originating peer');
      assert.equal((await product(PWA.page, id)).stockActual, newer,
        'older PWA must adopt later Opera count, not republish the old one');
      // Reverse flow: another emission after convergence cannot resurrect old data.
      await Opera.page.evaluate(() => window.dispatchEvent(new CustomEvent('oc-catalogo-cambiado')));
      await pump(Opera, PWA);
      assert.equal((await product(PWA.page, id)).stockActual, newer);
      assert.equal((await product(Opera.page, id)).stockActual, newer);
    }
  } finally {
    await PWA.ctx.close(); await Opera.ctx.close();
  }
});
