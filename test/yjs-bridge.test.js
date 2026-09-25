const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const { setTimeout: delay } = require('node:timers/promises');
const { browser } = require('./helpers/browser.cjs');

async function peer(licenseCode = 'SYNTHETIC-ISOLATED-FIXTURE') {
  const w = browser();
  // Keep JSON objects in the same realm as the vendored Yjs implementation.
  delete w.JSON;
  Object.assign(w, { crypto: webcrypto, TextEncoder, TextDecoder,
    WebSocket: class { constructor() { throw new Error('No real relay allowed in tests'); } },
    BroadcastChannel: class { constructor() { throw new Error('No cross-test channels'); } } });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../docs/vendor/yjs-bundle.min.js'), 'utf8'), w);
  // These tests exercise the actual store bridge and Yjs updates, not browser disk persistence.
  w.IndexeddbPersistence = class { once() {} };
  w.localStorage.setItem('f123_owned', JSON.stringify({ licenseCode }));
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../docs/sync-yjs.js'), 'utf8'), w);
  for (let attempt = 0; attempt < 100 && w.OCYjs.estado !== 'activo'; attempt++) await delay(10);
  assert.equal(w.OCYjs.estado, 'activo');
  return w;
}

test('other businesses join only their own existing license room without rewriting identity', async () => {
  const a = await peer('F123-SYNTHETIC-CLIENT');
  const b = await peer('F123-SYNTHETIC-CLIENT');
  const other = await peer('F123-SYNTHETIC-OTHER');
  assert.equal(a.OCYjs.roomId, b.OCYjs.roomId);
  assert.notEqual(a.OCYjs.roomId, other.OCYjs.roomId);
  assert.equal(JSON.parse(a.localStorage.getItem('f123_owned')).licenseCode, 'F123-SYNTHETIC-CLIENT');
  assert.equal(JSON.parse(other.localStorage.getItem('f123_owned')).licenseCode, 'F123-SYNTHETIC-OTHER');
});

function transfer(from, to) {
  const update = from.Y.encodeStateAsUpdate(from.OCYjs.doc);
  to.Y.applyUpdate(to.OCYjs.doc, update, 'red');
  to.OCYjs._store.aplicar();
}

test('actual Yjs bridge preserves an edited customer through receive and periodic reseed', async () => {
  const a = await peer(), b = await peer();
  const c = await a.request('/api/clientes', 'POST', { nombre: 'Bridge fixture' });
  a.OCYjs._store.sembrar(); transfer(a, b);
  assert.equal((await b.request('/api/clientes')).find(x => x.id === c.id).nombre, 'Bridge fixture');
  await a.request(`/api/clientes/${c.id}/contacto`, 'PATCH', { nombre: 'Bridge edited' });
  a.OCYjs._store.sembrar(); transfer(a, b);
  // The Yjs document received the edit. Its local store must agree before reseeding.
  assert.equal(b.OCYjs.mapas.clientes.get(c.id).nombre, 'Bridge edited');
  const storedName = (await b.request('/api/clientes')).find(x => x.id === c.id).nombre;
  b.OCYjs._store.sembrar(); transfer(b, a);
  assert.equal(storedName, 'Bridge edited', 'backend must apply the Yjs record');
  assert.equal(a.OCYjs.mapas.clientes.get(c.id).nombre, 'Bridge edited', 'periodic seed must not republish stale local data');
});

test('actual Yjs bridge keeps both offline stock deductions', async () => {
  const a = await peer(), b = await peer();
  const fixture = await a.request('/api/respaldo/exportar');
  const product = fixture.productos.find(p => p.stockActual >= 10);
  product.id = 'p-bridge-stock'; product.stockActual = 10;
  fixture.productos = [product]; fixture.ventas = []; fixture.movimientos = [];
  await a.request('/api/respaldo/importar', 'POST', fixture);
  await b.request('/api/respaldo/importar', 'POST', fixture);
  await a.request(`/api/productos/${product.id}/venta`, 'POST', { cantidad: 2 });
  await b.request(`/api/productos/${product.id}/venta`, 'POST', { cantidad: 3 });
  a.OCYjs._store.sembrar(); b.OCYjs._store.sembrar();
  transfer(a, b); transfer(b, a);
  a.OCYjs._store.sembrar(); b.OCYjs._store.sembrar();
  transfer(a, b); transfer(b, a);
  assert.equal(Object.keys(a.OCYjs.mapas.productos.get(product.id).stockPN).length, 2);
  assert.equal(Object.keys(b.OCYjs.mapas.productos.get(product.id).stockPN).length, 2);
  for (const w of [a, b]) {
    const state = await w.request('/api/respaldo/exportar');
    assert.equal(state.productos.find(p => p.id === product.id).stockActual, 5);
  }
});

test('actual Yjs bridge propagates a sale void without resurrecting revenue', async () => {
  const a = await peer(), b = await peer();
  const fixture = await a.request('/api/respaldo/exportar');
  const product = fixture.productos.find(p => p.stockActual >= 10);
  product.id = 'p-bridge-void'; product.stockActual = 10;
  fixture.productos = [product]; fixture.ventas = []; fixture.movimientos = [];
  await a.request('/api/respaldo/importar', 'POST', fixture);
  await b.request('/api/respaldo/importar', 'POST', fixture);
  const sold = await a.request(`/api/productos/${product.id}/venta`, 'POST', { cantidad: 2 });
  a.OCYjs._store.sembrar(); transfer(a, b);
  assert.equal((await b.request('/api/ventas/todas')).some(v => v.id === sold.ventaId), true);
  await a.request(`/api/ventas/${sold.ventaId}/anular`, 'POST', {});
  a.OCYjs._store.sembrar(); transfer(a, b);
  b.OCYjs._store.sembrar(); transfer(b, a);
  for (const w of [a, b]) {
    assert.equal((await w.request('/api/ventas/todas')).some(v => v.id === sold.ventaId), false);
    assert.equal((await w.request('/api/respaldo/exportar')).productos.find(p => p.id === product.id).stockActual, 10);
  }
});

test('actual Yjs bridge carries sale price and quantity corrections', async () => {
  const a = await peer(), b = await peer();
  a.OCAuth = { rolActual: () => 'admin' };
  const fixture = await a.request('/api/respaldo/exportar');
  const product = fixture.productos.find(p => p.stockActual >= 10);
  product.id = 'p-bridge-edit'; product.stockActual = 10;
  fixture.productos = [product]; fixture.ventas = []; fixture.movimientos = [];
  await a.request('/api/respaldo/importar', 'POST', fixture);
  await b.request('/api/respaldo/importar', 'POST', fixture);
  const sold = await a.request(`/api/productos/${product.id}/venta`, 'POST', { cantidad: 2 });
  a.OCYjs._store.sembrar(); transfer(a, b);
  await a.request(`/api/ventas/${sold.ventaId}`, 'PATCH', { cantidad: 3, precioUnit: 17 });
  a.OCYjs._store.sembrar(); transfer(a, b);
  const sale = (await b.request('/api/ventas/todas')).find(v => v.id === sold.ventaId);
  assert.equal(sale.cantidad, 3);
  assert.equal(sale.precioUnit, 17);
  assert.equal((await b.request('/api/respaldo/exportar')).productos.find(p => p.id === product.id).stockActual, 7);
});

test('actual Yjs bridge retains product and shelf tombstones through stale reseed', async () => {
  const a = await peer(), b = await peer();
  const shelf = await a.request('/api/ubicaciones', 'POST', { nombre: 'Bridge shelf' });
  const product = await a.request('/api/productos', 'POST', { nombre: 'Bridge item', barcode: 'bridge-item', ubicacionId: shelf.id, umbralRojo: 1, umbralAmarillo: 3 });
  a.OCYjs._store.sembrar(); transfer(a, b);
  await a.request(`/api/ubicaciones/${shelf.id}`, 'DELETE', {});
  a.OCYjs._store.sembrar();
  b.OCYjs._store.sembrar(); transfer(b, a); transfer(a, b);
  for (const w of [a, b]) {
    assert.equal((await w.request('/api/ubicaciones?todas=1')).some(x => x.id === shelf.id), false);
    assert.equal((await w.request('/api/productos')).some(x => x.id === product.id), false);
    assert.equal(w.OCYjs.mapas.productos.get(product.id).borrado, true);
  }
});

test('actual Yjs bridge carries expense edits, cancellation and monthly setting', async () => {
  const a = await peer(), b = await peer();
  a.OCAuth = { rolActual: () => 'dueno' };
  const shelf = await a.request('/api/ubicaciones', 'POST', { nombre: 'Expense shelf' });
  const expense = await a.request('/api/gastos', 'POST', { concepto: 'Bridge expense', monto: 12 });
  await a.request('/api/configuracion/gastos', 'POST', { ubicacionId: shelf.id, gastosMensuales: 31 });
  a.OCYjs._store.sembrar(); transfer(a, b);
  assert.equal((await b.request('/api/gastos')).total, 12);
  assert.equal((await b.request(`/api/configuracion/gastos?ubicacionId=${shelf.id}`)).gastosMensuales, 31);
  await a.request(`/api/gastos/${expense.id}`, 'PATCH', { monto: 14 });
  a.OCYjs._store.sembrar(); transfer(a, b);
  assert.equal((await b.request('/api/gastos')).total, 14);
  await a.request(`/api/gastos/${expense.id}`, 'DELETE', {});
  a.OCYjs._store.sembrar(); b.OCYjs._store.sembrar(); transfer(b, a); transfer(a, b);
  assert.equal((await b.request('/api/gastos')).total, 0);
});

test('actual Yjs bridge carries transfer stages and stock', async () => {
  const a = await peer(), b = await peer();
  const fixture = await a.request('/api/respaldo/exportar');
  const origin = fixture.productos.find(p => p.stockActual >= 10);
  const destination = { ...origin, id: 'p-yjs-destination', ubicacionId: 'yjs-destination', stockActual: 1 };
  origin.id = 'p-yjs-origin'; origin.ubicacionId = 'yjs-origin'; origin.stockActual = 10;
  fixture.productos = [origin, destination]; fixture.ubicaciones = [
    { id: 'yjs-origin', nombre: 'Origin', activa: true },
    { id: 'yjs-destination', nombre: 'Destination', activa: true }
  ]; fixture.ventas = []; fixture.transferencias = []; fixture.movimientos = [];
  await a.request('/api/respaldo/importar', 'POST', fixture);
  await b.request('/api/respaldo/importar', 'POST', fixture);
  const t = await a.request('/api/transferencias', 'POST', { productoOrigenId: origin.id, productoDestinoId: destination.id, cantidad: 2 });
  a.OCYjs._store.sembrar(); transfer(a, b);
  assert.equal((await b.request('/api/transferencias')).find(x => x.id === t.id).estado, 'solicitada');
  await a.request(`/api/transferencias/${t.id}/aprobar`, 'POST', {});
  a.OCYjs._store.sembrar(); transfer(a, b);
  assert.equal((await b.request('/api/transferencias')).find(x => x.id === t.id).estado, 'en_transito');
  assert.equal((await b.request('/api/respaldo/exportar')).productos.find(x => x.id === origin.id).stockActual, 8);
  await a.request(`/api/transferencias/${t.id}/confirmar-recepcion`, 'POST', {});
  a.OCYjs._store.sembrar(); transfer(a, b);
  assert.equal((await b.request('/api/transferencias')).find(x => x.id === t.id).estado, 'recibida');
  assert.equal((await b.request('/api/respaldo/exportar')).productos.find(x => x.id === destination.id).stockActual, 3);
});

test('actual Yjs bridge carries settlement of an existing sale', async () => {
  const a = await peer(), b = await peer();
  const fixture = await a.request('/api/respaldo/exportar');
  // Percha CON comision: desde 2026-09-24 (B5) pagar solo sella ventas que tienen algo que pagar.
  const product = fixture.productos.find(p => p.stockActual >= 10 && (fixture.ubicaciones.find(u => u.id === p.ubicacionId) || {}).tipo !== 'propio');
  product.id = 'p-yjs-settlement'; product.stockActual = 10;
  fixture.productos = [product]; fixture.ventas = []; fixture.movimientos = [];
  await a.request('/api/respaldo/importar', 'POST', fixture);
  await b.request('/api/respaldo/importar', 'POST', fixture);
  const sold = await a.request(`/api/productos/${product.id}/venta`, 'POST', { cantidad: 2 });
  a.OCYjs._store.sembrar(); transfer(a, b);
  assert.equal((await b.request('/api/respaldo/exportar')).ventas.find(v => v.id === sold.ventaId).liquidada, false);
  const result = await a.request(`/api/liquidaciones/${product.ubicacionId}/marcar-pagado`, 'POST', {});
  assert.equal(result.ventasLiquidadas, 1);
  a.OCYjs._store.sembrar(); transfer(a, b);
  assert.equal((await b.request('/api/respaldo/exportar')).ventas.find(v => v.id === sold.ventaId).liquidada, true);
});
