/* JFC decisions of 2026-10-07 (money report points 5, 7 and 9).
   Each test fails on the pre-change code (backup in backups/2026-10-07_20-09_anulada-retencion/).
   5. A sale voided AFTER its commission was paid (two devices crossing over sync) lost that
      money from the payout ledger. JFC: "descontar del proximo pago".
   7. Hold before paying commissions. JFC: give the owner the choice without breaking anything.
      Off by default; 7/14/30 days; held money is never shown as paid and cannot be paid yet.
   9. Commissions buttons fit on one line on a phone. JFC: shorter texts. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { browser } = require('./helpers/browser.cjs');
const L = require('../docs/core/payout-ledger.js');

async function store(app) {
  app.OCAuth = { rolActual: () => 'dueno' };
  const alice = await app.request('/api/promotoras', 'POST', { nombre:'Hold Alice', comisionBase:40 });
  const rack = await app.request('/api/ubicaciones', 'POST', { nombre:'Hold Rack', tipo:'socio' });
  await app.request(`/api/ubicaciones/${rack.id}`, 'PUT', { promotoraId:alice.id });
  const product = await app.request('/api/productos', 'POST', { nombre:'Hold Vase', sku:'HOLD-VASE', barcode:'HOLD-VASE', precio:100, costo:20, stockInicial:10, ubicacionId:rack.id });
  return { alice, rack, product };
}
async function intenta(fn) { try { return { ok:await fn() }; } catch (err) { return { err }; } }
const liqDe = async (app, rackId) => (await app.request('/api/liquidaciones')).find(x => x.ubicacionId === rackId);

/* ---------- 5. voided after payment ---------- */
const venta = (id, fecha, extra) => Object.assign({ id, fecha, ubicacionId:'r1', split:{ montoComisionSocio:40 } }, extra || {});
const loc = [{ id:'r1', promotoraId:'alice' }];
const pago = { id:'p1', opId:'o1', status:'paid', payeeId:'alice', amountCents:4000, items:[{ kind:'sale', sourceId:'v1', payeeId:'alice', amountCents:4000 }] };

test('core: a sale voided after being paid becomes a credit that the next payment consumes', () => {
  const sales = [venta('v1', '2026-10-01T10:00:00Z', { anulada:true }), venta('v2', '2026-10-02T10:00:00Z', { split:{ montoComisionSocio:60 } })];
  const obs = L.buildObligations({ sales, adjustments:[], locations:loc, payouts:[pago] });
  const v = obs.find(o => o.kind === 'void');
  assert.ok(v, 'the paid-then-voided sale must produce a void credit');
  assert.equal(v.dueCents, -4000);
  const row = L.balancesByPayee({ sales, adjustments:[], locations:loc, payouts:[pago] })[0];
  assert.equal(row.dueCents, 2000, '60 earned on v2 minus the 40 already paid for the voided v1');
  const plan = L.planPayout({ sales, adjustments:[], locations:loc, payouts:[pago], payeeId:'alice', opId:'o2', id:'p2', amountCents:2000 });
  assert.ok(!plan.error, JSON.stringify(plan));
  assert.ok(plan.payout.items.some(it => it.kind === 'void' && it.offset && it.amountCents === 4000));
  const after = L.balancesByPayee({ sales, adjustments:[], locations:loc, payouts:[pago, plan.payout] })[0];
  assert.equal(after.dueCents, 0, 'after that payment nothing is due and the credit is used up');
});

test('core: an unpaid voided sale still produces nothing (unchanged)', () => {
  const sales = [venta('v1', '2026-10-01T10:00:00Z', { anulada:true })];
  assert.deepEqual(L.buildObligations({ sales, adjustments:[], locations:loc, payouts:[] }), []);
});

test('app: a paid sale voided by another device is discounted from the next payment', async () => {
  const app = browser(); const s = await store(app);
  await app.request(`/api/productos/${s.product.id}/venta`, 'POST', { cantidad:1 });
  await app.request(`/api/liquidaciones/${s.rack.id}/marcar-pagado`, 'POST', { payeeId:s.alice.id, medioPago:'efectivo', opId:'void-pay-1' });
  // Another device voided the sale before it saw the payment; the notebooks converge.
  const respaldo = await app.request('/api/respaldo/exportar');
  respaldo.ventas.forEach(v => { if (v.ubicacionId === s.rack.id) { v.anulada = true; v.canceladaExPostEn = new Date().toISOString(); } });
  await app.request('/api/respaldo/importar', 'POST', respaldo);
  await app.request(`/api/productos/${s.product.id}/venta`, 'POST', { cantidad:2 });
  const liq = await liqDe(app, s.rack.id);
  assert.equal(liq.stillDue, 40, '80 earned on the new sale minus the 40 paid for the voided one');
  const pay = await app.request(`/api/liquidaciones/${s.rack.id}/marcar-pagado`, 'POST', { payeeId:s.alice.id, medioPago:'efectivo', opId:'void-pay-2' });
  assert.equal(pay.amount !== undefined ? pay.amount : pay.payout.amount, 40);
  assert.equal((await liqDe(app, s.rack.id)).stillDue, 0);
  // The backup with a void item must still restore.
  const r2 = await app.request('/api/respaldo/exportar');
  const imp = await intenta(() => app.request('/api/respaldo/importar', 'POST', r2));
  assert.ok(!imp.err, 'a backup that contains a void credit must restore');
});

/* ---------- 7. hold before paying ---------- */
test('core: with a hold, a recent sale is held (not due, not paid) until its date', () => {
  const sales = [venta('v1', '2026-10-01T10:00:00Z')];
  const base = { sales, adjustments:[], locations:loc, payouts:[], holdDays:7 };
  const held = L.balancesByPayee({ ...base, asOf:'2026-10-03T10:00:00Z' })[0];
  assert.equal(held.dueCents, 0);
  assert.equal(held.heldCents, 4000);
  assert.equal(held.heldUntil, '2026-10-08T10:00:00.000Z');
  assert.equal(L.planPayout({ ...base, asOf:'2026-10-03T10:00:00Z', payeeId:'alice', opId:'x' }).status, 409, 'held money cannot be paid');
  const free = L.balancesByPayee({ ...base, asOf:'2026-10-09T10:00:00Z' })[0];
  assert.equal(free.dueCents, 4000);
  assert.equal(free.heldCents, 0);
  const off = L.balancesByPayee({ ...base, holdDays:0, asOf:'2026-10-03T10:00:00Z' })[0];
  assert.equal(off.dueCents, 4000, 'hold off = exactly as before');
});

test('app: hold is off by default, the owner chooses 7/14/30, held money is not paid and not shown as paid', async () => {
  const app = browser(); const s = await store(app);
  const def = await app.request('/api/config/retencion');
  assert.equal(def.dias, 0);
  const bad = await intenta(() => app.request('/api/config/retencion', 'PUT', { dias:5 }));
  assert.ok(bad.err, 'only the offered choices are accepted');
  await app.request('/api/config/retencion', 'PUT', { dias:7 });
  await app.request(`/api/productos/${s.product.id}/venta`, 'POST', { cantidad:1 });
  const liq = await liqDe(app, s.rack.id);
  assert.equal(liq.stillDue, 0);
  assert.notEqual(liq.paymentStatus, 'paid', 'held money must never read as paid');
  const fila = liq.payoutBalances.find(p => p.payeeId === s.alice.id);
  assert.equal(fila.held, 40);
  assert.ok(fila.heldUntil);
  const pay = await intenta(() => app.request(`/api/liquidaciones/${s.rack.id}/marcar-pagado`, 'POST', { payeeId:s.alice.id, amountCents:1000, medioPago:'efectivo', opId:'held-1' }));
  assert.ok(pay.err, 'a held sale cannot be paid yet');
  await app.request('/api/config/retencion', 'PUT', { dias:0 });
  assert.equal((await liqDe(app, s.rack.id)).stillDue, 40, 'turning it off makes it payable again');
  // The choice survives a backup round trip.
  await app.request('/api/config/retencion', 'PUT', { dias:14 });
  const r = await app.request('/api/respaldo/exportar');
  assert.equal(r.configuracion.retencion.dias, 14);
});

test('app: only the owner or an admin can change the hold', async () => {
  const app = browser(); await store(app);
  app.OCAuth = { rolActual: () => 'empleado' };
  const r = await intenta(() => app.request('/api/config/retencion', 'PUT', { dias:7 }));
  assert.ok(r.err);
});

/* ---------- 9. short button texts ---------- */
test('Commissions buttons use short texts (one line on a phone), full text kept for screen readers', () => {
  const i18n = fs.readFileSync(path.join(__dirname, '../docs/i18n.js'), 'utf8');
  assert.match(i18n, /"comm\.viewProduct": "By product"/);
  assert.match(i18n, /"comm\.viewRack": "By rack"/);
  assert.match(i18n, /"comm\.viewProduct": "Por producto"/);
  assert.match(i18n, /"comm\.viewRack": "Por percha"/);
  assert.match(i18n, /"comm\.sendWhatsappDailyShort": "WhatsApp"/);
  assert.match(i18n, /"comm\.sendWhatsappDailyShort": "WhatsApp"/);
  const html = fs.readFileSync(path.join(__dirname, '../docs/index.html'), 'utf8');
  assert.match(html, /aria-label="Export CSV"[^>]*>⤓ CSV<\/button>/);
});
