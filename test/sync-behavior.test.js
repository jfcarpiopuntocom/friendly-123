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


test('v448 GOLDEN: sync catalog never publishes demo customers or demo sales', () => {
  const a = browser();
  const cat = a.catalog();
  assert.equal(cat.clientes.some(c => c.id === 'c01' && c.codigo === 'C-1001' && c.nombre === 'Ashley Rivera' && c.telefono === '3055550101'), false);
  assert.equal(cat.ventas.some(v => /^vs-/.test(String(v.id || ''))), false);
  assert.equal(cat.ubicaciones.some(u => u.id === 'galeria' && u.nombre === 'Sample Gallery'), false);
  assert.equal(cat.promotoras.some(p => p.id === 'pr01' && p.nombre === 'Consignment Artist (sample)'), false);
  assert.equal(cat.sucursales.some(s => s.id === 'suc01' && s.nombre === 'Gallery'), false);
});

test('v448 GOLDEN: a real store rejects exact demo fingerprints received from sync', async () => {
  const source = browser();
  const dest = browser();
  await dest.request('/api/instancia/activar', 'POST', { instanceId: 'fixture-real-store', vaciar: true });
  dest.receive(source);
  const state = await dest.request('/api/respaldo/exportar');
  assert.equal(state.clientes.some(c => c.id === 'c01' && c.codigo === 'C-1001' && c.nombre === 'Ashley Rivera' && c.telefono === '3055550101'), false);
  assert.equal(state.ventas.some(v => /^vs-/.test(String(v.id || ''))), false);
});

test('v448 GOLDEN: same seed-shaped customer id with a different fingerprint is preserved', async () => {
  const source = browser();
  const dest = browser();
  await dest.request('/api/instancia/activar', 'POST', { instanceId: 'fixture-real-store-2', vaciar: true });
  const cat = source.catalog();
  cat.clientes = [{ id: 'c01', codigo: 'REAL-1', nombre: 'Real Customer', telefono: '0999999999', evaluacion: { trato: 0, confiabilidad: 0, historial: [] } }];
  cat.ventas = [];
  dest.OCSync.aplicarCatalogo(cat, null);
  const state = await dest.request('/api/respaldo/exportar');
  assert.equal(state.clientes.some(c => c.id === 'c01' && c.nombre === 'Real Customer' && c.telefono === '0999999999'), true);
});

test('v448 GOLDEN: restart of an activated non-JFC store NO LONGER purges demo from storage (JFC 2026-10-07 Apagarla, solo filtrar)', async () => {
  const first = browser();
  await first.request('/api/instancia/activar', 'POST', { instanceId: 'idiomarte-fixture', vaciar: false });
  first.localStorage.setItem('f123_owned', JSON.stringify({ instanceId: 'idiomarte-fixture', licenseCode: 'F123-K7M2-FIXTURE' }));
  const restarted = browser(first.localStorage);
  const state = await restarted.request('/api/respaldo/exportar');
  assert.equal(restarted.localStorage.getItem('f123_cuarentena_demo_exacta_v448'), null, 'nothing was quarantined');
  assert.equal(state.clientes.some(c => c.id === 'c01' && c.codigo === 'C-1001' && c.nombre === 'Ashley Rivera' && c.telefono === '3055550101'), true, 'cleanup is DORMANT: the stored record stays');
  assert.equal(state.ventas.some(v => /^vs-/.test(String(v.id || ''))), true, 'cleanup is DORMANT: the stored record stays');
  assert.equal(state.productos.some(p => p.id === 'p23' && p.nombre === 'Cappuccino' && p.sku === 'BAR-CAP-023'), true, 'cleanup is DORMANT: the stored record stays');
  assert.equal(state.ubicaciones.some(u => u.id === 'galeria' && u.nombre === 'Sample Gallery'), true, 'cleanup is DORMANT: the stored record stays');
  assert.equal(state.promotoras.some(p => p.id === 'pr01' && p.nombre === 'Consignment Artist (sample)'), true, 'cleanup is DORMANT: the stored record stays');
  assert.equal(state.sucursales.some(s => s.id === 'suc01' && s.nombre === 'Gallery'), true, 'cleanup is DORMANT: the stored record stays');
});

test('v448 GOLDEN: an isolated exact-looking customer is never auto-deleted without corroborating demo evidence', async () => {
  const first = browser();
  const fixture = await first.request('/api/respaldo/exportar');
  fixture.productos = [];
  fixture.ubicaciones = [];
  fixture.ventas = [];
  fixture.movimientos = [];
  fixture.transferencias = [];
  fixture.gastos = [];
  fixture.ajustesComision = [];
  fixture.promotoras = [];
  fixture.sucursales = [];
  fixture.clientes = [{
    id: 'c01', codigo: 'C-1001', nombre: 'Ashley Rivera', telefono: '3055550101',
    evaluacion: { trato: 0, confiabilidad: 0, historial: [] }
  }];
  await first.request('/api/instancia/activar', 'POST', { instanceId: 'fixture-coincidence', vaciar: true });
  await first.request('/api/respaldo/importar', 'POST', fixture);
  first.localStorage.setItem('f123_owned', JSON.stringify({ instanceId: 'fixture-coincidence', licenseCode: 'F123-REAL-FIXTURE' }));
  const restarted = browser(first.localStorage);
  const state = await restarted.request('/api/respaldo/exportar');
  assert.equal(state.clientes.some(c => c.id === 'c01' && c.nombre === 'Ashley Rivera'), true,
    'one coincidental fingerprint alone is insufficient evidence to delete customer data');
});


test('v448 GOLDEN: checkpoint preserves a real product that only reuses a demo-shaped id', async () => {
  const dest = browser();
  await dest.request('/api/instancia/activar', 'POST', { instanceId: 'fixture-checkpoint-real-id', vaciar: true });
  const snap = {
    ubicaciones: [{ id: 'real-shelf', nombre: 'Real shelf', activa: true }],
    productos: [{ id: 'p23', nombre: 'Real handmade mug', sku: 'REAL-MUG-23', barcode: 'REAL-00023', ubicacionId: 'real-shelf', stockActual: 4 }],
    clientes: []
  };
  const r = dest.OCSync.aplicarCheckpoint(snap);
  assert.equal(r.ok, true);
  const state = await dest.request('/api/respaldo/exportar');
  assert.equal(state.productos.some(p => p.id === 'p23' && p.nombre === 'Real handmade mug'), true);
});


test('v448 GOLDEN: catalog sync preserves a real product that only reuses a demo-shaped id', async () => {
  const source = browser();
  const dest = browser();
  const fixture = await source.request('/api/respaldo/exportar');
  const shelf = { ...fixture.ubicaciones[0], id: 'real-shelf-p23', nombre: 'Real shelf p23' };
  const product = { ...fixture.productos[0], id: 'p23', nombre: 'Real handmade mug', sku: 'REAL-MUG-23', barcode: 'REAL-00023', ubicacionId: shelf.id, stockActual: 4 };
  fixture.ubicaciones = [shelf];
  fixture.productos = [product];
  fixture.ventas = []; fixture.movimientos = []; fixture.clientes = [];
  await source.request('/api/instancia/activar', 'POST', { instanceId: 'fixture-source-real-product', vaciar: true });
  await dest.request('/api/instancia/activar', 'POST', { instanceId: 'fixture-dest-real-product', vaciar: true });
  await source.request('/api/respaldo/importar', 'POST', fixture);
  const cat = source.catalog();
  assert.equal(cat.productos.some(p => p.id === 'p23' && p.nombre === 'Real handmade mug'), true, 'outbound catalog must not discard a real pNN id');
  dest.OCSync.aplicarCatalogo(cat, null);
  const received = await dest.request('/api/respaldo/exportar');
  assert.equal(received.productos.some(p => p.id === 'p23' && p.nombre === 'Real handmade mug'), true, 'inbound merge must not discard a real pNN id');
});


test('v448 GOLDEN: JFC and customer licenses use the same exact demo guard; a real pNN survives restart', async () => {
  const first = browser();
  const fixture = await first.request('/api/respaldo/exportar');
  const shelf = { ...fixture.ubicaciones[0], id: 'real-jfc-shelf', nombre: 'Real JFC shelf' };
  const product = { ...fixture.productos[0], id: 'p23', nombre: 'Real JFC product', sku: 'REAL-JFC-23', barcode: 'REAL-JFC-00023', ubicacionId: shelf.id, stockActual: 4 };
  fixture.ubicaciones = [shelf];
  fixture.productos = [product];
  fixture.ventas = []; fixture.movimientos = []; fixture.clientes = [];
  fixture.promotoras = []; fixture.sucursales = [];
  await first.request('/api/instancia/activar', 'POST', { instanceId: 'fixture-jfc-real-product', vaciar: true });
  await first.request('/api/respaldo/importar', 'POST', fixture);
  first.localStorage.setItem('f123_owned', JSON.stringify({ instanceId: 'fixture-jfc-real-product', licenseCode: 'F123-A6YK-6V1J-FIXTURE' }));
  const restarted = browser(first.localStorage);
  const state = await restarted.request('/api/respaldo/exportar');
  assert.equal(state.productos.some(p => p.id === 'p23' && p.nombre === 'Real JFC product'), true,
    'JFC must not receive broader destructive cleanup than customers');
});


test('v448 GOLDEN: real activity protects an exact-looking demo product/customer (cleanup is dormant since 2026-10-07; sync filtering unchanged)', async () => {
  const first = browser();
  const fixture = await first.request('/api/respaldo/exportar');
  const demoSale = fixture.ventas.find(v => v.productoId === 'p23' && v.clienteId === 'c01');
  assert.ok(demoSale, 'fixture needs the Cappuccino/Ashley demo pair');
  fixture.ventas.push({ ...demoSale, id: 'v-real-protect-demo-shaped', fecha: new Date().toISOString(), rev: null });
  await first.request('/api/instancia/activar', 'POST', { instanceId: 'fixture-protected-real-activity', vaciar: true });
  await first.request('/api/respaldo/importar', 'POST', fixture);
  first.localStorage.setItem('f123_owned', JSON.stringify({ instanceId: 'fixture-protected-real-activity', licenseCode: 'F123-REAL-PROTECTED' }));
  const restarted = browser(first.localStorage);
  const state = await restarted.request('/api/respaldo/exportar');
  assert.equal(state.productos.some(p => p.id === 'p23' && p.nombre === 'Cappuccino'), true, 'real sale protects its product');
  assert.equal(state.clientes.some(c => c.id === 'c01' && c.nombre === 'Ashley Rivera'), true, 'real sale protects its customer');
  assert.equal(state.ventas.some(v => v.id === 'v-real-protect-demo-shaped'), true, 'real sale is never removed');
  assert.equal(state.ventas.some(v => /^vs-/.test(String(v.id || ''))), true, 'demo sales stay in storage: the startup cleanup is DORMANT (JFC 2026-10-07 Apagarla, solo filtrar)');
  const cat = restarted.catalog();
  assert.equal(cat.productos.some(p => p.id === 'p23' && p.nombre === 'Cappuccino'), true, 'protected product must still sync');
  assert.equal(cat.clientes.some(c => c.id === 'c01' && c.nombre === 'Ashley Rivera'), true, 'protected customer must still sync');
});


test('v448 GOLDEN golden14: idiomARTE test products stay in storage (startup cleanup DORMANT, JFC 2026-10-07 Apagarla, solo filtrar)', async () => {
  const first = browser();
  const fixture = await first.request('/api/respaldo/exportar');
  const shelf = fixture.ubicaciones[0];
  const baseProduct = fixture.productos[0];
  const baseSale = fixture.ventas[0];
  const p1 = { ...baseProduct, id: 'p-idiomarte-test-candy', nombre: 'Butter dish workshop - Candy S.', sku: 'TEST-CANDY', barcode: 'TEST-CANDY-1', ubicacionId: shelf.id };
  const p2 = { ...baseProduct, id: 'p-idiomarte-test-leslie', nombre: 'Mural mentoring (Leslie)', sku: 'TEST-LESLIE', barcode: 'TEST-LESLIE-1', ubicacionId: shelf.id };
  fixture.productos = [p1, p2];
  fixture.ventas = [
    { ...baseSale, id: 'v-idiomarte-test-candy', productoId: p1.id, ubicacionId: shelf.id },
    { ...baseSale, id: 'v-idiomarte-test-leslie', productoId: p2.id, ubicacionId: shelf.id }
  ];
  fixture.movimientos = []; fixture.transferencias = []; fixture.gastos = []; fixture.ajustesComision = [];
  fixture.clientes = []; fixture.promotoras = []; fixture.sucursales = [];
  await first.request('/api/instancia/activar', 'POST', { instanceId: 'idiomarte-golden14', vaciar: true });
  await first.request('/api/respaldo/importar', 'POST', fixture);
  first.localStorage.setItem('f123_owned', JSON.stringify({ instanceId: 'idiomarte-golden14', licenseCode: 'F123-K7M2-TEST-GOLDEN14' }));
  const restarted = browser(first.localStorage);
  const state = await restarted.request('/api/respaldo/exportar');
  assert.equal(state.productos.some(p => p.nombre === 'Butter dish workshop - Candy S.'), true);
  assert.equal(state.productos.some(p => p.nombre === 'Mural mentoring (Leslie)'), true);
  assert.equal(state.ventas.some(v => v.id === 'v-idiomarte-test-candy' || v.id === 'v-idiomarte-test-leslie'), true);
  assert.equal(restarted.localStorage.getItem('f123_cuarentena_demo_exacta_v448'), null, 'the dormant cleanup opens no quarantine');
});

test('v448 GOLDEN golden14: the same names are preserved outside idiomARTE', async () => {
  const first = browser();
  const fixture = await first.request('/api/respaldo/exportar');
  const shelf = fixture.ubicaciones[0];
  const baseProduct = fixture.productos[0];
  const named = { ...baseProduct, id: 'p-other-store-candy', nombre: 'Butter dish workshop - Candy S.', sku: 'REAL-CANDY', barcode: 'REAL-CANDY-1', ubicacionId: shelf.id };
  fixture.productos = [named];
  fixture.ventas = []; fixture.movimientos = []; fixture.transferencias = []; fixture.gastos = []; fixture.ajustesComision = [];
  fixture.clientes = []; fixture.promotoras = []; fixture.sucursales = [];
  await first.request('/api/instancia/activar', 'POST', { instanceId: 'other-store-golden14', vaciar: true });
  await first.request('/api/respaldo/importar', 'POST', fixture);
  first.localStorage.setItem('f123_owned', JSON.stringify({ instanceId: 'other-store-golden14', licenseCode: 'F123-OTHER-GOLDEN14' }));
  const restarted = browser(first.localStorage);
  const state = await restarted.request('/api/respaldo/exportar');
  assert.equal(state.productos.some(p => p.nombre === 'Butter dish workshop - Candy S.'), true);
});
