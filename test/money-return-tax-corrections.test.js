const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { browser } = require('./helpers/browser.cjs');
const readModel = require('../docs/core/business-read-model.js');
const ledger = require('../docs/core/ledger.js');

async function setup({ commission = false, tax = null } = {}) {
  const app = browser();
  app.OCAuth = { rolActual: () => 'dueno' };
  const rack = await app.request('/api/ubicaciones', 'POST', {
    nombre: 'Synthetic return rack', tipo: commission ? 'socio' : 'propio', comisionSocio: 80
  });
  if (tax) await app.request('/api/config/impuesto', 'PUT', { activo: true, tasa: 15, nombre: 'VAT', modo: tax });
  const product = await app.request('/api/productos', 'POST', {
    nombre: 'Synthetic return item', barcode: 'SYNTHETIC-RETURN', precio: tax ? 115 : 100,
    costo: 20, stockInicial: 5, ubicacionId: rack.id
  });
  const { ventaId } = await app.request('/api/productos/' + product.id + '/venta', 'POST', { cantidad: 1 });
  return { app, product, rack, ventaId };
}
const backup = app => app.request('/api/respaldo/exportar');
const getSale = async s => (await backup(s.app)).ventas.find(v => v.id === s.ventaId);
const returnSale = s => s.app.request('/api/ventas/' + s.ventaId + '/devolucion', 'POST', { motivo: 'Synthetic return' });

for (const commission of [false, true]) {
  test('failed ' + (commission ? 'paid commission' : 'ordinary') + ' return restores all state; durable retry survives reload once', async () => {
    const s = await setup({ commission });
    if (commission) await s.app.request('/api/liquidaciones/' + s.rack.id + '/marcar-pagado', 'POST', {});
    const before = await backup(s.app);
    let stockEvents = 0, catalogEvents = 0;
    s.app.OCSyncEmit = () => { stockEvents++; };
    s.app.addEventListener('oc-catalogo-cambiado', () => { catalogEvents++; });
    const save = s.app.localStorage.setItem.bind(s.app.localStorage);
    s.app.localStorage.setItem = () => { throw Error('Synthetic quota'); };
    s.app.OCEstadoIDB = { guardar: async () => false };
    await assert.rejects(() => returnSale(s), /507/);
    const after = await backup(s.app);
    for (const field of ['ventas', 'productos', 'ajustesComision', 'payouts', 'movimientos']) {
      assert.deepEqual(after[field], before[field], field + ' remains unchanged');
    }
    assert.equal(stockEvents, 0); assert.equal(catalogEvents, 0);
    s.app.localStorage.setItem = save; delete s.app.OCEstadoIDB;
    const result = await returnSale(s);
    assert.equal(result.producto.stockActual, 5);
    assert.equal(stockEvents, 1);
    const reloaded = browser(s.app.localStorage); reloaded.OCAuth = { rolActual: () => 'dueno' };
    const persisted = await backup(reloaded);
    assert.equal(persisted.ventas.find(v => v.id === s.ventaId).devuelta, true);
    assert.equal(persisted.ajustesComision.filter(a => a.ventaId === s.ventaId).length, 1);
    const p = persisted.productos.find(p => p.id === s.product.id);
    assert.equal(p.stockActual, 5);
    assert.equal(p.stockBase + Object.values(p.stockPN).reduce((sum, c) => sum + c.add - c.sub, 0), 5);
    await assert.rejects(() => returnSale({ ...s, app: reloaded }), /already/);
    await assert.rejects(() => reloaded.request('/api/ventas/' + s.ventaId + '/cancelar', 'POST', {}), /409/);
    await assert.rejects(() => reloaded.request('/api/ventas/' + s.ventaId + '/anular', 'POST', {}), /409/);
    await assert.rejects(() => reloaded.request('/api/ventas/' + s.ventaId, 'PATCH', { precioUnit: 10 }), /409/);
    assert.equal((await backup(reloaded)).productos.find(p => p.id === s.product.id).stockActual, 5);
  });
}

test('a return waits for IndexedDB confirmation before publishing any stock or catalog event', async () => {
  const s = await setup();
  let finish, events = 0, settled = false;
  s.app.localStorage.setItem = () => { throw Error('Synthetic quota'); };
  s.app.OCEstadoIDB = { guardar: () => new Promise(resolve => { finish = resolve; }) };
  s.app.OCSyncEmit = () => { events++; };
  s.app.addEventListener('oc-catalogo-cambiado', () => { events++; });
  const pending = returnSale(s).then(r => { settled = true; return r; });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(settled, false); assert.equal(events, 0);
  finish(true);
  assert.equal((await pending).ok, true); assert.ok(events > 0);
});

test('ordinary cross-month return preserves original revenue, cost and frozen tax, reversing each in return month', async () => {
  const s = await setup({ tax: 'incluido' });
  const previous = new Date(); previous.setUTCDate(1); previous.setUTCMonth(previous.getUTCMonth() - 1);
  const month = previous.toISOString().slice(0, 7), current = new Date().toISOString().slice(0, 7);
  const b = await backup(s.app); b.ventas.find(v => v.id === s.ventaId).fecha = month + '-10T15:00:00Z';
  await s.app.request('/api/respaldo/importar', 'POST', b);
  await returnSale(s);
  const sale = await getSale(s);
  assert.ok(!sale.anulada); assert.equal(sale.impuesto.monto, 15);
  const original = readModel.monthly([sale], [], month);
  const returned = readModel.monthly([sale], [], current);
  assert.equal(original.netCents, 10000); assert.equal(original.costCents, 2000);
  assert.equal(returned.netCents, -10000); assert.equal(returned.costCents, -2000);
});

test('two offline returns of one unpaid sale converge to one reversal and one restored stock unit', async () => {
  const s = await setup({ commission: true }), other = browser(); other.OCAuth = { rolActual: () => 'dueno' };
  other.receive(s.app);
  await Promise.all([returnSale(s), returnSale({ ...s, app: other })]);
  for (let i = 0; i < 3; i++) { s.app.receive(other); other.receive(s.app); }
  for (const app of [s.app, other]) {
    const b = await backup(app);
    assert.equal(b.ajustesComision.filter(a => a.ventaId === s.ventaId).length, 1);
    assert.equal(b.productos.find(p => p.id === s.product.id).stockActual, 5);
    const settlement = (await app.request('/api/liquidaciones')).find(r => r.ubicacionId === s.rack.id);
    assert.equal(settlement.stillDue, 0); assert.equal(settlement.comisionSocio, 0);
    const journal = ledger.buildLedger({ ventas: b.ventas.filter(v => v.id === s.ventaId), ajustes: b.ajustesComision.filter(a => a.ventaId === s.ventaId), payouts: [], ubicaciones: b.ubicaciones });
    assert.ok(Object.values(journal.balances.byPerson).every(amount => amount === 0), 'no double negative adjustment');
  }
});

for (const mode of ['incluido', 'agregado', null]) {
  test('sale corrections preserve frozen ' + (mode || 'exempt') + ' tax policy after current tax changes', async () => {
    const s = await setup({ tax: mode });
    await s.app.request('/api/config/impuesto', 'PUT', { activo: true, tasa: 20, nombre: 'New tax', modo: mode === 'incluido' ? 'agregado' : 'incluido' });
    await s.app.request('/api/ventas/' + s.ventaId, 'PATCH', { precioUnit: 230, cantidad: 2 });
    const sale = await getSale(s);
    if (!mode) assert.equal(sale.impuesto, null);
    else {
      assert.equal(sale.impuesto.tasa, 15); assert.equal(sale.impuesto.modo, mode);
      assert.equal(sale.impuesto.monto, mode === 'incluido' ? 60 : 69);
    }
    const before = await getSale(s);
    s.app.localStorage.setItem = () => { throw Error('Synthetic quota'); };
    s.app.OCEstadoIDB = { guardar: async () => false };
    await assert.rejects(() => s.app.request('/api/ventas/' + s.ventaId, 'PATCH', { precioUnit: 115 }), /503/);
    assert.deepEqual(await getSale(s), before, 'failed correction also restores frozen tax');
  });
}

test('returned fiado removes only sale-linked debt and preserves actual customer payments', async () => {
  const s = await setup(), facts = [];
  s.app.AMG = { Hechos: { todos: async () => facts.slice(), verificarCadenas: async () => ({ ok: true }), registrar: async (tipo, datos) => {
    const fact = { id: 'synthetic-return-credit-' + facts.length, tipo, datos: JSON.parse(JSON.stringify(datos)), ts: Date.now() + facts.length };
    facts.push(fact); return fact;
  } } };
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../docs/cartera.js'), 'utf8'), s.app);
  const customer = await s.app.request('/api/clientes', 'POST', { nombre: 'Synthetic return customer' });
  await s.app.request('/api/ventas/' + s.ventaId, 'PATCH', { clienteId: customer.id, info: { formaPago: 'fiado' } });
  await s.app.AMG.Cartera.registrarMovimiento(customer.id, 'abono', 30, 'Synthetic payment');
  const balance = () => s.app.request('/api/clientes/' + customer.id + '/cartera');
  assert.equal((await balance()).saldo, -70);
  const receipts = JSON.stringify(facts);
  await returnSale(s);
  assert.equal((await balance()).saldo, 30);
  assert.equal(JSON.stringify(facts), receipts, 'immutable payment and charge receipts remain intact');
});

test('incoming money evidence survives a return rollback while IndexedDB is pending', async () => {
  const s = await setup(), other = browser(); other.OCAuth = { rolActual: () => 'dueno' }; other.receive(s.app);
  const expense = await other.request('/api/gastos', 'POST', { concepto: 'Synthetic concurrent expense', monto: 12 });
  let finish;
  s.app.localStorage.setItem = () => { throw Error('Synthetic quota'); };
  s.app.OCEstadoIDB = { guardar: () => new Promise(resolve => { finish = resolve; }) };
  const pending = returnSale(s);
  await new Promise(resolve => setImmediate(resolve));
  s.app.receive(other);
  finish(false);
  await assert.rejects(() => pending, /507/);
  const b = await backup(s.app);
  assert.ok(!b.ventas.find(v => v.id === s.ventaId).devuelta);
  assert.ok(b.gastos.some(g => g.id === expense.id), 'queued remote evidence is applied after rollback');
});

test('return date and returned flag survive a later catalog revision and a new device import', async () => {
  const s = await setup();
  const stale = s.app.catalog();
  await returnSale(s);
  const original = await getSale(s);
  const sale = stale.ventas.find(v => v.id === s.ventaId);
  sale.rev = { ...original.rev, c: original.rev.c + 1000 };
  sale.devuelta = false; sale.fechaDevolucion = null; sale.devolucionId = null;
  s.app.OCSync.aplicarCatalogo(stale, null);
  const after = await getSale(s);
  assert.equal(after.devuelta, true); assert.equal(after.fechaDevolucion, original.fechaDevolucion);
  const other = browser(); other.receive(s.app);
  const imported = (await backup(other)).ventas.find(v => v.id === s.ventaId);
  assert.equal(imported.fechaDevolucion, original.fechaDevolucion);
  assert.equal(imported.devuelta, true);
});
