const { test } = require('node:test');
const assert = require('node:assert/strict');
const { browser } = require('./helpers/browser.cjs');

test('device roster keys use each local mycelium ID, not a shared license instance', () => {
  const a = browser(), b = browser();
  a.OCMicelio = { yo: () => ({ id: 'phone-local-id' }), miApodo: () => 'Phone' };
  b.OCMicelio = { yo: () => ({ id: 'pc-local-id' }), miApodo: () => 'PC' };
  assert.equal(a.catalog().dispositivos[0].id, 'phone-local-id');
  assert.equal(b.catalog().dispositivos[0].id, 'pc-local-id');
});

test('customer contact edits reach a second backend, including an intentional empty phone', async () => {
  const a = browser(), b = browser();
  const c = await a.request('/api/clientes', 'POST', { nombre: 'Fixture customer', telefono: '123' });
  b.receive(a);
  await a.request(`/api/clientes/${c.id}/contacto`, 'PATCH', { nombre: 'Edited fixture', telefono: '', notas: 'Fixture note', pais: 'Ecuador' });
  b.receive(a);
  const actual = (await b.request('/api/clientes')).find(x => x.id === c.id);
  assert.equal(actual.nombre, 'Edited fixture');
  assert.equal(actual.telefono, '');
  assert.equal(actual.notas, 'Fixture note');
  assert.equal(actual.pais, 'Ecuador');
});

test('associate edits reach an existing record', async () => {
  const a = browser(), b = browser();
  const p = await a.request('/api/promotoras', 'POST', { nombre: 'Fixture associate', comisionBase: 4 });
  b.receive(a);
  await a.request(`/api/promotoras/${p.id}`, 'PUT', { nombre: 'Edited associate', comisionBase: 7 });
  b.receive(a);
  const actual = (await b.request('/api/promotoras')).find(x => x.id === p.id);
  assert.equal(actual.nombre, 'Edited associate');
  assert.equal(actual.comisionBase, 7);
});

test('branch edits reach an existing record', async () => {
  const a = browser(), b = browser();
  const s = await a.request('/api/sucursales', 'POST', { nombre: 'Fixture branch' });
  b.receive(a);
  await a.request(`/api/sucursales/${s.id}`, 'PUT', { nombre: 'Edited branch' });
  b.receive(a);
  assert.equal((await b.request('/api/sucursales')).find(x => x.id === s.id).nombre, 'Edited branch');
});

test('deleted customer is not resurrected by an older peer snapshot', async () => {
  const a = browser(), b = browser();
  const c = await a.request('/api/clientes', 'POST', { nombre: 'Fixture removed' });
  b.receive(a);
  await a.request(`/api/clientes/${c.id}`, 'DELETE', {});
  a.receive(b);
  assert.equal((await a.request('/api/clientes')).some(x => x.id === c.id), false);
});

test('two offline sales preserve both stock deductions as well as both sales', async () => {
  const a = browser(), b = browser();
  const fixture = await a.request('/api/respaldo/exportar');
  const product = fixture.productos.find(p => p.stockActual >= 10);
  product.id = 'p-fixture-stock';
  product.stockActual = 10;
  fixture.productos = [product]; fixture.ventas = []; fixture.movimientos = [];
  await a.request('/api/respaldo/importar', 'POST', fixture);
  await b.request('/api/respaldo/importar', 'POST', fixture);
  await a.request(`/api/productos/${product.id}/venta`, 'POST', { cantidad: 2 });
  await b.request(`/api/productos/${product.id}/venta`, 'POST', { cantidad: 3 });
  const ca = a.catalog(), cb = b.catalog();
  a.OCSync.aplicarCatalogo(cb, null); b.OCSync.aplicarCatalogo(ca, null);
  for (const peer of [a, b]) {
    const state = await peer.request('/api/respaldo/exportar');
    assert.equal(state.ventas.reduce((n, sale) => n + sale.cantidad, 0), 5);
    assert.equal(state.productos.find(p => p.id === product.id).stockActual, 5);
  }
});

test('voided sale and restored stock survive an older peer snapshot', async () => {
  const a = browser(), b = browser();
  const fixture = await a.request('/api/respaldo/exportar');
  const product = fixture.productos.find(p => p.stockActual >= 10);
  product.id = 'p-fixture-void'; product.stockActual = 10;
  fixture.productos = [product]; fixture.ventas = []; fixture.movimientos = [];
  await a.request('/api/respaldo/importar', 'POST', fixture);
  await b.request('/api/respaldo/importar', 'POST', fixture);
  const sold = await a.request(`/api/productos/${product.id}/venta`, 'POST', { cantidad: 2 });
  b.receive(a);
  await a.request(`/api/ventas/${sold.ventaId}/anular`, 'POST', {});
  a.receive(b); b.receive(a);
  for (const peer of [a, b]) {
    assert.equal((await peer.request('/api/ventas/todas')).some(v => v.id === sold.ventaId), false);
    assert.equal((await peer.request('/api/respaldo/exportar')).productos.find(p => p.id === product.id).stockActual, 10);
  }
});

test('merged stock counters are idempotent through replay and restart', async () => {
  const a = browser(), b = browser();
  const fixture = await a.request('/api/respaldo/exportar');
  const product = fixture.productos.find(p => p.stockActual >= 10);
  product.id = 'p-fixture-restart'; product.stockActual = 10;
  fixture.productos = [product]; fixture.ventas = []; fixture.movimientos = [];
  await a.request('/api/respaldo/importar', 'POST', fixture);
  await b.request('/api/respaldo/importar', 'POST', fixture);
  await a.request(`/api/productos/${product.id}/venta`, 'POST', { cantidad: 2 });
  await b.request(`/api/productos/${product.id}/venta`, 'POST', { cantidad: 3 });
  a.receive(b); b.receive(a);
  const restarted = browser(a.localStorage);
  restarted.receive(b); restarted.receive(b);
  const state = await restarted.request('/api/respaldo/exportar');
  assert.equal(state.productos.find(p => p.id === product.id).stockActual, 5);
  assert.equal((await restarted.request('/api/ventas/todas')).length, 2);
});
