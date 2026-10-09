/* Fixation tests: they pin current correct behavior (v468); they are not proof of a bug fix.
   Purpose: commission payouts move real money, and several helper functions had no test that
   names them. Each test title names the function(s) it pins. Money is asserted in exact cents.
   payoutAppliedMap, hasLedgerFact, payoutLines and entriesForPayout are private to their modules,
   so they are pinned through the public functions that call them (buildObligations,
   balancesByPayee, planPayout, buildLedger). The _xxx backend helpers are reached through the
   app API, like test/payout-idempotencia-2026-10-07.test.js does. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { browser } = require('./helpers/browser.cjs');
const L = require('../docs/core/payout-ledger.js');
const G = require('../docs/core/ledger.js');

/* ---------- pure-core fixtures ---------- */
const loc = [{ id:'r1', promotoraId:'alice' }];
const venta = (id, fecha, cents, extra) => Object.assign({ id, fecha, ubicacionId:'r1', split:{ montoComisionSocio:cents / 100 } }, extra || {});
const item = (sourceId, amountCents, extra) => Object.assign({ kind:'sale', sourceId, payeeId:'alice', amountCents }, extra || {});
const pagado = (id, opId, items, extra) => Object.assign({ id, opId, status:'paid', payeeId:'alice',
  amountCents:items.reduce((a, i) => a + i.amountCents, 0), locationId:'r1', items }, extra || {});
const reversa = (id, opId, of, items) => ({ id, opId, status:'paid', reversalOf:of, payeeId:'alice', amountCents:items.reduce((a, i) => a + i.amountCents, 0), locationId:'r1', items });
const obsDe = (sales, payouts, extra) => L.buildObligations(Object.assign({ sales, adjustments:[], locations:loc, payouts }, extra || {}));

/* ===== payoutAppliedMap (through buildObligations / balancesByPayee) ===== */
test('payoutAppliedMap: two partial payouts on the same sale add up in paidCents', () => {
  const s = [venta('v1', '2026-10-01T10:00:00Z', 4000)];
  const p = [pagado('p1', 'o1', [item('v1', 1000)]), pagado('p2', 'o2', [item('v1', 1500)])];
  const o = obsDe(s, p)[0];
  assert.equal(o.paidCents, 2500);
  assert.equal(o.dueCents, 1500);
});

test('payoutAppliedMap: voided/reversed-status payouts are not counted as applied', () => {
  const s = [venta('v1', '2026-10-01T10:00:00Z', 4000)];
  const p = [pagado('p1', 'o1', [item('v1', 4000)], { status:'voided' }), pagado('p2', 'o2', [item('v1', 500)], { status:'reversed' })];
  const o = obsDe(s, p)[0];
  assert.equal(o.paidCents, 0);
  assert.equal(o.dueCents, 4000);
});

test('payoutAppliedMap: an append-only reversal restores exactly the amount it lists', () => {
  const s = [venta('v1', '2026-10-01T10:00:00Z', 4000)];
  const pay = pagado('p1', 'o1', [item('v1', 4000)]);
  const rev = reversa('r1', 'o2', 'p1', [item('v1', 1500)]);
  const o = obsDe(s, [pay, rev])[0];
  assert.equal(o.paidCents, 2500);
  assert.equal(o.dueCents, 1500);
});

test('payoutAppliedMap: the result does not depend on the order payouts arrive (sync order)', () => {
  const s = [venta('v1', '2026-10-01T10:00:00Z', 4000)];
  const pay = pagado('p1', 'o1', [item('v1', 4000)]);
  const rev = reversa('r1', 'o2', 'p1', [item('v1', 4000)]);
  assert.equal(obsDe(s, [pay, rev])[0].dueCents, 4000);
  assert.equal(obsDe(s, [rev, pay])[0].dueCents, 4000);
});

test('payoutAppliedMap: an over-reversal is clamped at 0 paid (never a negative balance), and ledgerAnomalies flags it', () => {
  const s = [venta('v1', '2026-10-01T10:00:00Z', 4000)];
  const pay = pagado('p1', 'o1', [item('v1', 1000)]);
  const r1 = reversa('r1', 'o2', 'p1', [item('v1', 1000)]);
  const r2 = reversa('r2', 'o3', 'p1', [item('v1', 1000)]);
  const o = obsDe(s, [pay, r1, r2])[0];
  assert.equal(o.paidCents, 0);
  assert.equal(o.dueCents, 4000, 'due never exceeds what was earned');
  const an = L.ledgerAnomalies([pay, r1, r2]);
  assert.equal(an.length, 1);
  assert.equal(an[0].paidCents, 1000);
  assert.equal(an[0].reversedCents, 2000);
});

test('payoutAppliedMap: actual paid cents and the excess remain visible (JFC 2026-10-08)', () => {
  const s = [venta('v1', '2026-10-01T10:00:00Z', 1000)];
  const o = obsDe(s, [pagado('p1', 'o1', [item('v1', 5000)])])[0];
  assert.equal(o.paidCents, 5000);
  assert.equal(o.dueCents, -4000);
  assert.equal(o.overpaidCents, 4000);
});

/* ===== hasLedgerFact (through the legacyPaid rule of buildObligations) ===== */
test('hasLedgerFact: a legacy liquidada sale with no ledger fact counts as fully paid', () => {
  const s = [venta('v1', '2026-10-01T10:00:00Z', 4000, { liquidada:true })];
  const o = obsDe(s, [])[0];
  assert.equal(o.paidCents, 4000);
  assert.equal(o.dueCents, 0);
});

test('hasLedgerFact: once a paid ledger fact names the sale, the legacy flag stops counting (no double count)', () => {
  const s = [venta('v1', '2026-10-01T10:00:00Z', 4000, { liquidada:true })];
  const o = obsDe(s, [pagado('p1', 'o1', [item('v1', 1000)])])[0];
  assert.equal(o.paidCents, 1000, 'only the ledger amount counts, not 4000 + 1000');
  assert.equal(o.dueCents, 3000);
});

test('hasLedgerFact: a voided payout is not a ledger fact, so the legacy flag still applies; a fact for another payee does not replace it', () => {
  const s = [venta('v1', '2026-10-01T10:00:00Z', 4000, { liquidada:true })];
  assert.equal(obsDe(s, [pagado('p1', 'o1', [item('v1', 4000)], { status:'voided' })])[0].paidCents, 4000);
  assert.equal(obsDe(s, [pagado('p2', 'o2', [item('v1', 100, { payeeId:'bob' })], { payeeId:'bob' })])[0].paidCents, 4000);
});

/* ===== payoutStatus ===== */
test('payoutStatus: paid, voided and reversed are valid; anything else is invalid', () => {
  assert.equal(L.payoutStatus({ status:'paid' }), 'paid');
  assert.equal(L.payoutStatus({ status:'voided' }), 'voided');
  assert.equal(L.payoutStatus({ status:'reversed' }), 'reversed');
  assert.equal(L.payoutStatus({ status:'pending' }), 'invalid');
  assert.equal(L.payoutStatus({}), 'invalid');
  assert.equal(L.payoutStatus(null), 'invalid');
  assert.equal(L.payoutStatus(undefined), 'invalid');
});

/* ===== ledger.js: payoutLines / entriesForPayout (through buildLedger) ===== */
const pagoLibro = (extra) => Object.assign({ id:'pay1', opId:'op1', status:'paid', payeeId:'alice', locationId:'r1', amountCents:2500, paidAt:'2026-10-05T10:00:00Z', items:[] }, extra || {});
const entradasPago = (payouts) => G.buildLedger({ ventas:[], ajustes:[], ubicaciones:[], payouts, gastos:[], cartera:[] });
const suma = (e, campo) => e.lines.reduce((a, l) => a + l[campo], 0);

test('payoutLines/entriesForPayout: a paid payout debits 2000 and credits 1000 for the exact cents and balances', () => {
  const r = entradasPago([pagoLibro()]);
  assert.deepEqual(r.errors, []);
  assert.equal(r.entries.length, 1);
  const e = r.entries[0];
  assert.equal(e.id, 'pago:pay1');
  assert.equal(suma(e, 'debitCents'), 2500);
  assert.equal(suma(e, 'creditCents'), 2500);
  const l2000 = e.lines.find(l => l.account === '2000'), l1000 = e.lines.find(l => l.account === '1000');
  assert.equal(l2000.debitCents, 2500);
  assert.equal(l2000.personId, 'alice');
  assert.equal(l1000.creditCents, 2500);
  assert.equal(l1000.locationId, 'r1');
});

test('payoutLines/entriesForPayout: a reversal payout posts the inverse lines', () => {
  const r = entradasPago([pagoLibro({ id:'rev1', opId:'op2', reversalOf:'pay1' })]);
  const e = r.entries[0];
  assert.equal(e.lines.find(l => l.account === '2000').creditCents, 2500);
  assert.equal(e.lines.find(l => l.account === '1000').debitCents, 2500);
});

test('payoutLines/entriesForPayout: a voided payout posts the payment and its inverse (net 0)', () => {
  const r = entradasPago([pagoLibro({ status:'voided', voidedAt:'2026-10-06T10:00:00Z' })]);
  assert.equal(r.entries.length, 2);
  const net = r.entries.reduce((a, e) => a + e.lines.filter(l => l.account === '1000').reduce((s, l) => s + l.debitCents - l.creditCents, 0), 0);
  assert.equal(net, 0);
  assert.deepEqual(r.entries.map(e => e.id).sort(), ['pago:pay1', 'pago:pay1:rev']);
});

test('entriesForPayout: zero amounts and unknown statuses are reported as errors, not posted', () => {
  const r = entradasPago([pagoLibro({ id:'z', opId:'oz', amountCents:0 }), pagoLibro({ id:'u', opId:'ou', status:'pending' })]);
  assert.equal(r.entries.length, 0);
  assert.equal(r.errors.length, 2);
  assert.ok(r.errors.every(e => e.factKind === 'pago'));
});

test('payoutLines: a payout without payee still posts balanced lines for the exact cents', () => {
  const r = entradasPago([pagoLibro({ payeeId:null })]);
  assert.equal(r.entries.length, 1);
  assert.equal(r.entries[0].lines.find(x => x.account === '2000').debitCents, 2500);
  assert.equal(suma(r.entries[0], 'debitCents'), suma(r.entries[0], 'creditCents'));
});

/* ===== backend helpers through the API ===== */
async function store(app, extra) {
  app.OCAuth = { rolActual: () => 'dueno' };
  const alice = await app.request('/api/promotoras', 'POST', { nombre:'Fij Alice', comisionBase:40 });
  const bob = await app.request('/api/promotoras', 'POST', { nombre:'Fij Bob', comisionBase:40 });
  const rack = await app.request('/api/ubicaciones', 'POST', { nombre:'Fij Rack', tipo:(extra && extra.tipo) || 'socio' });
  await app.request(`/api/ubicaciones/${rack.id}`, 'PUT', { promotoraId:alice.id });
  const product = await app.request('/api/productos', 'POST', { nombre:'Fij Vase', sku:'FIJ-VASE', barcode:'FIJ-VASE', precio:100, costo:20, stockInicial:20, ubicacionId:rack.id });
  return { alice, bob, rack, product };
}
async function intenta(fn) { try { return { ok:await fn() }; } catch (err) { return { err }; } }
const vender = (app, s, body) => app.request(`/api/productos/${s.product.id}/venta`, 'POST', Object.assign({ cantidad:1 }, body || {}));
const liqDe = async (app, rackId, mes) => (await app.request('/api/liquidaciones' + (mes ? `?mes=${mes}` : ''))).find(x => x.ubicacionId === rackId);
const pagarUrl = (s) => `/api/liquidaciones/${s.rack.id}/marcar-pagado`;
const pagosDe = (app, s) => app.request(`/api/payouts?ubicacionId=${s.rack.id}`);

test('_registrarPayout/getLiquidaciones: a normal full payment records 4000 cents and leaves stillDue 0', async () => {
  const app = browser(); const s = await store(app);
  await vender(app, s);
  assert.equal((await liqDe(app, s.rack.id)).stillDue, 40);
  const r = await app.request(pagarUrl(s), 'POST', { payeeId:s.alice.id, medioPago:'efectivo', opId:'fij-full' });
  assert.equal(r.amount, 40);
  const pagos = await pagosDe(app, s);
  assert.equal(pagos.length, 1);
  assert.equal(pagos[0].amountCents, 4000);
  assert.equal(pagos[0].items.reduce((a, i) => a + i.amountCents, 0), 4000);
  const liq = await liqDe(app, s.rack.id);
  assert.equal(liq.stillDue, 0);
  assert.equal(liq.paymentStatus, 'paid');
});

test('_registrarPayout: a partial payment leaves the exact remainder and status partially-paid; overpaying is refused', async () => {
  const app = browser(); const s = await store(app);
  await vender(app, s);
  await app.request(pagarUrl(s), 'POST', { payeeId:s.alice.id, amountCents:1500, medioPago:'efectivo', opId:'fij-part' });
  const liq = await liqDe(app, s.rack.id);
  assert.equal(liq.stillDue, 25);
  assert.equal(liq.paymentStatus, 'partially-paid');
  const over = await intenta(() => app.request(pagarUrl(s), 'POST', { payeeId:s.alice.id, amountCents:2501, medioPago:'efectivo', opId:'fij-over' }));
  assert.ok(over.err, 'paying more than the remaining 2500 cents must fail');
  assert.equal((await pagosDe(app, s)).length, 1);
  assert.equal((await liqDe(app, s.rack.id)).stillDue, 25);
});

test('_payoutMismaPeticion/_registrarPayout: exact retry with same opId returns the same payment, nothing new is written', async () => {
  const app = browser(); const s = await store(app);
  await vender(app, s);
  const a = await app.request(pagarUrl(s), 'POST', { payeeId:s.alice.id, amountCents:1000, medioPago:'efectivo', opId:'fij-retry' });
  const b = await app.request(pagarUrl(s), 'POST', { payeeId:s.alice.id, amountCents:1000, medioPago:'efectivo', opId:'fij-retry' });
  assert.equal(b.existing, true);
  assert.equal(b.payoutId, a.payoutId);
  assert.equal((await pagosDe(app, s)).length, 1);
  assert.equal((await liqDe(app, s.rack.id)).stillDue, 30);
});

test('_payoutMismaPeticion: same key with another amount, another payee or another month is refused with nothing written', async () => {
  const app = browser(); const s = await store(app);
  await vender(app, s);
  await app.request(pagarUrl(s), 'POST', { payeeId:s.alice.id, amountCents:1000, medioPago:'efectivo', opId:'fij-key' });
  const monto = await intenta(() => app.request(pagarUrl(s), 'POST', { payeeId:s.alice.id, amountCents:1001, medioPago:'efectivo', opId:'fij-key' }));
  const otra = await intenta(() => app.request(pagarUrl(s), 'POST', { payeeId:s.bob.id, amountCents:1000, medioPago:'efectivo', opId:'fij-key' }));
  const mes = await intenta(() => app.request(pagarUrl(s) + '?mes=2020-01', 'POST', { payeeId:s.alice.id, amountCents:1000, medioPago:'efectivo', opId:'fij-key' }));
  assert.ok(monto.err && otra.err && mes.err);
  assert.equal((await pagosDe(app, s)).length, 1);
  assert.equal((await liqDe(app, s.rack.id)).stillDue, 30);
});

test('_registrarPayout: a reversal returns exactly what was paid, can be retried, and cannot be repeated for more', async () => {
  const app = browser(); const s = await store(app);
  await vender(app, s);
  await app.request(pagarUrl(s), 'POST', { payeeId:s.alice.id, amountCents:1500, medioPago:'efectivo', opId:'fij-rev' });
  const pago = (await pagosDe(app, s))[0];
  const sinMotivo = await intenta(() => app.request(`/api/payouts/${pago.id}/reverse`, 'POST', {}));
  assert.ok(sinMotivo.err, 'a reason is required');
  const rev = await app.request(`/api/payouts/${pago.id}/reverse`, 'POST', { reason:'wrong person' });
  assert.equal(rev.reversal.amountCents, 1500);
  assert.equal((await liqDe(app, s.rack.id)).stillDue, 40, 'back to the full 4000 cents');
  const otra = await app.request(`/api/payouts/${pago.id}/reverse`, 'POST', { reason:'again' });
  assert.equal(otra.existing, true);
  const todos = await pagosDe(app, s);
  assert.equal(todos.length, 2);
  assert.equal(L.ledgerAnomalies(todos).length, 0, 'reversed never exceeds paid');
  assert.equal((await liqDe(app, s.rack.id)).stillDue, 40);
});

test('_registrarPayoutLegacyRack: rack-wide payment without payee pays each person separately with exact cents', async () => {
  const app = browser(); const s = await store(app);
  await vender(app, s);
  await vender(app, s, { modoComision:'associate', promotoraId:s.bob.id });
  const r = await app.request(pagarUrl(s), 'POST', { medioPago:'efectivo', opId:'fij-rack' });
  assert.equal(r.payoutIds.length, 2);
  const pagos = await pagosDe(app, s);
  assert.deepEqual(pagos.map(p => p.amountCents).sort(), [4000, 4000]);
  assert.deepEqual(pagos.map(p => p.opId).sort(), [`fij-rack:${s.alice.id}`, `fij-rack:${s.bob.id}`].sort());
  assert.equal((await liqDe(app, s.rack.id)).stillDue, 0);
  await app.request(pagarUrl(s), 'POST', { medioPago:'efectivo', opId:'fij-rack' });
  assert.equal((await pagosDe(app, s)).length, 2, 'exact retry of the rack-wide call writes nothing new');
});

test('_registrarPayoutLegacyRack: an amount without payee when two people are owed is refused and writes nothing', async () => {
  const app = browser(); const s = await store(app);
  await vender(app, s);
  await vender(app, s, { modoComision:'associate', promotoraId:s.bob.id });
  const r = await intenta(() => app.request(pagarUrl(s), 'POST', { amountCents:1000, medioPago:'efectivo', opId:'fij-amb' }));
  assert.ok(r.err);
  assert.equal((await pagosDe(app, s)).length, 0);
  assert.equal((await liqDe(app, s.rack.id)).stillDue, 80);
});

test('_registrarPayoutLegacyRack: multi-person is all-or-nothing when a derived key is already taken', async () => {
  const app = browser(); const s = await store(app);
  await vender(app, s);
  await vender(app, s, { modoComision:'associate', promotoraId:s.bob.id });
  await app.request(pagarUrl(s), 'POST', { payeeId:s.alice.id, amountCents:100, medioPago:'efectivo', opId:`fij-aon:${s.bob.id}` });
  const r = await intenta(() => app.request(pagarUrl(s), 'POST', { medioPago:'efectivo', opId:'fij-aon' }));
  assert.ok(r.err);
  assert.equal((await pagosDe(app, s)).length, 1, 'only the pre-existing 100 cent payment');
  const liq = await liqDe(app, s.rack.id);
  assert.equal(liq.stillDue, 79, 'Alice 4000-100 + Bob 4000 = 7900 cents');
});

test('_payoutInput/getLiquidaciones: a sale voided after being paid is discounted from the next payout (credit of 4000 cents)', async () => {
  const app = browser(); const s = await store(app);
  await vender(app, s);
  await app.request(pagarUrl(s), 'POST', { payeeId:s.alice.id, medioPago:'efectivo', opId:'fij-void-1' });
  const respaldo = await app.request('/api/respaldo/exportar');
  respaldo.ventas.forEach(v => { if (v.ubicacionId === s.rack.id) { v.anulada = true; v.canceladaExPostEn = new Date().toISOString(); } });
  await app.request('/api/respaldo/importar', 'POST', respaldo);
  await vender(app, s, { cantidad:3 });
  const liq = await liqDe(app, s.rack.id);
  assert.equal(liq.stillDue, 80, '12000 earned minus the 4000 credit');
  const fila = liq.payoutBalances.find(p => p.payeeId === s.alice.id);
  assert.equal(fila.dueCents, 8000);
  const r = await app.request(pagarUrl(s), 'POST', { payeeId:s.alice.id, medioPago:'efectivo', opId:'fij-void-2' });
  assert.equal(r.amount, 80);
  const pagos = await pagosDe(app, s);
  assert.equal(pagos.find(p => p.opId === 'fij-void-2').amountCents, 8000);
  assert.equal((await liqDe(app, s.rack.id)).stillDue, 0);
});

test('_payoutInput/_fuentePayoutLiquidada: with a 14 day hold a fresh sale is held, never payable and never shown as paid', async () => {
  const app = browser(); const s = await store(app);
  await app.request('/api/config/retencion', 'PUT', { dias:14 });
  await vender(app, s);
  const liq = await liqDe(app, s.rack.id);
  assert.equal(liq.stillDue, 0);
  assert.equal(liq.held, 40);
  assert.notEqual(liq.paymentStatus, 'paid');
  assert.equal(liq.payoutBalances.find(p => p.payeeId === s.alice.id).heldCents, 4000);
  const r = await intenta(() => app.request(pagarUrl(s), 'POST', { payeeId:s.alice.id, medioPago:'efectivo', opId:'fij-hold' }));
  assert.ok(r.err);
  assert.equal((await pagosDe(app, s)).length, 0);
  const ventas = (await app.request('/api/respaldo/exportar')).ventas.filter(v => v.ubicacionId === s.rack.id);
  assert.ok(ventas.every(v => !v.liquidada), 'a held sale must not carry the legacy paid flag');
  await app.request('/api/config/retencion', 'PUT', { dias:0 });
  assert.equal((await liqDe(app, s.rack.id)).stillDue, 40);
});

test('_registrarPayout/_fuentePayoutLiquidada: paying everything marks the sale liquidada; reversing reopens it', async () => {
  const app = browser(); const s = await store(app);
  await vender(app, s);
  const marca = async () => (await app.request('/api/respaldo/exportar')).ventas.filter(v => v.ubicacionId === s.rack.id).map(v => !!v.liquidada);
  await app.request(pagarUrl(s), 'POST', { payeeId:s.alice.id, amountCents:1000, medioPago:'efectivo', opId:'fij-flag-1' });
  assert.deepEqual(await marca(), [false], 'a partial payment must not flag the sale as paid');
  await app.request(pagarUrl(s), 'POST', { payeeId:s.alice.id, amountCents:3000, medioPago:'efectivo', opId:'fij-flag-2' });
  assert.deepEqual(await marca(), [true]);
  const pagos = await pagosDe(app, s);
  await app.request(`/api/payouts/${pagos.find(p => p.opId === 'fij-flag-2').id}/reverse`, 'POST', { reason:'test' });
  assert.deepEqual(await marca(), [false]);
  assert.equal((await liqDe(app, s.rack.id)).stillDue, 30);
});

test('_payoutDurable: a refused payment leaves the ledger exactly as it was', async () => {
  const app = browser(); const s = await store(app);
  await vender(app, s);
  await app.request(pagarUrl(s), 'POST', { payeeId:s.alice.id, amountCents:1000, medioPago:'efectivo', opId:'fij-dur' });
  const antes = JSON.stringify(await pagosDe(app, s));
  await intenta(() => app.request(pagarUrl(s), 'POST', { payeeId:s.alice.id, amountCents:99999, medioPago:'efectivo', opId:'fij-dur-bad' }));
  await intenta(() => app.request(pagarUrl(s), 'POST', { payeeId:s.alice.id, amountCents:1000, medioPago:'efectivo', opId:'fij-dur', mes:'2020-01' }));
  assert.equal(JSON.stringify(await pagosDe(app, s)), antes);
  assert.equal((await liqDe(app, s.rack.id)).stillDue, 30);
});

test('getLiquidaciones: stillDue is computed per rack, never mixed between racks', async () => {
  const app = browser(); const s = await store(app);
  const rack2 = await app.request('/api/ubicaciones', 'POST', { nombre:'Fij Rack Two', tipo:'socio' });
  await app.request(`/api/ubicaciones/${rack2.id}`, 'PUT', { promotoraId:s.bob.id });
  const prod2 = await app.request('/api/productos', 'POST', { nombre:'Fij Cup', sku:'FIJ-CUP', barcode:'FIJ-CUP', precio:50, costo:10, stockInicial:10, ubicacionId:rack2.id });
  await vender(app, s);
  await app.request(`/api/productos/${prod2.id}/venta`, 'POST', { cantidad:2 });
  assert.equal((await liqDe(app, s.rack.id)).stillDue, 40);
  assert.equal((await liqDe(app, rack2.id)).stillDue, 40, '2 x 50 at 40% = 4000 cents');
  await app.request(pagarUrl(s), 'POST', { payeeId:s.alice.id, medioPago:'efectivo', opId:'fij-per-rack' });
  assert.equal((await liqDe(app, s.rack.id)).stillDue, 0);
  assert.equal((await liqDe(app, rack2.id)).stillDue, 40, 'the other rack is untouched');
});

const mesPrevio = (mes) => { const [y, m] = mes.split('-').map(Number); return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`; };

test('getLiquidaciones/_conComisionEnMes: an own rack with sales shows only in the month of its sales', async () => {
  const app = browser(); const s = await store(app, { tipo:'propio' });
  await vender(app, s);
  const hoy = await liqDe(app, s.rack.id);
  assert.ok(hoy, 'current month shows the rack');
  assert.equal(await liqDe(app, s.rack.id, mesPrevio(hoy.mes)), undefined, 'a month without activity does not list the own rack');
});

test('getLiquidaciones/_conComisionEnMes: a partner rack always lists, with stillDue 0 and no-sales status in an empty month', async () => {
  const app = browser(); const s = await store(app);
  await vender(app, s);
  const hoy = await liqDe(app, s.rack.id);
  const vacio = await liqDe(app, s.rack.id, mesPrevio(hoy.mes));
  assert.ok(vacio);
  assert.equal(vacio.stillDue, 0);
  assert.equal(vacio.paymentStatus, 'no-sales');
  assert.equal(hoy.stillDue, 40);
});

// _payoutCore is the only bridge from the backend to the payment ledger (window.OCPayoutLedger).
// If that script failed to load, a payment must be refused with nothing written and the debt untouched.
test('_payoutCore: without the payment ledger loaded, single and rack-wide payments are refused and nothing is written', async () => {
  const app = browser(); const s = await store(app);
  await app.request(`/api/productos/${s.product.id}/venta`, 'POST', { cantidad:1 });
  const antes = (await app.request('/api/liquidaciones')).find(x => x.ubicacionId === s.rack.id);
  const ledger = app.OCPayoutLedger;
  app.OCPayoutLedger = null;
  const url = `/api/liquidaciones/${s.rack.id}/marcar-pagado`;
  let single = null, rack = null;
  try { await app.request(url, 'POST', { payeeId:s.alice.id, amountCents:4000, medioPago:'efectivo', opId:'fij-core-1' }); } catch (e) { single = e; }
  try { await app.request(url, 'POST', { medioPago:'efectivo', opId:'fij-core-2' }); } catch (e) { rack = e; }
  app.OCPayoutLedger = ledger;
  assert.ok(single, 'a single-person payment without the ledger must be an error');
  assert.ok(rack, 'a rack-wide payment without the ledger must be an error');
  const pagos = await app.request(`/api/payouts?ubicacionId=${s.rack.id}`);
  assert.equal(pagos.length, 0, 'no payout row was written');
  const despues = (await app.request('/api/liquidaciones')).find(x => x.ubicacionId === s.rack.id);
  assert.equal(despues.stillDue, antes.stillDue, 'the amount still due is exactly what it was');
  assert.equal(despues.stillDue, 40);
});
