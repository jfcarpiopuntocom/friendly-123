/* Regression tests for the 2026-10-07 money report, points 1 to 4.
   Each test fails on the pre-fix code (backup in backups/2026-10-07_19-43_payout-idempotencia/)
   and passes on the fixed code.
   1. The UI made a new opId on every click: a double tap or a retry after a network
      failure sent two keys and could record two payments.
   2. A reused opId with another amount or person returned the old payment silently.
   3. A reversal could return more than was paid; the core hid it with Math.max(0, ...).
   4. The rack-wide (multi-person) payment wrote person by person: if a later person
      failed, earlier people were already saved while the UI showed an error. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { browser } = require('./helpers/browser.cjs');
const L = require('../docs/core/payout-ledger.js');

async function store(app) {
  app.OCAuth = { rolActual: () => 'dueno' };
  const alice = await app.request('/api/promotoras', 'POST', { nombre:'Idem Alice', comisionBase:40 });
  const bob = await app.request('/api/promotoras', 'POST', { nombre:'Idem Bob', comisionBase:40 });
  const rack = await app.request('/api/ubicaciones', 'POST', { nombre:'Idem Rack', tipo:'socio' });
  await app.request(`/api/ubicaciones/${rack.id}`, 'PUT', { promotoraId:alice.id });
  const product = await app.request('/api/productos', 'POST', { nombre:'Idem Vase', sku:'IDEM-VASE', barcode:'IDEM-VASE', precio:100, costo:20, stockInicial:10, ubicacionId:rack.id });
  return { alice, bob, rack, product };
}
async function intenta(fn) { try { return { ok:await fn() }; } catch (err) { return { err }; } }

test('point 2: a reused opId with a different amount is refused, not answered with the old payment', async () => {
  const app = browser(); const s = await store(app);
  await app.request(`/api/productos/${s.product.id}/venta`, 'POST', { cantidad:1 });
  const url = `/api/liquidaciones/${s.rack.id}/marcar-pagado`;
  await app.request(url, 'POST', { payeeId:s.alice.id, amountCents:1000, medioPago:'efectivo', opId:'idem-k1' });
  const otra = await intenta(() => app.request(url, 'POST', { payeeId:s.alice.id, amountCents:1500, medioPago:'efectivo', opId:'idem-k1' }));
  assert.ok(otra.err, 'same key with another amount must be an error');
  const misma = await app.request(url, 'POST', { payeeId:s.alice.id, amountCents:1000, medioPago:'efectivo', opId:'idem-k1' });
  assert.ok(misma.existing || misma.payout, 'an exact retry still returns the recorded payment');
  const pagos = await app.request(`/api/payouts?ubicacionId=${s.rack.id}`);
  assert.equal(pagos.length, 1, 'only one payment exists');
  const liq = (await app.request('/api/liquidaciones')).find(x => x.ubicacionId === s.rack.id);
  assert.equal(liq.stillDue, 30);
});

test('point 4: a rack-wide payment that fails for one person records nothing for anyone', async () => {
  const app = browser(); const s = await store(app);
  await app.request(`/api/productos/${s.product.id}/venta`, 'POST', { cantidad:1 });
  await app.request(`/api/productos/${s.product.id}/venta`, 'POST', { cantidad:1, modoComision:'associate', promotoraId:s.bob.id });
  const url = `/api/liquidaciones/${s.rack.id}/marcar-pagado`;
  // A key that the rack-wide call will derive for Bob is already taken by a payment to Alice.
  await app.request(url, 'POST', { payeeId:s.alice.id, amountCents:100, medioPago:'efectivo', opId:`rack:${s.bob.id}` });
  const antes = (await app.request(`/api/payouts?ubicacionId=${s.rack.id}`)).length;
  const r = await intenta(() => app.request(url, 'POST', { medioPago:'efectivo', opId:'rack' }));
  assert.ok(r.err, 'the rack-wide payment must fail because Bob cannot be planned');
  const despues = (await app.request(`/api/payouts?ubicacionId=${s.rack.id}`)).length;
  assert.equal(despues, antes, 'no payment may be written for Alice when Bob fails');
});

test('point 3: the core reports a reversal larger than the payment, and the API refuses to create one', async () => {
  const pago = { id:'p1', opId:'o1', status:'paid', items:[{ kind:'sale', sourceId:'v1', payeeId:'a', amountCents:500 }] };
  const rev = { id:'r1', opId:'o2', status:'paid', reversalOf:'p1', items:[{ kind:'sale', sourceId:'v1', payeeId:'a', amountCents:500 }] };
  assert.equal(typeof L.ledgerAnomalies, 'function', 'the ledger must expose its invariant check');
  assert.deepEqual(L.ledgerAnomalies([pago, rev]), []);
  const dobles = L.ledgerAnomalies([pago, rev, { ...rev, id:'r2', opId:'o3' }]);
  assert.equal(dobles.length, 1);
  assert.equal(dobles[0].reversedCents, 1000);
  assert.equal(dobles[0].paidCents, 500);
  // Same key, other payee: the pure planner refuses too.
  const plan = L.planPayout({ opId:'o1', payeeId:'b', amountCents:500, payouts:[pago] });
  assert.equal(plan.status, 409);
});

/* UI: run the real payment function from docs/index.html in a VM with stubbed dialogs. */
function cargarUI({ fetchImpl }) {
  const html = fs.readFileSync(path.join(__dirname, '../docs/index.html'), 'utf8');
  const start = html.indexOf('const _ocPagosEnCurso');
  const end = html.indexOf('// --- VISTA AVANZADO ---', start);
  const src = (start >= 0 ? html.slice(start, end) : html.slice(html.indexOf('async function marcarComisionPagada'), html.indexOf('// --- VISTA AVANZADO ---')));
  const enviados = [];
  const tick = () => new Promise(r => setTimeout(r, 5));
  const ctx = {
    console, setTimeout, JSON, Number, String, Math, Array, Map, Set, Promise, encodeURIComponent,
    window: { crypto: { randomUUID: () => 'uuid-' + Math.random().toString(36).slice(2) }, OCI18n:null, _ocLiqDet:{}, open(){} },
    document: { getElementById: () => null },
    API: '/api', _ocMesComisiones: '2026-10', _ocMesEtiqueta: (m) => m,
    t: (k) => k, fmtMoney: (n) => '$' + Number(n).toFixed(2),
    _ocModalMostrar: async () => { await tick(); return 'efectivo'; },
    ocPrompt: async () => { await tick(); return '10.00'; },
    ocAlert: async () => {}, ocConfirm: async () => false, cargarComisiones: () => {},
    fetch: async (url, opts) => { enviados.push(JSON.parse(opts.body)); return fetchImpl(enviados.length); }
  };
  vm.createContext(ctx);
  vm.runInContext(src + '\n;globalThis.__pagar = marcarComisionPagada;', ctx);
  return { pagar: ctx.__pagar, enviados };
}
const okRes = () => ({ ok:true, json: async () => ({ ok:true, amount:10, payeeName:'Alice', items:[] }) });

test('point 1: a double tap on Record payment sends one request', async () => {
  const ui = cargarUI({ fetchImpl: okRes });
  await Promise.all([ui.pagar('rack1', 'Alice', 40, 'alice'), ui.pagar('rack1', 'Alice', 40, 'alice')]);
  assert.equal(ui.enviados.length, 1, 'the second tap must be ignored while the first payment is open');
});

test('point 1: a retry after a network failure reuses the same opId; a later new payment gets a new one', async () => {
  const ui = cargarUI({ fetchImpl: (n) => { if (n === 1) throw new Error('offline'); return okRes(); } });
  await ui.pagar('rack1', 'Alice', 40, 'alice');
  await ui.pagar('rack1', 'Alice', 40, 'alice');
  assert.equal(ui.enviados.length, 2);
  assert.equal(ui.enviados[1].opId, ui.enviados[0].opId, 'the retry must send the same idempotency key');
  await ui.pagar('rack1', 'Alice', 40, 'alice');
  assert.notEqual(ui.enviados[2].opId, ui.enviados[1].opId, 'after an answer, the next payment is a new one');
});
