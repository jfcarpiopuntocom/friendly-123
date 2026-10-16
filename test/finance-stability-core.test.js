'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const RM = require('../docs/core/business-read-model.js');
const Finance = require('../docs/core/finance-report.js');
const sale = (extra = {}) => ({ id: 'sale', fecha: '2026-09-10', ubicacionId: 'shelf-a', ubicacionNombre: 'Shelf A', eventoId: 'event-a', eventoNombre: 'Workshop A', cantidad: 1, precioUnit: 100, costoUnit: 10, comisionAsociado: 40, netoCasa: 60, ...extra });
const adjustment = (extra = {}) => ({ id: 'adjustment', ventaId: 'sale', fecha: '2026-10-10', tipo: 'ajuste-manual', montoComisionSocio: 5, montoNetoDueno: -5, ...extra });

test('a period with only a commission adjustment retains its shelf and event breakdown', () => {
  const input = { sales: [sale()], adjustments: [adjustment()], month: '2026-10' };
  for (const events of [false, true]) {
    const rows = Finance.build(input, events);
    assert.equal(rows.length, 2);
    assert.equal(rows[0].result.houseAfterExpensesCents, -500);
    assert.equal(rows[1].result.houseAfterExpensesCents, -500);
    assert.deepEqual(rows[1].result.sourceIds.adjustments, ['adjustment']);
  }
});

test('a conflicting sale remains visible as a pending shelf instead of disappearing', () => {
  const first = sale({ fecha: '2026-10-10' });
  const rows = Finance.build({ sales: [first, { ...first, precioUnit: 110, netoCasa: 70 }], month: '2026-10' }, false);
  assert.equal(rows.length, 2);
  assert.equal(rows[1].name, 'Shelf A');
  assert.equal(rows[1].result.houseAfterExpensesCents, null);
  assert.ok(rows[1].result.warnings.includes('conflicting-sale'));
});

test('expense conflicts in another shelf or event do not erase an unrelated verified result', () => {
  const expense = { id: 'expense', fecha: '2026-10-10', ubicacionId: 'shelf-b', eventoId: 'event-b', monto: 5 };
  const input = { sales: [sale({ fecha: '2026-10-10' })], expenses: [expense, { ...expense, monto: 6 }], month: '2026-10' };
  assert.equal(RM.businessResult(input).houseAfterExpensesCents, null);
  for (const scope of [{ locationId: 'shelf-a' }, { eventKey: 'id:event-a' }]) {
    const result = RM.businessResult({ ...input, scope });
    assert.equal(result.houseAfterExpensesCents, 5000);
    assert.ok(!result.warnings.includes('conflicting-expense'));
  }
  const general = { ...expense, ubicacionId: 'todas', eventoId: null };
  assert.equal(RM.businessResult({ ...input, expenses: [general, { ...general, monto: 6 }], scope: { locationId: 'shelf-a' } }).houseAfterExpensesCents, null);
});

test('adjustment conflicts on another sale do not erase an unrelated shelf or event', () => {
  const other = sale({ id: 'other', ubicacionId: 'shelf-b', eventoId: 'event-b' });
  const first = adjustment({ ventaId: 'other' });
  const input = { sales: [sale({ fecha: '2026-10-10' }), other], adjustments: [first, { ...first, montoComisionSocio: 6, montoNetoDueno: -6 }], month: '2026-10' };
  assert.equal(RM.businessResult(input).houseAfterExpensesCents, null);
  for (const scope of [{ locationId: 'shelf-a' }, { eventKey: 'id:event-a' }]) {
    const result = RM.businessResult({ ...input, scope });
    assert.equal(result.houseAfterExpensesCents, 5000);
    assert.ok(!result.warnings.includes('conflicting-adjustment'));
  }
});

test('conflicts that move an expense or adjustment into a scope still block that scope in either order', () => {
  const sales = [sale({ fecha: '2026-10-10' }), sale({ id: 'other', ubicacionId: 'shelf-b', eventoId: 'event-b' })];
  const first = { id: 'expense', fecha: '2026-10-10', ubicacionId: 'shelf-a', eventoId: 'event-a', monto: 5 };
  const other = { ...first, ubicacionId: 'shelf-b', eventoId: 'event-b' };
  const corrections = [adjustment(), adjustment({ ventaId: 'other' })];
  for (const scope of [{ locationId: 'shelf-a' }, { eventKey: 'id:event-a' }]) {
    for (const expenses of [[first, other], [other, first]]) {
      assert.equal(RM.businessResult({ sales, expenses, month: '2026-10', scope }).houseAfterExpensesCents, null);
    }
    for (const adjustments of [corrections, [...corrections].reverse()]) {
      assert.equal(RM.businessResult({ sales, adjustments, month: '2026-10', scope }).houseAfterExpensesCents, null);
    }
  }
});
