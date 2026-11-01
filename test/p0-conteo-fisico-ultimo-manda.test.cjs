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
