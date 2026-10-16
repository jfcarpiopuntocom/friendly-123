const { test } = require('node:test');
const assert = require('node:assert/strict');
const { browser } = require('./helpers/browser.cjs');
const readModel = require('../docs/core/business-read-model.js');

async function creditFixture() {
  const app = browser();
  app.OCAuth = { rolActual: () => 'dueno' };
  const alice = await app.request('/api/promotoras', 'POST', { nombre: 'Synthetic Alice', comisionBase: 40 });
  const bob = await app.request('/api/promotoras', 'POST', { nombre: 'Synthetic Bob', comisionBase: 40 });
  const rack = await app.request('/api/ubicaciones', 'POST', { nombre: 'Synthetic credits', tipo: 'socio' });
  await app.request('/api/ubicaciones/' + rack.id, 'PUT', { promotoraId: alice.id });
  const product = await app.request('/api/productos', 'POST', { nombre: 'Synthetic item', barcode: 'CREDIT-SYNC', precio: 100, costo: 20, stockInicial: 10, ubicacionId: rack.id });
  const first = await app.request('/api/productos/' + product.id + '/venta', 'POST', { cantidad: 1 });
  await app.request('/api/liquidaciones/' + rack.id + '/marcar-pagado', 'POST', { payeeId: alice.id, opId: 'synthetic-original' });
  await app.request('/api/ventas/' + first.ventaId + '/devolucion', 'POST', { motivo: 'Synthetic return' });
  const second = await app.request('/api/productos/' + product.id + '/venta', 'POST', { cantidad: 1 });
  const backup = await app.request('/api/respaldo/exportar');
  backup.ventas.find(v => v.id === first.ventaId).fecha = '2026-08-10T15:00:00Z';
  backup.ventas.find(v => v.id === first.ventaId).fechaDevolucion = '2026-09-10T15:00:00Z';
  backup.ajustesComision.find(a => a.ventaId === first.ventaId).fecha = '2026-09-10T15:00:00Z';
  backup.ventas.find(v => v.id === second.ventaId).fecha = '2026-10-10T15:00:00Z';
  backup.payouts.find(p => p.opId === 'synthetic-original').period = '2026-08';
  await app.request('/api/respaldo/importar', 'POST', backup);
  return { app, alice, bob, rack, product, first, second };
}

const due = async s => (await s.app.request('/api/liquidaciones?mes=2026-10')).find(r => r.ubicacionId === s.rack.id);
const pay = (s, extra = {}) => s.app.request('/api/payouts', 'POST', { ubicacionId: s.rack.id, mes: '2026-10', payeeId: s.alice.id, opId: 'synthetic-next', ...extra });

test('prior-month return credit offsets this month without moving monthly earnings or paying cash', async () => {
  const s = await creditFixture();
  const row = await due(s);
  assert.equal(row.comisionSocio, 40, 'October earned commission remains October only');
  assert.equal(row.stillDue, 0, 'September -40 offsets October +40');
  const before = await s.app.request('/api/respaldo/exportar');
  await assert.rejects(() => pay(s), /409/);
  await assert.rejects(() => pay(s, { sourceIds: [s.second.ventaId], amountCents: 4000 }), /409/);
  assert.deepEqual((await s.app.request('/api/respaldo/exportar')).payouts, before.payouts);
});

test('carried credit follows original beneficiary, is applied once, and payment survives retry and reload', async () => {
  const s = await creditFixture();
  await s.app.request('/api/ubicaciones/' + s.rack.id, 'PUT', { promotoraId: s.bob.id });
  const backup = await s.app.request('/api/respaldo/exportar');
  backup.ventas.find(v => v.id === s.first.ventaId).promotoraId = s.alice.id;
  const next = backup.ventas.find(v => v.id === s.second.ventaId);
  next.promotoraId = s.alice.id; next.cantidad = 2;
  next.split.montoBruto = 200; next.split.montoComisionSocio = 80; next.split.montoNetoDueno = 120;
  await s.app.request('/api/respaldo/importar', 'POST', backup);
  assert.equal((await due(s)).stillDue, 40);
  const result = await pay(s, { sourceIds: [s.second.ventaId], amountCents: 4000 });
  assert.equal(result.payout.amountCents, 4000);
  assert.ok(result.payout.items.some(it => it.kind === 'adjustment' && it.offset && it.amountCents === 4000));
  assert.equal((await due(s)).stillDue, 0);
  assert.equal((await pay(s, { sourceIds: [s.second.ventaId], amountCents: 4000 })).payout.id, result.payout.id);
  const reloaded = browser(s.app.localStorage); reloaded.OCAuth = { rolActual: () => 'dueno' };
  assert.equal((await due({ ...s, app: reloaded })).stillDue, 0);
});

for (const cost of [null, undefined, '', 'invalid', 0, 20]) {
  test('sync preserves unknown cost without inventing profit: ' + String(cost), async () => {
    const s = await creditFixture();
    const catalog = s.app.catalog();
    const sale = catalog.ventas.find(v => v.id === s.second.ventaId);
    if (cost === undefined) delete sale.costoUnit;
    else sale.costoUnit = cost;
    const recipient = browser(); recipient.OCAuth = { rolActual: () => 'dueno' };
    recipient.OCSync.aplicarCatalogo(catalog, null);
    const received = recipient.catalog().ventas.find(v => v.id === sale.id);
    const known = cost === 0 || cost === 20;
    assert.equal(received.costoUnit, known ? cost : null);
    assert.equal(readModel.businessResult({ sales: [received] }).houseAfterExpensesCents, known ? (60 - cost) * 100 : null);
    const again = browser(); again.OCSync.aplicarCatalogo(recipient.catalog(), null);
    assert.equal(again.catalog().ventas.find(v => v.id === sale.id).costoUnit, known ? cost : null);
  });
}

test('historical credits neither cross beneficiaries nor apply before their date', async () => {
  const s = await creditFixture();
  const backup = await s.app.request('/api/respaldo/exportar');
  backup.ventas.find(v => v.id === s.first.ventaId).promotoraId = s.alice.id;
  backup.ventas.find(v => v.id === s.second.ventaId).promotoraId = s.bob.id;
  await s.app.request('/api/respaldo/importar', 'POST', backup);
  const row = await due(s);
  assert.equal(row.payoutBalances.find(r => r.payeeId === s.alice.id).due, -40);
  assert.equal(row.payoutBalances.find(r => r.payeeId === s.bob.id).due, 40);
  const result = await pay(s, { payeeId: s.bob.id, amountCents: 4000 });
  assert.equal(result.payout.amount, 40);
  assert.ok(result.payout.items.every(it => !it.offset));
  const future = await creditFixture();
  const futureBackup = await future.app.request('/api/respaldo/exportar');
  futureBackup.ajustesComision.find(a => a.ventaId === future.first.ventaId).fecha = '2026-11-10T15:00:00Z';
  await future.app.request('/api/respaldo/importar', 'POST', futureBackup);
  assert.equal((await due(future)).stillDue, 40);
});

test('a prior adjustment follows the frozen associate-pays direction', async () => {
  const s = await creditFixture();
  const backup = await s.app.request('/api/respaldo/exportar');
  backup.ventas.find(v => v.id === s.first.ventaId).direccionComision = 'asociadoPaga';
  await s.app.request('/api/respaldo/importar', 'POST', backup);
  assert.equal((await due(s)).stillDue, 40, 'an associate-collected sale creates no house credit');
  assert.equal((await pay(s)).payout.amount, 40);
});

test('failed durable payout preserves carried credit and all receipt history', async () => {
  const s = await creditFixture();
  const backup = await s.app.request('/api/respaldo/exportar');
  const sale = backup.ventas.find(v => v.id === s.second.ventaId);
  sale.cantidad = 2; sale.split.montoBruto = 200; sale.split.montoComisionSocio = 80; sale.split.montoNetoDueno = 120;
  await s.app.request('/api/respaldo/importar', 'POST', backup);
  const before = await s.app.request('/api/respaldo/exportar');
  s.app.localStorage.setItem = () => { throw new Error('Synthetic full disk'); };
  s.app.OCEstadoIDB = { guardar: async () => false };
  await assert.rejects(() => pay(s), /507/);
  const after = await s.app.request('/api/respaldo/exportar');
  for (const field of ['payouts', 'ventas', 'ajustesComision']) assert.deepEqual(after[field], before[field]);
  assert.equal((await due(s)).stillDue, 40);
});
