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

test('team PINs and removal converge so a removed PIN cannot authenticate elsewhere', async () => {
  const a = browser(), b = browser();
  a.OCAuth = { rolActual: () => 'dueno' };
  const member = await a.request('/api/usuarios', 'POST', { nombre: 'Fixture staff', pin: '741', rol: 'empleado' });
  b.receive(a);
  assert.equal((await b.request('/api/usuarios/verificar', 'POST', { pin: '741' })).id, member.id);
  await a.request(`/api/usuarios/${member.id}`, 'PATCH', { pin: '742' });
  b.receive(a);
  await assert.rejects(() => b.request('/api/usuarios/verificar', 'POST', { pin: '741' }));
  assert.equal((await b.request('/api/usuarios/verificar', 'POST', { pin: '742' })).id, member.id);
  await a.request(`/api/usuarios/${member.id}`, 'DELETE', {});
  b.receive(a);
  await assert.rejects(() => b.request('/api/usuarios/verificar', 'POST', { pin: '742' }));
});

test('expense create, edit and cancellation converge without reviving revenue', async () => {
  const a = browser(), b = browser();
  a.OCAuth = { rolActual: () => 'dueno' };
  const g = await a.request('/api/gastos', 'POST', { concepto: 'Fixture expense', monto: 11, categoria: 'services' });
  b.receive(a);
  assert.equal((await b.request('/api/gastos')).total, 11);
  await a.request(`/api/gastos/${g.id}`, 'PATCH', { monto: 13 });
  b.receive(a);
  assert.equal((await b.request('/api/gastos')).total, 13);
  await a.request(`/api/gastos/${g.id}`, 'DELETE', {});
  a.receive(b); b.receive(a);
  assert.equal((await b.request('/api/gastos')).total, 0);
});

test('monthly expenses converge by shelf and retain the later edit', async () => {
  const a = browser(), b = browser();
  const shelf = await a.request('/api/ubicaciones', 'POST', { nombre: 'Fixture monthly shelf' });
  b.receive(a);
  await a.request('/api/configuracion/gastos', 'POST', { ubicacionId: shelf.id, gastosMensuales: 45 });
  b.receive(a);
  assert.equal((await b.request(`/api/configuracion/gastos?ubicacionId=${shelf.id}`)).gastosMensuales, 45);
  await a.request('/api/configuracion/gastos', 'POST', { ubicacionId: shelf.id, gastosMensuales: 0 });
  b.receive(a);
  assert.equal((await b.request(`/api/configuracion/gastos?ubicacionId=${shelf.id}`)).gastosMensuales, 0);
});

test('transfer request and approval converge with stock on both shelves', async () => {
  const a = browser(), b = browser();
  const fixture = await a.request('/api/respaldo/exportar');
  const origin = fixture.productos.find(p => p.stockActual >= 10);
  const destination = { ...origin, id: 'p-transfer-destination', ubicacionId: 'fixture-destination', stockActual: 1 };
  origin.id = 'p-transfer-origin'; origin.ubicacionId = 'fixture-origin'; origin.stockActual = 10;
  fixture.productos = [origin, destination]; fixture.ubicaciones = [
    { id: 'fixture-origin', nombre: 'Origin', activa: true },
    { id: 'fixture-destination', nombre: 'Destination', activa: true }
  ]; fixture.ventas = []; fixture.transferencias = []; fixture.movimientos = [];
  await a.request('/api/respaldo/importar', 'POST', fixture);
  await b.request('/api/respaldo/importar', 'POST', fixture);
  const transfer = await a.request('/api/transferencias', 'POST', { productoOrigenId: origin.id, productoDestinoId: destination.id, cantidad: 2 });
  b.receive(a);
  assert.equal((await b.request('/api/transferencias')).find(x => x.id === transfer.id).estado, 'solicitada');
  await a.request(`/api/transferencias/${transfer.id}/aprobar`, 'POST', {});
  b.receive(a);
  assert.equal((await b.request('/api/transferencias')).find(x => x.id === transfer.id).estado, 'en_transito');
  assert.equal((await b.request('/api/respaldo/exportar')).productos.find(x => x.id === origin.id).stockActual, 8);
  await a.request(`/api/transferencias/${transfer.id}/confirmar-recepcion`, 'POST', {});
  b.receive(a);
  assert.equal((await b.request('/api/transferencias')).find(x => x.id === transfer.id).estado, 'recibida');
  assert.equal((await b.request('/api/respaldo/exportar')).productos.find(x => x.id === destination.id).stockActual, 3);
});

test('deleted customer is not resurrected by an older peer snapshot', async () => {
  const a = browser(), b = browser();
  const c = await a.request('/api/clientes', 'POST', { nombre: 'Fixture removed' });
  b.receive(a);
  await a.request(`/api/clientes/${c.id}`, 'DELETE', {});
  a.receive(b);
  assert.equal((await a.request('/api/clientes')).some(x => x.id === c.id), false);
});

test('product edit and deletion converge without reviving an old copy', async () => {
  const a = browser(), b = browser();
  const p = await a.request('/api/productos', 'POST', { nombre: 'Fixture item', barcode: 'fixture-1', precio: 4, umbralRojo: 1, umbralAmarillo: 3 });
  b.receive(a);
  await a.request(`/api/productos/${p.id}`, 'PATCH', { nombre: 'Renamed fixture', precio: 7, proveedor: 'Fixture maker' });
  b.receive(a);
  assert.equal((await b.request('/api/productos')).find(x => x.id === p.id).precio, 7);
  a.receive(b);
  await a.request(`/api/productos/${p.id}`, 'DELETE', {});
  a.receive(b); b.receive(a);
  for (const peer of [a, b]) {
    assert.equal((await peer.request('/api/productos')).some(x => x.id === p.id), false);
    assert.equal(peer.catalog().productos.find(x => x.id === p.id).borrado, true);
  }
});

test('shelf edit and cascading deletion do not resurrect shelf or product', async () => {
  const a = browser(), b = browser();
  const u = await a.request('/api/ubicaciones', 'POST', { nombre: 'Fixture shelf' });
  const p = await a.request('/api/productos', 'POST', { nombre: 'Fixture shelf item', barcode: 'fixture-2', ubicacionId: u.id, umbralRojo: 1, umbralAmarillo: 3 });
  b.receive(a);
  await a.request(`/api/ubicaciones/${u.id}`, 'PUT', { nombre: 'Renamed shelf', metaMensual: 11 });
  b.receive(a);
  assert.equal((await b.request('/api/ubicaciones')).find(x => x.id === u.id).nombre, 'Renamed shelf');
  await a.request(`/api/ubicaciones/${u.id}`, 'DELETE', {});
  a.receive(b); b.receive(a);
  for (const peer of [a, b]) {
    assert.equal((await peer.request('/api/ubicaciones?todas=1')).some(x => x.id === u.id), false);
    assert.equal((await peer.request('/api/productos')).some(x => x.id === p.id), false);
  }
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
