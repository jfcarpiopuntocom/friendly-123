'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { browser } = require('./helpers/browser.cjs');
const RM = require('../docs/core/business-read-model.js');
const Period = require('../docs/core/report-period.js');

test('calendar quarters and years cover exact boundaries including leap February', () => {
  assert.deepEqual(Period.range('2024-02', 'monthly'), { from: '2024-02-01', to: '2024-02-29' });
  assert.deepEqual(Period.range('2026-10', 'quarterly'), { from: '2026-10-01', to: '2026-12-31' });
  assert.deepEqual(Period.range('2026-07', 'yearly'), { from: '2026-01-01', to: '2026-12-31' });
  assert.equal(Period.range('2026-13', 'monthly'), null);
});

test('receipt reference and payment method survive reload and a second device, never photo bytes in money', async () => {
  const w = browser(); w.OCAuth = { rolActual: () => 'dueno' };
  const input = { concepto: 'Synthetic receipt', monto: 12, categoria: 'services', fecha: '2026-10-16', metodoPago: 'transfer', facturaFotoHash: 'a'.repeat(64), ubicacionId: 'workshop', eventKey: 'dia:painting|2026-10-16' };
  const saved = await w.request('/api/gastos', 'POST', input);
  assert.ok(saved.id);
  const peer = browser(); peer.receive(w);
  for (const app of [w, browser(w.localStorage), peer]) {
    const expense = (await app.request('/api/gastos')).gastos.find(g => g.id === saved.id);
    assert.equal(expense.metodoPago, 'transfer'); assert.equal(expense.facturaFotoHash, input.facturaFotoHash);
    assert.equal(expense.eventKey, input.eventKey); assert.equal(expense.ubicacionId, 'workshop');
    assert.doesNotMatch(JSON.stringify(expense), /data:image/);
  }
  const before = (await w.request('/api/gastos')).gastos.length;
  await assert.rejects(w.request('/api/gastos', 'POST', { ...input, metodoPago: 'invented' }), /Invalid expense payment method/);
  await assert.rejects(w.request('/api/gastos', 'POST', { ...input, facturaFotoHash: 'javascript:alert(1)' }), /Invalid receipt photo/);
  assert.equal((await w.request('/api/gastos')).gastos.length, before);
});

test('period profit reconciles artist share once and same-name events keep separate receipt expenses', () => {
  const sales = ['2026-10-16', '2026-10-23'].map((date, i) => ({ id: 's' + i, fecha: date, eventoNombre: 'Painting', eventoFecha: date, ubicacionId: 'workshop', cantidad: 1, precioUnit: 100, costoUnit: 10, comisionAsociado: 40, netoCasa: 60 }));
  const expenses = [{ id: 'g', fecha: '2026-10-16', monto: 15, categoria: 'services', ubicacionId: 'workshop', eventKey: 'dia:painting|2026-10-16' }];
  const input = { sales, expenses, period: Period.range('2026-10', 'quarterly') };
  assert.equal(RM.businessResult(input).houseAfterExpensesCents, 8500);
  assert.equal(RM.businessResult({ ...input, scope: { eventKey: 'dia:painting|2026-10-16' } }).houseAfterExpensesCents, 3500);
  assert.equal(RM.businessResult({ ...input, scope: { eventKey: 'dia:painting|2026-10-23' } }).houseAfterExpensesCents, 5000);
  expenses.push({ id: 'general', fecha: '2026-10-16', monto: 20, categoria: 'rent' });
  assert.equal(RM.businessResult({ ...input, scope: { locationId: 'workshop' } }).houseAfterExpensesCents, null);
  assert.equal(RM.businessResult(input).houseAfterExpensesCents, 6500);
});
