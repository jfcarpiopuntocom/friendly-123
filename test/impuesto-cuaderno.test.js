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
  // v361: el impuesto se congela en la venta; se enciende ANTES de vender.
  const w = dueno(browser());
  await w.request('/api/config/impuesto', 'PUT', { activo: true, tasa: 15, nombre: 'IVA' });
  const u = await venta(w, 115);
  const pl = await w.request(`/api/reportes/pl?ubicacionId=${u}`);
  assert.deepEqual({ ...pl.impuesto }, { activo: true, tasa: 15, nombre: 'IVA', modo: 'incluido' });
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

/* ---- v361: impuesto global (congelado por venta, sumado al cobrar, exento,
   centavos por línea, moneda del cuaderno). ---- */
async function ventaDe(w, precio, extra) {
  const u = await w.request('/api/ubicaciones', 'POST', { nombre: 'Percha v361' });
  const p = await w.request('/api/productos', 'POST', Object.assign({ nombre: 'Item v361', barcode: 'FIX-361-' + Math.random().toString(36).slice(2, 8), precio, costo: 1, ubicacionId: u.id }, extra || {}));
  await w.request(`/api/productos/${p.id}/ajustar`, 'POST', { delta: 5, motivo: 'Carga fixture' });
  await w.request(`/api/productos/${p.id}/venta`, 'POST', { cantidad: 1 });
  return { u: u.id, p };
}

test('changing the rate later does NOT rewrite a sale already made', async () => {
  const w = dueno(browser());
  await w.request('/api/config/impuesto', 'PUT', { activo: true, tasa: 10, nombre: 'VAT' });
  const { u } = await ventaDe(w, 110);
  await w.request('/api/config/impuesto', 'PUT', { activo: true, tasa: 25, nombre: 'VAT' });
  const pl = await w.request(`/api/reportes/pl?ubicacionId=${u}`);
  assert.equal(pl.ivaCobrado, 10, 'la venta conserva el 10% con que se hizo');
  assert.equal(pl.ingresos, 100);
});

test('"added when charging" (US sales tax): tax goes on top and cash includes it', async () => {
  const w = dueno(browser());
  await w.request('/api/config/impuesto', 'PUT', { activo: true, tasa: 8.25, nombre: 'Sales tax', modo: 'agregado' });
  const { u } = await ventaDe(w, 100);
  const pl = await w.request(`/api/reportes/pl?ubicacionId=${u}`);
  assert.equal(pl.ingresos, 100, 'el precio es neto');
  assert.equal(pl.ivaCobrado, 8.25);
  assert.equal(pl.ingresosConIva, 108.25, 'se cobró precio + impuesto');
  const bal = await w.request(`/api/reportes/balance?ubicacionId=${u}`);
  assert.equal(bal.activos.efectivoEstimado, 108.25);
});

test('a tax-exempt product pays no tax and the flag survives sync and backup', async () => {
  const a = dueno(browser());
  await a.request('/api/config/impuesto', 'PUT', { activo: true, tasa: 15, nombre: 'IVA' });
  const { u, p } = await ventaDe(a, 50, { exentoImpuesto: true });
  const pl = await a.request(`/api/reportes/pl?ubicacionId=${u}`);
  assert.equal(pl.ivaCobrado, 0);
  const b = dueno(browser()); b.receive(a);
  assert.equal((await b.request(`/api/productos/${p.id}`)).exentoImpuesto, true, 'viaja por el sync');
  const r = await a.request('/api/respaldo/exportar');
  assert.equal(r.productos.find(x => x.id === p.id).exentoImpuesto, true, 'va en el respaldo');
});

test('the tax is rounded per line in whole cents', async () => {
  const w = dueno(browser());
  await w.request('/api/config/impuesto', 'PUT', { activo: true, tasa: 7, nombre: 'Tax', modo: 'agregado' });
  const { u } = await ventaDe(w, 0.99);
  const pl = await w.request(`/api/reportes/pl?ubicacionId=${u}`);
  assert.equal(pl.ivaCobrado, 0.07, '0.99 x 7% = 0.0693 -> 0.07 (centavo entero)');
});

test('a sale keeps its tax when it travels to another device', async () => {
  const a = dueno(browser()), b = dueno(browser());
  await a.request('/api/config/impuesto', 'PUT', { activo: true, tasa: 12, nombre: 'IVA' });
  const { u } = await ventaDe(a, 112);
  b.receive(a);
  const v = (await b.request('/api/respaldo/exportar')).ventas.find(x => x.ubicacionId === u);
  assert.equal(v.impuesto && v.impuesto.monto, 12);
});

test('currency is a notebook setting: it formats money and travels', async () => {
  const a = dueno(browser()), b = dueno(browser());
  assert.equal(a.OCMoneda.formato(21913), '$21,913.00', 'USD por defecto, igual que siempre');
  await a.request('/api/config/moneda', 'PUT', { codigo: 'eur' });
  assert.equal(a.OCMoneda.codigo(), 'EUR');
  await assert.rejects(() => a.request('/api/config/moneda', 'PUT', { codigo: 'EURO' }));
  b.receive(a);
  assert.equal((await b.request('/api/config/moneda')).codigo, 'EUR');
});
