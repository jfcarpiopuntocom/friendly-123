/* Regression tests for the 2026-10-07 payout audit.
   Each test fails on the pre-fix code (backup in backups/2026-10-07_payout-audit/)
   and passes on the fixed code. Bugs covered:
   1. cents(1e-7) returned NaN, which leaked into the balance.
   2. A payment with no payee (payeeId null) plus an amount fell into the legacy
      rack loop and charged the same amount to every associate owed money.
   3. A reversal left the sale marked liquidada, so it stayed locked as paid. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { browser } = require('./helpers/browser.cjs');
const L = require('../docs/core/payout-ledger.js');

async function store(app) {
  app.OCAuth = { rolActual: () => 'dueno' };
  const alice = await app.request('/api/promotoras', 'POST', { nombre:'Audit Payee', comisionBase:40 });
  const rack = await app.request('/api/ubicaciones', 'POST', { nombre:'Audit Rack', tipo:'socio' });
  await app.request(`/api/ubicaciones/${rack.id}`, 'PUT', { promotoraId:alice.id });
  const product = await app.request('/api/productos', 'POST', { nombre:'Audit Vase', sku:'AUDIT-VASE', barcode:'AUDIT-VASE', precio:100, costo:20, stockInicial:10, ubicacionId:rack.id });
  return { alice, rack, product };
}

test('cents() keeps tiny and exponent-form values finite (was NaN for 1e-7)', () => {
  assert.equal(L.cents(1e-7), 0);
  assert.equal(L.cents(1.005), 101);
  assert.equal(L.cents(0.1 + 0.2), 30);
  assert.equal(L.cents(10.005), 1001);
  assert.equal(L.cents(-2.5), -250);
  assert.ok(Number.isFinite(L.cents(1e-300)));
});

test('a payment with payeeId null and an amount never charges another associate', async () => {
  const app = browser(); const s = await store(app);
  await app.request(`/api/productos/${s.product.id}/venta`, 'POST', { cantidad:1 });
  let failed = null;
  try {
    await app.request(`/api/liquidaciones/${s.rack.id}/marcar-pagado`, 'POST', {
      payeeId:null, amountCents:1000, medioPago:'efectivo', opId:'audit-no-payee'
    });
  } catch (err) { failed = err; }
  assert.ok(failed, 'a payment with no associate and an amount must be refused');
  const payouts = await app.request(`/api/payouts?ubicacionId=${s.rack.id}`);
  assert.equal(payouts.length, 0, 'nothing may be recorded for Alice');
  const liq = (await app.request('/api/liquidaciones')).find(x => x.ubicacionId === s.rack.id);
  assert.equal(liq.stillDue, 40);
});

test('an explicit payment to the right associate still records exactly the amount', async () => {
  const app = browser(); const s = await store(app);
  await app.request(`/api/productos/${s.product.id}/venta`, 'POST', { cantidad:1 });
  const paid = await app.request(`/api/liquidaciones/${s.rack.id}/marcar-pagado`, 'POST', {
    payeeId:s.alice.id, amountCents:1000, medioPago:'efectivo', opId:'audit-partial-ok'
  });
  assert.equal(paid.amount, 10);
  const liq = (await app.request('/api/liquidaciones')).find(x => x.ubicacionId === s.rack.id);
  assert.equal(liq.stillDue, 30);
});

test('reversing a payment unlocks the sale again (compatibility flag follows the ledger)', async () => {
  const app = browser(); const s = await store(app);
  await app.request(`/api/productos/${s.product.id}/venta`, 'POST', { cantidad:1 });
  const pay = await app.request(`/api/liquidaciones/${s.rack.id}/marcar-pagado`, 'POST', {
    payeeId:s.alice.id, medioPago:'cheque', opId:'audit-pay-then-reverse'
  });
  const saleLocked = (await app.request('/api/ventas/todas')).find(v => v.ubicacionId === s.rack.id);
  assert.equal(saleLocked.liquidada, true, 'sale is paid before the reversal');

  await app.request(`/api/payouts/${pay.payoutId}/reverse`, 'POST', { reason:'Cheque bounced', opId:'audit-rev-1' });
  const saleAfter = (await app.request('/api/ventas/todas')).find(v => v.ubicacionId === s.rack.id);
  assert.ok(!saleAfter.liquidada, 'sale must not stay marked as paid after a reversal');
  const liq = (await app.request('/api/liquidaciones')).find(x => x.ubicacionId === s.rack.id);
  assert.equal(liq.stillDue, 40);
});
