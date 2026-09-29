// VENTA DURABLE + FALTANTE VISIBLE (JFC 2026-09-29; retoma el trabajo que Codex dejó sin subir).
// Bug 1: dos aparatos sin red venden la ULTIMA unidad. El contador compartido suma
// bien (base 1, -1 -1 = -1) pero Math.max(0, ...) lo mostraba como 0: el faltante
// de 1 unidad desaparecia y nadie sabia que habia que contar la percha.
// Bug 2: la venta respondia "ok" y recien DESPUES (en finally) intentaba guardar.
// Si fallaban localStorage e IndexedDB, la app decia "vendido", la op ya habia
// salido a los otros aparatos y la venta se perdia al recargar.
// Pruebas escritas antes del arreglo: 1, 2 y 3 rojas en v420; 4 es de fijacion.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const { setTimeout: delay } = require('node:timers/promises');
const { browser } = require('./helpers/browser.cjs');

async function peer() {
  const w = browser();
  delete w.JSON;
  Object.assign(w, { crypto: webcrypto, TextEncoder, TextDecoder,
    WebSocket: class { constructor() { throw new Error('No real relay allowed in tests'); } },
    BroadcastChannel: class { constructor() { throw new Error('No cross-test channels'); } } });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../docs/vendor/yjs-bundle.min.js'), 'utf8'), w);
  w.IndexeddbPersistence = class { once() {} };
  w.localStorage.setItem('f123_owned', JSON.stringify({ licenseCode: 'SYNTHETIC-ISOLATED-FIXTURE' }));
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../docs/sync-yjs.js'), 'utf8'), w);
  for (let i = 0; i < 100 && w.OCYjs.estado !== 'activo'; i++) await delay(10);
  return w;
}
function transfer(from, to) {
  to.Y.applyUpdate(to.OCYjs.doc, from.Y.encodeStateAsUpdate(from.OCYjs.doc), 'red');
  to.OCYjs._store.aplicar();
}
async function conStock(w, id, n) {
  const fx = await w.request('/api/respaldo/exportar');
  const p = fx.productos.find((x) => x.stockActual >= 1);
  p.id = id; p.stockActual = n; delete p.stockBase; delete p.stockPN;
  fx.productos = [p]; fx.ventas = []; fx.movimientos = [];
  await w.request('/api/respaldo/importar', 'POST', fx);
}
const prod = async (w, id) => (await w.request('/api/respaldo/exportar')).productos.find((p) => p.id === id);

test('1. Yjs: both devices sell the last unit offline -> 0 on shelf, deficit 1 visible, both sales kept', async () => {
  const a = await peer(), b = await peer();
  await conStock(a, 'p-ultima', 1); await conStock(b, 'p-ultima', 1);
  const va = await a.request('/api/productos/p-ultima/venta', 'POST', { cantidad: 1 });
  const vb = await b.request('/api/productos/p-ultima/venta', 'POST', { cantidad: 1 });
  a.OCYjs._store.sembrar(); b.OCYjs._store.sembrar();
  transfer(a, b); transfer(b, a);
  a.OCYjs._store.sembrar(); b.OCYjs._store.sembrar();
  transfer(a, b); transfer(b, a);
  for (const w of [a, b]) {
    const p = await prod(w, 'p-ultima');
    assert.equal(p.stockActual, 0, 'shelf never shows negative units');
    assert.equal(p.stockDeficit, 1, 'the missing unit is recorded, not hidden');
    const ids = (await w.request('/api/ventas/todas')).map((v) => v.id);
    assert.ok(ids.includes(va.ventaId) && ids.includes(vb.ventaId), 'both sales survive');
  }
});

test('2. old merge path (aplicarCatalogo): same case keeps the deficit and shows it on the product card data', async () => {
  const a = browser(), b = browser();
  await conStock(a, 'p-ultima2', 1); await conStock(b, 'p-ultima2', 1);
  await a.request('/api/productos/p-ultima2/venta', 'POST', { cantidad: 1 });
  await b.request('/api/productos/p-ultima2/venta', 'POST', { cantidad: 1 });
  a.receive(b); b.receive(a);
  for (const w of [a, b]) {
    const p = await prod(w, 'p-ultima2');
    assert.equal(p.stockActual, 0);
    assert.equal(p.stockDeficit, 1);
    const card = (await w.request('/api/productos')).find((x) => x.id === 'p-ultima2');
    assert.equal(card.stockDeficit, 1, 'the inventory card receives the deficit');
  }
});

test('2b. restocking pays the deficit first and both devices agree after syncing', async () => {
  const a = browser(), b = browser();
  await conStock(a, 'p-repone', 1); await conStock(b, 'p-repone', 1);
  await a.request('/api/productos/p-repone/venta', 'POST', { cantidad: 1 });
  await b.request('/api/productos/p-repone/venta', 'POST', { cantidad: 1 });
  a.receive(b); b.receive(a);
  const r = await a.request('/api/productos/p-repone/ajustar', 'POST', { delta: 3, motivo: 'conteo' });
  assert.equal(r.stockActual, 2, '3 in, 1 owed: 2 on the shelf');
  assert.equal(r.stockDeficit, 0);
  b.receive(a); a.receive(b);
  for (const w of [a, b]) {
    const p = await prod(w, 'p-repone');
    assert.equal(p.stockActual, 2); assert.equal(p.stockDeficit, 0);
  }
});

test('2c. pinning (DDIA J2): one device restocks +3 while another sells 2 -> coherent balance on both', async () => {
  const a = browser(), b = browser();
  await conStock(a, 'p-ddia', 5); await conStock(b, 'p-ddia', 5);
  await a.request('/api/productos/p-ddia/ajustar', 'POST', { delta: 3, motivo: 'compra' });
  await b.request('/api/productos/p-ddia/venta', 'POST', { cantidad: 2 });
  a.receive(b); b.receive(a);
  for (const w of [a, b]) {
    const p = await prod(w, 'p-ddia');
    assert.equal(p.stockActual, 6, '5 + 3 - 2'); assert.equal(p.stockDeficit || 0, 0);
  }
});

test('3. both stores fail: the sale answers an error, nothing changes and nothing is sent', async () => {
  const w = browser();
  await conStock(w, 'p-disco', 5);
  const antes = await w.request('/api/respaldo/exportar');
  let emitidas = 0;
  w.OCSyncEmit = () => { emitidas++; };
  const setItem = w.localStorage.setItem.bind(w.localStorage);
  w.localStorage.setItem = () => { throw new Error('QuotaExceededError'); };
  w.OCEstadoIDB = { guardar: async () => { throw new Error('IDB down'); } };
  const r = await w.fetch('/api/productos/p-disco/venta', { method: 'POST', body: JSON.stringify({ cantidad: 2 }) });
  w.localStorage.setItem = setItem; delete w.OCEstadoIDB;
  assert.ok(r.status >= 500, 'the sale must not claim success, got ' + r.status);
  const despues = await w.request('/api/respaldo/exportar');
  assert.equal(despues.productos.find((p) => p.id === 'p-disco').stockActual, 5, 'stock rolled back');
  assert.equal(despues.ventas.length, antes.ventas.length, 'no ghost sale');
  assert.equal(despues.movimientos.length, antes.movimientos.length, 'no ghost log entry');
  assert.equal(emitidas, 0, 'no stock op leaves the device');
});

test('4. pinning: localStorage full but IndexedDB accepts -> the sale is confirmed and sent', async () => {
  const w = browser();
  await conStock(w, 'p-idb', 5);
  let emitidas = 0;
  w.OCSyncEmit = () => { emitidas++; };
  const setItem = w.localStorage.setItem.bind(w.localStorage);
  w.localStorage.setItem = () => { throw new Error('QuotaExceededError'); };
  w.OCEstadoIDB = { guardar: async () => true };
  const r = await w.fetch('/api/productos/p-idb/venta', { method: 'POST', body: JSON.stringify({ cantidad: 2 }) });
  w.localStorage.setItem = setItem; delete w.OCEstadoIDB;
  assert.equal(r.status, 200);
  assert.equal((await prod(w, 'p-idb')).stockActual, 3);
  assert.equal(emitidas, 1);
});
