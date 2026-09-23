/* v359 — impuesto configurable del cuaderno compartido (JFC 2026-09-23:
   "no puede ser un given ni inmutable... somos ante todo un SHARED digital
   NOTEBOOK"). Fixtures sintéticos, sin red ni datos de clientes. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const { setTimeout: delay } = require('node:timers/promises');
const { browser } = require('./helpers/browser.cjs');

async function venta(w, precio) {
  const u = await w.request('/api/ubicaciones', 'POST', { nombre: 'Percha impuesto' });
  const p = await w.request('/api/productos', 'POST', { nombre: 'Item impuesto', barcode: 'FIX-TAX-' + Math.random().toString(36).slice(2, 8), precio, costo: 40, ubicacionId: u.id });
  await w.request(`/api/productos/${p.id}/ajustar`, 'POST', { delta: 5, motivo: 'Carga fixture' });
  await w.request(`/api/productos/${p.id}/venta`, 'POST', { cantidad: 1 });
  return u.id;
}
const dueno = (w) => { w.OCAuth = { rolActual: () => 'dueno', esDemo: () => false }; return w; };

test('default is OFF: prices are net and the P&L reports what was collected (Cash is no longer $0)', async () => {
  const w = dueno(browser());
  const u = await venta(w, 115);
  const pl = await w.request(`/api/reportes/pl?ubicacionId=${u}`);
  assert.equal(pl.impuesto.activo, false);
  assert.equal(pl.ingresos, 115);
  assert.equal(pl.ingresosConIva, 115, 'lo cobrado ya no llega vacío');
  assert.equal(pl.ivaCobrado, 0);
});

test('ON at 15%: the P&L separates the tax included in the price', async () => {
  const w = dueno(browser());
  const u = await venta(w, 115);
  await w.request('/api/config/impuesto', 'PUT', { activo: true, tasa: 15, nombre: 'IVA' });
  const pl = await w.request(`/api/reportes/pl?ubicacionId=${u}`);
  assert.deepEqual({ ...pl.impuesto }, { activo: true, tasa: 15, nombre: 'IVA' });
  assert.equal(pl.ingresosConIva, 115);
  assert.equal(pl.ingresos, 100);
  assert.equal(pl.ivaCobrado, 15);
  assert.equal(pl.utilidadBruta, 60);
});

test('only the owner or an admin can change it; a bad rate is rejected', async () => {
  const w = dueno(browser());
  w.OCAuth.rolActual = () => 'empleado';
  await assert.rejects(() => w.request('/api/config/impuesto', 'PUT', { activo: true, tasa: 10, nombre: 'GST' }));
  w.OCAuth.rolActual = () => 'admin';
  await assert.rejects(() => w.request('/api/config/impuesto', 'PUT', { activo: true, tasa: 150, nombre: 'X' }));
  assert.equal((await w.request('/api/config/impuesto', 'PUT', { activo: true, tasa: 10, nombre: 'GST' })).tasa, 10);
});

test('it is a NOTEBOOK setting: it travels to the other device and in the backup', async () => {
  const a = dueno(browser()), b = dueno(browser());
  await a.request('/api/config/impuesto', 'PUT', { activo: true, tasa: 8.25, nombre: 'Sales tax' });
  b.receive(a);
  const cb = await b.request('/api/config/impuesto');
  assert.equal(cb.activo, true); assert.equal(cb.tasa, 8.25);
  await a.request('/api/config/impuesto', 'PUT', { activo: false, tasa: 8.25, nombre: 'Sales tax' });
  b.receive(a);
  assert.equal((await b.request('/api/config/impuesto')).activo, false, 'apagarlo también viaja');
  const respaldo = await a.request('/api/respaldo/exportar');
  const limpio = dueno(browser());
  await limpio.request('/api/respaldo/importar', 'POST', respaldo);
  assert.equal((await limpio.request('/api/config/impuesto')).tasa, 8.25);
});

async function peer() {
  const w = browser();
  delete w.JSON;
  Object.assign(w, { crypto: webcrypto, TextEncoder, TextDecoder,
    WebSocket: class { constructor() { throw new Error('No real relay allowed in tests'); } },
    BroadcastChannel: class { constructor() { throw new Error('No cross-test channels'); } } });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../docs/vendor/yjs-bundle.min.js'), 'utf8'), w);
  w.IndexeddbPersistence = class { once() {} };
  w.localStorage.setItem('f123_owned', JSON.stringify({ licenseCode: 'F123-SYNTHETIC-IMPUESTO' }));
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../docs/sync-yjs.js'), 'utf8'), w);
  for (let i = 0; i < 100 && w.OCYjs.estado !== 'activo'; i++) await delay(10);
  return dueno(w);
}

test('actual Yjs bridge carries the tax setting to another device', async () => {
  const a = await peer(), b = await peer();
  await a.request('/api/config/impuesto', 'PUT', { activo: true, tasa: 12, nombre: 'IVA' });
  a.OCYjs._store.sembrar();
  b.Y.applyUpdate(b.OCYjs.doc, a.Y.encodeStateAsUpdate(a.OCYjs.doc), 'red');
  b.OCYjs._store.aplicar();
  const cb = await b.request('/api/config/impuesto');
  assert.equal(cb.activo, true); assert.equal(cb.tasa, 12);
});
