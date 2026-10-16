const { test } = require('node:test');
const assert = require('node:assert/strict');
const R = require('../docs/core/business-read-model.js');
const sale = (extra = {}) => ({
  id: 'sale', fecha: '2026-09-30', cantidad: 1, precioUnit: 115, costoUnit: 40,
  split: { montoComisionSocio: 23, montoNetoDueno: 92 },
  impuesto: { tasa: 15, modo: 'incluido', monto: 15, nombre: 'VAT' }, ...extra,
});
const report = (v, extra = {}) => R.businessResult({ sales: [v], ...extra });

test('included tax is neither revenue nor house profit, without changing the agreed split', () => {
  const v = sale();
  const r = report(v);
  assert.equal(r.customerGrossCents, 11500);
  assert.equal(r.taxCents, 1500);
  assert.equal(r.netCents, 10000);
  assert.equal(r.artistShareCents, 2300);
  assert.equal(r.houseShareCents, 7700);
  assert.equal(r.houseAfterExpensesCents, 3700);
  assert.equal(r.houseShareCents + r.artistShareCents + r.taxCents, r.customerGrossCents);
  assert.equal(R.monthly([v], [], '2026-09').marginCents, 6000);
  assert.equal(R.monthly([v], [], '2026-09').rows[0].amountCents, 10000);
  assert.equal(R.daily([v], '2026-09-30').gananciaHoy, 60);
});

test('added tax increases the customer charge while preserving revenue and house allocation', () => {
  const r = report(sale({ precioUnit: 100, split: { montoComisionSocio: 20, montoNetoDueno: 80 }, impuesto: { tasa: 15, modo: 'agregado', monto: 15 } }));
  assert.equal(r.customerGrossCents, 11500);
  assert.equal(r.taxCents, 1500);
  assert.equal(r.netCents, 10000);
  assert.equal(r.houseShareCents, 8000);
  assert.equal(r.houseAfterExpensesCents, 4000);
});

test('a later refund reverses revenue, included tax and cost once in its own month', () => {
  const v = sale({ devuelta: true, fechaDevolucion: '2026-10-01' });
  const adjustments = [{ id: 'refund', ventaId: 'sale', tipo: 'devolucion', fecha: '2026-10-01', montoComisionSocio: -23, montoNetoDueno: -92 }];
  const original = report(v, { month: '2026-09', adjustments });
  const refund = report(v, { month: '2026-10', adjustments });
  assert.equal(original.houseAfterExpensesCents, 3700);
  assert.equal(refund.houseAfterExpensesCents, -3700);
  assert.equal(refund.customerGrossCents, -11500);
  assert.equal(refund.taxCents, -1500);
  assert.equal(refund.netCents, -10000);
  assert.equal(refund.costCents, -4000);
  assert.equal(report(v, { adjustments }).houseAfterExpensesCents, 0);
});

test('null and legacy absent tax preserve the original untaxed amounts', () => {
  for (const impuesto of [null, undefined]) {
    const r = report(sale({ impuesto }));
    assert.equal(r.taxCents, 0);
    assert.equal(r.netCents, 11500);
    assert.equal(r.houseShareCents, 9200);
  }
});

test('an invalid frozen tax does not invent a complete profit', () => {
  for (const impuesto of [{ monto: 15 }, { modo: 'incluido', monto: -1 }, { modo: 'incluido', monto: 116 }, { modo: 'agregado', monto: null }]) {
    const r = report(sale({ impuesto }));
    assert.equal(r.netCents, null);
    assert.equal(r.houseAfterExpensesCents, null);
    assert.ok(r.warnings.includes('invalid-tax'));
  }
});

test('explicit no-commission evidence permits own-stock profit while missing splits stay pending', () => {
  const v = sale({ split: null, noCommission: true });
  assert.equal(report(v).artistShareCents, 0);
  assert.equal(report(v).houseAfterExpensesCents, 6000);
  assert.equal(report({ ...v, noCommission: undefined }).houseAfterExpensesCents, null);
  assert.equal(report({ ...v, noCommission: undefined, ubicacionTipo: 'propio' }).houseAfterExpensesCents, null, 'current location type cannot establish the original agreement');
  assert.equal(report({ ...v, comisionistaIdProducto: 'person', pctAsociadoProducto: 20 }).houseAfterExpensesCents, 6000, 'today product settings cannot erase frozen no-commission evidence');
  assert.equal(report(sale({ noCommission: true })).artistShareCents, 2300, 'a stored split is not erased');
});

test('tax edits use frozen rate/mode, preserve metadata, and distinguish invalid from tax-free', () => {
  const frozen = { tasa: 15, modo: 'incluido', nombre: 'VAT', monto: 15 };
  assert.deepEqual(R.recalculateTax(frozen, 230, 2), { ...frozen, monto: 60 });
  assert.equal(frozen.monto, 15);
  assert.equal(R.recalculateTax({ ...frozen, modo: 'agregado' }, 100, 2).monto, 30);
  assert.equal(R.recalculateTax(null, 200, 2), null);
  assert.equal(R.recalculateTax(undefined, 200, 2), null);
  assert.equal(R.recalculateTax({ monto: 15 }, 200, 2), undefined);
  assert.equal(R.recalculateTax(frozen, 200, 0), undefined);
  assert.equal(R.recalculateTax(frozen, 0, 2).monto, 0);
});
