'use strict';
// JFC 2026-11-01: "fijar en N" (owner/admin) is a physical count; the latest count wins on every device; nothing lost.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startServer, openDevice, enterAs, installPump, pump } = require('./helpers/e2e-app.cjs');
const { chromium } = require('playwright');
let server, base, web;
before(async () => { ({ srv: server, base } = await startServer()); web = await chromium.launch(); });
after(async () => { await web.close(); await new Promise(r => server.close(r)); });
const api = (page, url, method = 'GET', body) => page.evaluate(async ([u, m, b]) => { const r = await fetch(u, { method: m, body: b ? JSON.stringify(b) : undefined }); return { status: r.status, j: await r.json() }; }, [url, method, body]);
const stock = async (page, id) => { const r = await api(page, '/api/productos'); const l = Array.isArray(r.j) ? r.j : (r.j.productos || []); return (l.find(x => x.id === id) || {}).stockActual; };
const movs = async page => { const r = await page.evaluate(() => JSON.stringify(window.OCSync && window.OCSync.exportar ? window.OCSync.exportar() : '')); return r; };
test('offline deltas on A + later physical count 7 on B => both 7; a later sale subtracts on both', { timeout: 300000 }, async () => {
  const A = await openDevice(web, base), B = await openDevice(web, base);
  await enterAs(A.page, 'dueno'); await enterAs(B.page, 'admin');
  await A.page.waitForFunction(() => OCYjs.estado === 'activo'); await B.page.waitForFunction(() => OCYjs.estado === 'activo');
  await installPump([A, B]);
  const c = await api(A.page, '/api/productos', 'POST', { nombre: 'Conteo 1', barcode: 'CF-1', stockInicial: 6, precio: 10, costo: 4 });
  const id = c.j.id || (c.j.producto && c.j.producto.id); assert.ok(id);
  await pump(A, B); await A.page.waitForTimeout(600); await pump(A, B);
  assert.equal(await stock(B.page, id), 6, 'B starts synced at 6');
  // A, disconnected (no pump), records older movements
  for (const delta of [3, -1, 2]) assert.equal((await api(A.page, '/api/productos/' + id + '/ajustar', 'POST', { delta, motivo: 'old offline' })).status, 200);
  await A.page.waitForTimeout(50);
  // B, later, counts physically 7
  const f = await api(B.page, '/api/productos/' + id + '/ajustar', 'POST', { stockFisico: 7, motivo: 'conteo' });
  assert.equal(f.status, 200, JSON.stringify(f.j).slice(0, 200));
  assert.equal(await stock(B.page, id), 7);
  // reconnect
  for (let i = 0; i < 4; i++) { await pump(A, B); await A.page.waitForTimeout(500); }
  assert.equal(await stock(A.page, id), 7, 'A adopts the latest physical count');
  assert.equal(await stock(B.page, id), 7, 'B keeps the latest physical count');
  // a movement after the count adds on top of it
  assert.equal((await api(A.page, '/api/productos/' + id + '/ajustar', 'POST', { delta: -2, motivo: 'after count' })).status, 200);
  for (let i = 0; i < 4; i++) { await pump(A, B); await A.page.waitForTimeout(500); }
  assert.equal(await stock(A.page, id), 5); assert.equal(await stock(B.page, id), 5);
  await A.ctx.close(); await B.ctx.close();
});
test('only owner/admin can set a physical count', { timeout: 120000 }, async () => {
  const A = await openDevice(web, base); await enterAs(A.page, 'dueno');
  const c = await api(A.page, '/api/productos', 'POST', { nombre: 'Conteo 2', barcode: 'CF-2', stockInicial: 3, precio: 10, costo: 4 });
  const id = c.j.id || (c.j.producto && c.j.producto.id);
  await A.page.evaluate(() => { OCAuth.rolActual = () => 'artista'; });
  assert.equal((await api(A.page, '/api/productos/' + id + '/ajustar', 'POST', { stockFisico: 9, motivo: 'x' })).status, 403);
  await A.ctx.close();
});


test('P0 PWA -> Safari: 1 to 33 publishes committed physical epoch before iOS suspends a scheduled seed', { timeout: 300000 }, async () => {
  const PWA = await openDevice(web, base), Safari = await openDevice(web, base);
  try {
    await enterAs(PWA.page, 'dueno'); await enterAs(Safari.page, 'admin');
    await PWA.page.waitForFunction(() => OCYjs.estado === 'activo');
    await Safari.page.waitForFunction(() => OCYjs.estado === 'activo');
    await installPump([PWA, Safari]);
    const created = await api(PWA.page, '/api/productos', 'POST', {
      nombre: 'Spray de la Verdad — synthetic', barcode: 'SYN-SPRAY-1', stockInicial: 1, precio: 10, costo: 4
    });
    const id = created.j.id || (created.j.producto && created.j.producto.id);
    assert.ok(id);
    await pump(PWA, Safari); await PWA.page.waitForTimeout(600); await pump(PWA, Safari);
    assert.equal(await stock(Safari.page, id), 1, 'Safari initially has exactly 1');

    // Model iOS suspending the 0-ms scheduled catalog seed when the owner
    // switches immediately from the installed PWA to Safari after success.
    // Only defer the seed callback; NEVER intercept strict IDB or Sync3 transport.
    const result = await PWA.page.evaluate(async id => {
      const realTimer = window.setTimeout, held = [];
      let deferredSeed = 0;
      window.setTimeout = function (fn, ms, ...args) {
        if (ms === 0 && typeof fn === 'function' &&
            String(fn).includes('_tSeed = null') && String(fn).includes('sembrar()')) {
          deferredSeed++;
          held.push(() => fn(...args));
          return realTimer(() => {}, 0);
        }
        return realTimer(fn, ms, ...args);
      };
      try {
        const response = await fetch('/api/productos/' + id + '/ajustar', {
          method: 'POST', body: JSON.stringify({ stockFisico: 33, motivo: 'synthetic physical count' })
        });
        const payload = await response.json();
        const local = (await (await fetch('/api/respaldo/exportar')).json()).productos.find(p => p.id === id);
        const shared = window.OCYjs && window.OCYjs.mapas &&
          window.OCYjs.mapas.productos && window.OCYjs.mapas.productos.get(id);
        return {
          status: response.status, payload, deferredSeed, local: local && local.stockActual,
          yStock: shared && shared.stockActual, epoch: shared && shared.stockEpochId,
          localEpoch: local && local.stockEpochId
        };
      } finally {
        window.setTimeout = realTimer;
        held.forEach(fn => realTimer(fn, 0));
      }
    }, id);
    assert.equal(result.status, 200, JSON.stringify(result.payload).slice(0, 240));
    assert.equal(result.local, 33, 'durable local count must succeed independently of sync');
    assert.ok(result.deferredSeed > 0, 'the normal scheduled path was deliberately frozen');
    assert.equal(result.yStock, 33, 'same-turn Sync3 doc must already contain 33 BEFORE an iOS background suspension');
    assert.ok(result.epoch && result.epoch === result.localEpoch, 'the exact physical epoch travels with the count');

    for (let i = 0; i < 4; i++) { await pump(PWA, Safari); await PWA.page.waitForTimeout(250); }
    assert.equal(await stock(Safari.page, id), 33, 'Safari must adopt precisely 33, not a +32 delta');
    assert.equal(await stock(PWA.page, id), 33);
  } finally {
    await PWA.ctx.close(); await Safari.ctx.close();
  }
});
