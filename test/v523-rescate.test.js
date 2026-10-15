const { test } = require('node:test');
const assert = require('node:assert/strict');
const ledger = require('../docs/core/payout-ledger.js');
const { browser } = require('./helpers/browser.cjs');
const cartera = require('../docs/cartera.js').AMG.Cartera;

// All cases are synthetic. No customer data, production license, or network.
const locations = [{ id: 'shelf-fixture', promotoraId: 'associate-fixture' }];
const sale = (id, month, direction, extra = {}) => ({
  id, fecha: month + '-15T12:00:00.000Z', ubicacionId: 'shelf-fixture',
  direccionComision: direction, split: { montoComisionSocio: 30, montoNetoDueno: 70 },
  ...extra,
});

test('v523: associate-collected earnings survive in September and October, without house debt', () => {
  for (const month of ['2026-09', '2026-10']) {
    const input = { month, sales: [sale('sale-' + month, month, 'asociadoPaga')],
      locations, payouts: [], adjustments: [] };
    const byPayee = ledger.balancesByPayee(input);
    assert.equal(byPayee.length, 1);
    assert.equal(byPayee[0].earnedCents, 3000);
    assert.equal(byPayee[0].dueCents, 0);
    const fromHouse = ledger.balancesByPayee({ ...input, sales: [sale('house-' + month, month, 'casaPaga')] });
    assert.equal(fromHouse[0].earnedCents, 3000);
    assert.equal(fromHouse[0].dueCents, 3000);
  }
});

test('v523: retroactive adjustments keep history without inventing the house obligation', () => {
  const original = sale('s-retro', '2026-09', 'asociadoPaga');
  const adjustment = { id: 'adj-retro', ventaId: original.id, fecha: '2026-09-23T09:00:00Z',
    ubicacionId: 'shelf-fixture', montoComisionSocio: -5 };
  const rows = ledger.balancesByPayee({ month: '2026-09', sales: [original],
    locations, adjustments: [adjustment], payouts: [] });
  assert.equal(rows[0].earnedCents, 2500);
  assert.equal(rows[0].dueCents, 0);
  assert.equal(rows[0].obligations.length, 2);
});

test('v523: an annulled and restored on-account sale is ONE charge, with or without receipt', () => {
  const base = { clienteId: 'buyer-fixture', fecha: '2026-09-15T10:00:00Z',
    precioUnit: 10, cantidad: 1, info: { fiadoAtomico: true, formaPago: 'fiado' } };
  const original = { ...base, id: 'fiado-old', anulada: true };
  const restored = { ...base, id: 'fiado-new', restauracionDe: 'fiado-old' };
  const noReceipt = cartera.calcularSaldo([], 'buyer-fixture', [original, restored]);
  assert.equal(noReceipt.saldo, -10);
  assert.equal(noReceipt.movimientos.filter(m => m.fiadoAtomico).length, 1);
  const fact = { id: 'fact-fiado', tipo: 'cartera_cargo', ts: 100,
    datos: { clienteId: 'buyer-fixture', monto: 10, ventaId: 'fiado-old', motivo: 'Sale' } };
  const withReceipt = cartera.calcularSaldo([fact], 'buyer-fixture', [original, restored]);
  assert.equal(withReceipt.saldo, -10);
  assert.equal(withReceipt.movimientos.filter(m => m.fiadoAtomico).length, 0);
});

test('v523: an employee cannot reclassify historical commission direction', async () => {
  const app = browser();
  app.OCAuth = { rolActual: () => 'dueno' };
  const rack = await app.request('/api/ubicaciones', 'POST', { nombre: 'Synthetic shelf', tipo: 'socio' });
  const p = await app.request('/api/productos', 'POST', {
    nombre: 'Synthetic product', sku: 'V523-GUARD', barcode: 'V523-GUARD',
    precio: 100, costo: 0, stockInicial: 4, ubicacionId: rack.id
  });
  await app.request('/api/productos/' + p.id + '/venta', 'POST', { cantidad: 1 });
  app.OCAuth = { rolActual: () => 'empleado' };
  await assert.rejects(app.request('/api/productos/' + p.id + '/direccion-comision', 'PATCH',
    { direccion: 'asociadoPaga' }), /owner|administrator|403/i);
  app.OCAuth = { rolActual: () => 'dueno' };
  const after = await app.request('/api/ventas/todas');
  assert.equal(after.find(v => v.productoId === p.id).direccionComision, 'casaPaga');
});

test('v523: retroactive direction and its audit cross the existing encrypted-catalog contract', async () => {
  const source = browser();
  source.OCAuth = { rolActual: () => 'dueno' };
  const rack = await source.request('/api/ubicaciones', 'POST', { nombre: 'Direction sync rack', tipo: 'socio' });
  const p = await source.request('/api/productos', 'POST', {
    nombre: 'Direction sync item', sku: 'SYNC-523', barcode: 'SYNC-523',
    precio: 100, costo: 0, stockInicial: 4, ubicacionId: rack.id
  });
  await source.request('/api/productos/' + p.id + '/venta', 'POST', { cantidad: 1 });
  const changed = await source.request('/api/productos/' + p.id + '/direccion-comision', 'PATCH', {
    direccion: 'asociadoPaga', quien: 'fixture'
  });
  assert.equal(changed.cambiadas, 1);
  const emitted = source.catalog().ventas.find(v => v.productoId === p.id);
  assert.equal(emitted.direccionComision, 'asociadoPaga');
  assert.equal(emitted.direccionCambios.length, 1);
  const target = browser();
  target.OCAuth = { rolActual: () => 'dueno' };
  target.receive(source);
  const received = (await target.request('/api/ventas/todas')).find(v => v.id === emitted.id);
  assert.ok(received, 'the real sale ID is preserved');
  assert.equal(received.direccionComision, 'asociadoPaga');
  assert.equal(received.direccionCambios.length, 1);
});
