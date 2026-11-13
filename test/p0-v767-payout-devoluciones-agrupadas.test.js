// v767 (revision de codigo 13 nov 2026), hallazgo 2.
// consumedReturnsFor() (docs/core/payout-ledger.js) re-escaneaba TODOS los ajustes
// y reconstruia sus obligaciones en cada llamada, dentro del bucle de ventas
// anuladas x persona: O(anuladas x personas x ajustes). Ahora las devoluciones se
// agrupan por id de venta UNA vez. Los montos deben ser IDENTICOS:
//  - el caso grande deterministico de abajo se fijo con la huella sha256 de la
//    salida del codigo de master 408349e6 (antes del cambio);
//  - la prueba estructural cuenta cuantas veces se recorre el arreglo de ajustes.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const L = require('../docs/core/payout-ledger.js');

// Small seeded PRNG (mulberry32) so the case is the same on every machine.
function rng(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function bigCase(AdjArray) {
  const r = rng(767);
  const pick = (arr) => arr[Math.floor(r() * arr.length)];
  const payees = ['ana', 'beto', 'caro', 'dani'];
  const locations = [{ id: 'r1', promotoraId: 'ana' }, { id: 'r2', promotoraId: 'beto' }, { id: 'r3', promotoraId: null }];
  const sales = [], adjustments = new AdjArray(), payouts = [];
  for (let i = 0; i < 400; i++) {
    const fecha = '2026-' + String(1 + Math.floor(r() * 10)).padStart(2, '0') + '-' + String(1 + Math.floor(r() * 27)).padStart(2, '0') + 'T10:00:00.000Z';
    const loc = pick(locations);
    const reparto = r() < 0.5
      ? [{ promotoraId: pick(payees), monto: +(r() * 30 + 1).toFixed(2) }, { promotoraId: pick(payees), monto: +(r() * 10 + 1).toFixed(2) }]
      : null;
    const v = { id: 'v' + i, fecha, ubicacionId: loc.id, split: reparto ? { reparto } : { montoComisionSocio: +(r() * 40 + 1).toFixed(2) },
      liquidada: r() < 0.1 };
    if (r() < 0.4) { v.anulada = true; v.anuladaEn = '2026-' + String(1 + Math.floor(r() * 11)).padStart(2, '0') + '-15T10:00:00.000Z'; }
    if (r() < 0.2) v.direccionComision = 'asociadoPaga';
    sales.push(v);
    // Returns of this sale: deterministic aj-dev-<id> and/or extra ones.
    const nRet = r() < 0.45 ? 1 + Math.floor(r() * 2) : 0;
    for (let k = 0; k < nRet; k++) {
      const a = { id: k === 0 && r() < 0.6 ? 'aj-dev-' + v.id : 'aj-x-' + i + '-' + k, tipo: 'devolucion', ventaId: v.id,
        fecha: '2026-' + String(1 + Math.floor(r() * 11)).padStart(2, '0') + '-20T10:00:00.000Z', ubicacionId: v.ubicacionId,
        liquidada: r() < 0.1 };
      if (reparto && r() < 0.7) a.reparto = reparto.map((x) => ({ promotoraId: x.promotoraId, monto: -(+(x.monto * r()).toFixed(2) || 0.5) }));
      else a.montoComisionSocio = -(+(r() * 20 + 0.5).toFixed(2));
      adjustments.push(a);
    }
  }
  // A few non-return adjustments too (must be untouched by the grouping).
  for (let j = 0; j < 30; j++) adjustments.push({ id: 'aj-retro-' + j, tipo: 'retro', ventaId: 'v' + j, fecha: '2026-05-05T10:00:00.000Z',
    ubicacionId: 'r1', montoComisionSocio: +(r() * 5 + 0.25).toFixed(2) });
  // Payouts that touch sales, returns (incl. aj-dev ids not listed) and voids.
  for (let p = 0; p < 500; p++) {
    const payee = pick(payees);
    const kind = pick(['sale', 'sale', 'adjustment', 'void']);
    const sid = kind === 'adjustment' ? (r() < 0.5 ? 'aj-dev-v' + Math.floor(r() * 400) : 'aj-x-' + Math.floor(r() * 400) + '-0') : 'v' + Math.floor(r() * 400);
    const amountCents = 100 + Math.floor(r() * 2500);
    payouts.push({ id: 'pay' + p, opId: 'op' + p, status: 'paid', payeeId: payee, amountCents, locationId: 'r1',
      items: [{ kind, sourceId: sid, payeeId: payee, amountCents }] });
  }
  return { sales, adjustments, locations, payouts };
}

const huella = (x) => crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');

test('v767: large voided-sale case gives byte-identical obligations to the pre-change code', () => {
  const input = bigCase(Array);
  const results = [
    L.buildObligations(input),
    L.buildObligations(Object.assign({}, input, { month: '2026-06' })),
    L.buildObligations(Object.assign({}, input, { locationId: 'r2' }))
  ];
  const voids = results[0].filter((o) => o.kind === 'void');
  assert.ok(voids.length > 50, 'the fixture really exercises many voided paid sales');
  const consumidas = results[0].filter((o) => o.kind === 'adjustment' && o.amountCents < 0 && o.paidCents > 0);
  assert.ok(consumidas.length > 0, 'the fixture has returns already consumed by a payment (the path being regrouped)');
  // Recorded from master 408349e6 (before the grouping) with this exact generator.
  assert.equal(huella(results), '8d109d24f1a0a7285e9163bb2decbffb81a5cf60237f12cd38ccf257a2aae4f2');
});

test('v767 RED: returns are grouped once, not rescanned per voided sale and payee', () => {
  let scans = 0;
  class Contada extends Array {
    forEach(fn, self) { scans++; return super.forEach(fn, self); }
  }
  L.buildObligations(bigCase(Contada));
  assert.ok(scans <= 3, 'adjustments must be scanned a constant number of times, got ' + scans);
});
