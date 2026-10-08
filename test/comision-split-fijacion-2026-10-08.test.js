/* Fixation tests: they pin current correct behavior (v468); they are not proof of a bug fix.
   Purpose: the commission split backend moves real money and these helpers had no test that names
   them. Each test title names the function it pins. Money is asserted in exact cents/integers.
   - docs/mock-backend.js is one big IIFE. Its private functions are reached two ways: through the
     app API (like test/payout-fijacion-2026-10-07.test.js) and, for pure helpers, through a handle
     that THIS FILE appends in memory just before the IIFE's closing "})();". The file on disk is
     never changed; docs/ stays exactly as shipped.
   - docs/pocketbase-client.js (also an IIFE, only active when F123_PB_URL is set) is loaded the
     same way in a plain vm context with a stub window.
   - calcularSplitVenta and comisionVigente exist in BOTH files (two sources of truth). The parity
     tests feed the same inputs to both. Real differences are written as test.skip('POSSIBLE BUG: ...')
     with expected vs actual numbers, never as weakened assertions. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

/* ---------- loaders ---------- */
const DOCS = path.join(__dirname, '..', 'docs');
const readReal = fs.readFileSync;
// Insert code right before the final "})();" of an IIFE-wrapped script.
const inject = (src, expr) => { const i = src.lastIndexOf('})();'); return src.slice(0, i) + expr + '\n' + src.slice(i); };
const NAMES = ['comisionVigente', 'calcularSplitVenta', 'resolverTrato', '_retroSinComisionGuardada', 'comisionarVentasDemo',
  '_normRetencion', 'mesesConComision', '_baseComisionValida', 'aplicarRepartoAsistente', '_splitConTratoSellado',
  'corregirComisionVenta', 'corregirComisionesDelMes', '_ventaTienePagoComision', 'corregirPendientesPorCambioComisionista'];
const HANDLE = 'window.__T={' + NAMES.join(',') + ',get ventas(){return ventas},get promotoras(){return promotoras},'
  + 'get ubicaciones(){return ubicaciones},get productos(){return productos},get payouts(){return payouts},get ajustes(){return ajustesComision}};';

function newApp() {
  // browser() reads mock-backend.js synchronously while it builds the fixture; wrap that one read.
  fs.readFileSync = function (p, ...rest) {
    const src = readReal.call(fs, p, ...rest);
    return (typeof p === 'string' && /mock-backend\.js$/.test(p)) ? inject(src, HANDLE) : src;
  };
  try {
    const app = require('./helpers/browser.cjs').browser();
    app.OCAuth = { rolActual: () => 'dueno' };
    return app;
  } finally { fs.readFileSync = readReal; }
}

function loadPb() {
  const w = { localStorage: { getItem: k => (k === 'F123_PB_URL' ? 'http://pb.fixture.invalid' : null) },
    fetch: async () => { throw new Error('no network'); }, console: { info() {}, error() {}, log() {}, warn() {} },
    document: { addEventListener() {} }, Response, URL, URLSearchParams, JSON, Date };
  w.window = w; vm.createContext(w);
  const src = readReal.call(fs, path.join(DOCS, 'pocketbase-client.js'), 'utf8');
  vm.runInContext(inject(src, 'window.__P={comisionVigente,calcularSplitVenta,parseSplit};'), w);
  return w.__P;
}
const PB = loadPb();

/* ---------- fixtures ---------- */
const ZONA = 'America/Guayaquil'; // the app attributes sales to months in this zone
const mesDe = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: ZONA, year: 'numeric', month: '2-digit' }).format(d).slice(0, 7);
// Objects built inside the vm have another Object prototype; compare plain copies.
const plain = (x) => JSON.parse(JSON.stringify(x));
const cents = (n) => Math.round(n * 100);
const KEYS = ['comisionPct', 'montoBruto', 'montoComisionSocio', 'montoNetoDueno'];
const pick = (s) => (s ? Object.fromEntries(KEYS.map(k => [k, s[k]])) : s);

// Shared rack (alice 40%, product 100/cost 20) so API sales produce known money.
async function shop(app, extra) {
  const alice = await app.request('/api/promotoras', 'POST', { nombre: 'Split Alice', comisionBase: 40 });
  const bob = await app.request('/api/promotoras', 'POST', { nombre: 'Split Bob', comisionBase: 20 });
  const rack = await app.request('/api/ubicaciones', 'POST', { nombre: 'Split Rack', tipo: 'socio' });
  await app.request(`/api/ubicaciones/${rack.id}`, 'PUT', Object.assign({ promotoraId: alice.id }, extra || {}));
  const own = await app.request('/api/ubicaciones', 'POST', { nombre: 'Split Own', tipo: 'propio' });
  const mk = (ub, sku, precio, costo) => app.request('/api/productos', 'POST', { nombre: sku, sku, barcode: sku, precio, costo, stockInicial: 100, ubicacionId: ub });
  const product = await mk(rack.id, 'SPL-A', 100, 20);
  const ownProduct = await mk(own.id, 'SPL-O', 100, 20);
  return { alice, bob, rack, own, product, ownProduct, mk };
}
async function vende(app, prod, body) {
  const r = await app.request(`/api/productos/${prod.id}/venta`, 'POST', Object.assign({ cantidad: 1 }, body || {}));
  return app.__T.ventas.find(v => v.id === r.ventaId);
}
const pagaTodo = (app, s, payeeId, amountCents, opId) =>
  app.request(`/api/liquidaciones/${s.rack.id}/marcar-pagado`, 'POST', { payeeId, amountCents, medioPago: 'efectivo', opId });

/* ===================== pocketbase-client.js ===================== */

test('pocketbase-client parseSplit: empty values give null, a JSON string is parsed, an object passes through', () => {
  // Why: PocketBase returns json fields as string or object; a bad value must never throw into the sales list.
  assert.equal(PB.parseSplit(null), null);
  assert.equal(PB.parseSplit(undefined), null);
  assert.equal(PB.parseSplit(''), null);
  assert.deepEqual(PB.parseSplit('{"montoComisionSocio":12.5}'), { montoComisionSocio: 12.5 });
  const obj = { a: 1 };
  assert.equal(PB.parseSplit(obj), obj);
});

test('pocketbase-client parseSplit: invalid JSON text returns null instead of throwing', () => {
  // Why: one corrupt record must not break the whole list.
  assert.equal(PB.parseSplit('{not json'), null);
  assert.equal(PB.parseSplit('null'), null);
});

test('pocketbase-client comisionVigente: no goal or no tiers returns the flat comisionSocio', () => {
  assert.equal(PB.comisionVigente({ comisionSocio: 30 }, 999), 30);
  assert.equal(PB.comisionVigente({ comisionSocio: 30, metaMensual: 1000, escalasComision: [] }, 999), 30);
  assert.equal(PB.comisionVigente({ comisionSocio: 30, metaMensual: 0, escalasComision: [{ hasta: 100, comision: 50 }] }, 999), 30);
  assert.equal(PB.comisionVigente({}, 10), 0);
});

test('pocketbase-client comisionVigente: picks the tier by percent of the monthly goal, last tier above the top', () => {
  const u = { comisionSocio: 5, metaMensual: 1000, escalasComision: [{ hasta: 100, comision: 20 }, { hasta: 50, comision: 10 }] };
  assert.equal(PB.comisionVigente(u, 100), 10); // 10% of goal, sorted tiers (unsorted input)
  assert.equal(PB.comisionVigente(u, 500), 10); // exactly 50% still in the first tier (<=)
  assert.equal(PB.comisionVigente(u, 500.01), 20);
  assert.equal(PB.comisionVigente(u, 9000), 20); // beyond every tier: last tier
});

test('pocketbase-client calcularSplitVenta: own rack, missing rack or no type means no split (null)', () => {
  assert.equal(PB.calcularSplitVenta({ tipo: 'propio', comisionSocio: 30 }, 100, 0), null);
  assert.equal(PB.calcularSplitVenta({ comisionSocio: 30 }, 100, 0), null);
  assert.equal(PB.calcularSplitVenta(null, 100, 0), null);
});

test('pocketbase-client calcularSplitVenta: commission plus owner net always equals the gross, to the cent', () => {
  // Why: the invariant that money is neither created nor lost on a sale.
  for (const [pct, bruto] of [[30, 100], [7.5, 33.33], [33.33, 19.99], [12.5, 0.07], [100, 12.34], [0, 50]]) {
    const s = PB.calcularSplitVenta({ tipo: 'socio', comisionSocio: pct }, bruto, 0);
    assert.equal(cents(s.montoComisionSocio) + cents(s.montoNetoDueno), cents(bruto), `${pct}% of ${bruto}`);
  }
  assert.deepEqual(plain(PB.calcularSplitVenta({ tipo: 'socio', comisionSocio: 30 }, 100, 0)),
    { comisionPct: 30, montoBruto: 100, montoComisionSocio: 30, montoNetoDueno: 70 });
});

/* ===================== PocketBase vs mock parity ===================== */

const ruta = (u) => Object.assign({ id: 'rk' }, u);
const casos = [
  ['rack commission 30%', ruta({ tipo: 'socio', comisionSocio: 30 }), 100, 0],
  ['rack commission, consignment type', ruta({ tipo: 'consignacion', comisionSocio: 85 }), 24.99, 0],
  ['own rack (no split)', ruta({ tipo: 'propio', comisionSocio: 30 }), 100, 0],
  ['counter sale uses the same call as any sale', ruta({ tipo: 'socio', comisionSocio: 40 }), 100, 0],
  ['cortesia / zero price', ruta({ tipo: 'socio', comisionSocio: 30 }), 0, 0],
  ['rounding to cents (7.5% of 33.33)', ruta({ tipo: 'socio', comisionSocio: 7.5 }), 33.33, 0],
  ['rounding to cents (33.33% of 19.99)', ruta({ tipo: 'socio', comisionSocio: 33.33 }), 19.99, 0],
  ['goal tiers, first tier', ruta({ tipo: 'socio', comisionSocio: 5, metaMensual: 1000, escalasComision: [{ hasta: 50, comision: 10 }, { hasta: 100, comision: 20 }, { hasta: 1000, comision: 30 }] }), 100, 0],
  ['goal tiers, second tier by accumulated sales', ruta({ tipo: 'socio', comisionSocio: 5, metaMensual: 1000, escalasComision: [{ hasta: 50, comision: 10 }, { hasta: 100, comision: 20 }, { hasta: 1000, comision: 30 }] }), 100, 450],
  ['goal tiers, beyond the goal', ruta({ tipo: 'socio', comisionSocio: 5, metaMensual: 1000, escalasComision: [{ hasta: 50, comision: 10 }, { hasta: 100, comision: 20 }, { hasta: 120, comision: 30 }] }), 100, 5000],
];

for (const [nombre, u, monto, previo] of casos) {
  test(`parity calcularSplitVenta (pocketbase-client vs mock-backend): ${nombre}`, () => {
    // Why: two copies of the money formula must never drift apart.
    const T = newApp().__T;
    assert.deepEqual(plain(pick(T.calcularSplitVenta(u, monto, previo))), plain(pick(PB.calcularSplitVenta(u, monto, previo))));
  });
}

test('parity comisionVigente (pocketbase-client vs mock-backend): flat and tiered commission agree', () => {
  const T = newApp().__T;
  const tiered = { tipo: 'socio', comisionSocio: 5, metaMensual: 1000, escalasComision: [{ hasta: 50, comision: 10 }, { hasta: 100, comision: 20 }] };
  for (const acum of [0, 100, 500, 501, 1000, 7000]) {
    assert.equal(T.comisionVigente(tiered, acum), PB.comisionVigente(tiered, acum), `accumulated ${acum}`);
  }
  assert.equal(T.comisionVigente({ tipo: 'socio', comisionSocio: 33.5 }, 10), PB.comisionVigente({ tipo: 'socio', comisionSocio: 33.5 }, 10));
});

test.skip('POSSIBLE BUG: parity calcularSplitVenta, tier commission above 100% (pocketbase-client does not clamp)', () => {
  // Input: tiered rack with a tier of 150%, gross 100. Expected (mock-backend): pct 100, commission 100, net 0.
  // Actual pocketbase-client: pct 150, commission 150, net -50 (owner owes money on a sale).
  const T = newApp().__T;
  const u = ruta({ tipo: 'socio', comisionSocio: 5, metaMensual: 1000, escalasComision: [{ hasta: 1000, comision: 150 }] });
  assert.deepEqual(pick(PB.calcularSplitVenta(u, 100, 0)), pick(T.calcularSplitVenta(u, 100, 0)));
});

test.skip('POSSIBLE BUG: parity comisionVigente, out-of-range flat percent (pocketbase-client does not clamp 0..100)', () => {
  // Expected (mock-backend): -5 -> 0 and 130 -> 100. Actual pocketbase-client: -5 and 130.
  const T = newApp().__T;
  assert.equal(PB.comisionVigente({ tipo: 'socio', comisionSocio: -5 }, 1), T.comisionVigente({ tipo: 'socio', comisionSocio: -5 }, 1));
  assert.equal(PB.comisionVigente({ tipo: 'socio', comisionSocio: 130 }, 1), T.comisionVigente({ tipo: 'socio', comisionSocio: 130 }, 1));
});

test.skip('POSSIBLE BUG: parity calcularSplitVenta, rack assigned to a person (pocketbase-client ignores the person percent)', () => {
  // Rack comisionSocio 30 assigned to a person whose comisionBase is 40, gross 100.
  // Expected (mock-backend): 40 / commission 40. Actual pocketbase-client: 30 / commission 30.
  const T = newApp().__T;
  T.promotoras.push({ id: 'pp-parity', nombre: 'Parity', comisionBase: 40 });
  const u = ruta({ tipo: 'socio', comisionSocio: 30, promotoraId: 'pp-parity' });
  assert.equal(PB.calcularSplitVenta(u, 100, 0).montoComisionSocio, T.calcularSplitVenta(u, 100, 0).montoComisionSocio);
});

test.skip('POSSIBLE BUG: parity calcularSplitVenta, fixed contribution and per-product percent (pocketbase-client has neither)', () => {
  // contribFija 20 on a 30% rack, gross 100: expected (mock-backend) commission 24; actual pocketbase-client 30.
  // Product percent 25 on a 30% rack, gross 100: mock-backend 25; pocketbase-client takes no product percent, gives 30.
  const T = newApp().__T;
  const u = ruta({ tipo: 'socio', comisionSocio: 30, contribFija: 20 });
  assert.equal(PB.calcularSplitVenta(u, 100, 0).montoComisionSocio, T.calcularSplitVenta(u, 100, 0).montoComisionSocio);
});

/* ===================== mock-backend: pure helpers ===================== */

test('mock-backend _baseComisionValida: only "margen" and "bruto" are accepted, anything else is null', () => {
  const T = newApp().__T;
  assert.equal(T._baseComisionValida('margen'), 'margen');
  assert.equal(T._baseComisionValida('bruto'), 'bruto');
  for (const bad of ['Margen', 'net', '', null, undefined, 0, {}]) assert.equal(T._baseComisionValida(bad), null);
});

test('mock-backend _normRetencion: only 0/7/14/30 days are accepted, the hold id must match', () => {
  // Why: an unknown value from a future device must be ignored, not turned into a rule.
  const T = newApp().__T;
  for (const d of [0, 7, 14, 30]) assert.deepEqual(plain(T._normRetencion({ id: 'retencion', dias: d })), { id: 'retencion', dias: d, rev: null });
  for (const d of [1, 5, 15, 31, -7, 365]) assert.equal(T._normRetencion({ id: 'retencion', dias: d }), null, `${d} days`);
  assert.equal(T._normRetencion({ id: 'moneda', dias: 7 }), null);
  assert.equal(T._normRetencion(null), null);
  assert.equal(T._normRetencion(undefined), null);
});

test('mock-backend _normRetencion: text numbers and decimals are floored, missing days mean off (0), rev is kept', () => {
  const T = newApp().__T;
  assert.equal(T._normRetencion({ id: 'retencion', dias: '14' }).dias, 14);
  assert.equal(T._normRetencion({ id: 'retencion', dias: 7.9 }).dias, 7);
  assert.equal(T._normRetencion({ id: 'retencion' }).dias, 0);
  assert.equal(T._normRetencion({ id: 'retencion', dias: 30, rev: 'r-1' }).rev, 'r-1');
});

test('mock-backend _normRetencion (through /api/config/retencion): off by default, owner can set 7, 5 days is refused', async () => {
  const app = newApp();
  assert.equal((await app.request('/api/config/retencion')).dias, 0);
  assert.equal((await app.request('/api/config/retencion', 'PUT', { dias: 7 })).dias, 7);
  assert.equal((await app.request('/api/config/retencion')).dias, 7);
  await assert.rejects(() => app.request('/api/config/retencion', 'PUT', { dias: 5 }), /400/);
  assert.equal((await app.request('/api/config/retencion')).dias, 7, 'a refused value leaves the setting as it was');
});

test('mock-backend _retroSinComisionGuardada: no split, or a zero split with no reparto, counts as "nothing saved"', () => {
  // Why: the retro-fix must only fill sales that truly have no commission recorded.
  const T = newApp().__T;
  assert.equal(T._retroSinComisionGuardada({}), true);
  assert.equal(T._retroSinComisionGuardada({ split: null }), true);
  assert.equal(T._retroSinComisionGuardada({ split: { montoComisionSocio: 0 } }), true);
  assert.equal(T._retroSinComisionGuardada({ split: { montoComisionSocio: 0.004 } }), true, 'under half a cent rounds to 0');
  assert.equal(T._retroSinComisionGuardada({ split: { montoComisionSocio: 0, reparto: [null] } }), true, 'empty reparto entries do not count');
});

test('mock-backend _retroSinComisionGuardada: any commission of one cent or more, or a reparto, counts as saved', () => {
  const T = newApp().__T;
  assert.equal(T._retroSinComisionGuardada({ split: { montoComisionSocio: 0.01 } }), false);
  assert.equal(T._retroSinComisionGuardada({ split: { montoComisionSocio: 12.5 } }), false);
  assert.equal(T._retroSinComisionGuardada({ split: { montoComisionSocio: 0, reparto: [{ rol: 'vendedor', monto: 0 }] } }), false);
});

test('mock-backend comisionVigente: own rack is 0, flat rack percent, rack person percent beats the rack percent', () => {
  const T = newApp().__T;
  T.promotoras.push({ id: 'pp-cv', nombre: 'CV', comisionBase: 45 });
  assert.equal(T.comisionVigente({ id: 'a', tipo: 'propio', comisionSocio: 30 }, 100), 0);
  assert.equal(T.comisionVigente(null, 100), 0);
  assert.equal(T.comisionVigente({ id: 'b', tipo: 'socio', comisionSocio: 30 }, 100), 30);
  assert.equal(T.comisionVigente({ id: 'c', tipo: 'socio', comisionSocio: 30, promotoraId: 'pp-cv' }, 100), 45);
  assert.equal(T.comisionVigente({ id: 'd', tipo: 'socio', comisionSocio: 30, promotoraId: 'pp-cv', usarComisionPropia: true }, 100), 30);
});

test('mock-backend comisionVigente: percent is clamped to 0..100 and tiers follow the accumulated sales', () => {
  const T = newApp().__T;
  assert.equal(T.comisionVigente({ id: 'e', tipo: 'socio', comisionSocio: -5 }, 1), 0);
  assert.equal(T.comisionVigente({ id: 'f', tipo: 'socio', comisionSocio: 130 }, 1), 100);
  const u = { id: 'g', tipo: 'socio', comisionSocio: 5, metaMensual: 1000, escalasComision: [{ hasta: 50, comision: 10 }, { hasta: 100, comision: 20 }] };
  assert.equal(T.comisionVigente(u, 500), 10);
  assert.equal(T.comisionVigente(u, 501), 20);
  assert.equal(T.comisionVigente(u, 99999), 20);
});

test('mock-backend calcularSplitVenta: rack deal, own rack and missing rack', () => {
  const T = newApp().__T;
  const s = T.calcularSplitVenta({ id: 'r1', tipo: 'socio', comisionSocio: 30 }, 100, 0, 20);
  assert.equal(s.comisionPct, 30);
  assert.equal(s.montoComisionSocio, 30);
  assert.equal(s.montoNetoDueno, 70);
  assert.equal(s.origenComision, 'percha');
  assert.equal(T.calcularSplitVenta({ id: 'r2', tipo: 'propio' }, 100, 0, 20), null, 'own rack with no product percent: no commission invented');
  assert.equal(T.calcularSplitVenta(null, 100, 0, 20), null);
});

test('mock-backend calcularSplitVenta: product percent beats the rack percent, 0 is a real percent, tiers are ignored', () => {
  // Why: owner rule "the percent of each product rules"; 0% means the associate really earns nothing.
  const T = newApp().__T;
  const rack = { id: 'r3', tipo: 'socio', comisionSocio: 30, metaMensual: 1000, escalasComision: [{ hasta: 1000, comision: 60 }] };
  const s = T.calcularSplitVenta(rack, 100, 0, 20, 25);
  assert.equal(s.comisionPct, 25);
  assert.equal(s.montoComisionSocio, 25);
  assert.equal(s.origenComision, 'producto');
  assert.equal(T.calcularSplitVenta(rack, 100, 0, 20, 0).montoComisionSocio, 0);
  assert.equal(T.calcularSplitVenta(rack, 100, 0, 20, '').comisionPct, 60, 'empty product percent falls back to the rack tiers');
  assert.equal(T.calcularSplitVenta(rack, 100, 0, 20, 150).comisionPct, 100, 'product percent is clamped to 100');
});

test('mock-backend calcularSplitVenta: own rack with a product percent still commissions (v457 law)', () => {
  const T = newApp().__T;
  const s = T.calcularSplitVenta({ id: 'own1', tipo: 'propio' }, 80, 0, 10, 50);
  assert.equal(s.montoComisionSocio, 40);
  assert.equal(s.montoNetoDueno, 40);
  assert.equal(s.origenComision, 'producto');
});

test('mock-backend calcularSplitVenta: margin base, fixed contribution and guaranteed minimum', () => {
  const T = newApp().__T;
  const margen = T.calcularSplitVenta({ id: 'm1', tipo: 'socio', comisionSocio: 50, baseComision: 'margen' }, 100, 0, 40);
  assert.equal(margen.montoComisionSocio, 30, '50% of (100 - 40)');
  assert.equal(margen.baseComision, 'margen');
  const sinCosto = T.calcularSplitVenta({ id: 'm2', tipo: 'socio', comisionSocio: 50, baseComision: 'margen' }, 100, 0, 0);
  assert.equal(sinCosto.montoComisionSocio, 50, 'no cost recorded: gross is used and the warning is set');
  assert.ok(sinCosto.avisoBase);
  assert.equal(T.calcularSplitVenta({ id: 'm3', tipo: 'socio', comisionSocio: 30, contribFija: 20 }, 100, 0, 0).montoComisionSocio, 24, '30% of (100 - 20)');
  assert.equal(T.calcularSplitVenta({ id: 'm4', tipo: 'socio', comisionSocio: 30, contribFija: 500 }, 100, 0, 0).montoComisionSocio, 0, 'a fixed amount above the sale never goes negative');
  assert.equal(T.calcularSplitVenta({ id: 'm5', tipo: 'socio', comisionSocio: 10, minimoGarantizado: 25 }, 100, 0, 0).montoComisionSocio, 25);
  assert.equal(T.calcularSplitVenta({ id: 'm6', tipo: 'socio', comisionSocio: 10, minimoGarantizado: 25 }, 20, 0, 0).montoComisionSocio, 20, 'the minimum never exceeds the sale');
});

test('mock-backend calcularSplitVenta: zero price (cortesia) and cents rounding keep commission + net == gross', () => {
  const T = newApp().__T;
  const z = T.calcularSplitVenta({ id: 'z1', tipo: 'socio', comisionSocio: 30 }, 0, 0, 12);
  assert.equal(z.montoComisionSocio, 0);
  assert.equal(z.montoNetoDueno, 0);
  for (const [pct, bruto] of [[7.5, 33.33], [33.33, 19.99], [12.5, 0.07], [66.67, 10.01]]) {
    const s = T.calcularSplitVenta({ id: 'z2', tipo: 'socio', comisionSocio: pct }, bruto, 0, 0);
    assert.equal(cents(s.montoComisionSocio) + cents(s.montoNetoDueno), cents(bruto), `${pct}% of ${bruto}`);
  }
});

test('mock-backend aplicarRepartoAsistente: seller + assistant add up to the commission to the cent', () => {
  // Why: the house commission does not change; only its split between two people.
  const T = newApp().__T;
  T.promotoras.push({ id: 'as1', nombre: 'Assist', comisionBase: 10 });
  const u = { promotoraId: 'seller-1' };
  for (const total of [10, 10.01, 0.01, 33.33, 99.99, 1234.56]) {
    for (const pct of [0, 25, 33.33, 50, 100]) {
      const sp = T.aplicarRepartoAsistente({ montoComisionSocio: total }, u, 'as1', pct);
      assert.equal(cents(sp.reparto[0].monto) + cents(sp.reparto[1].monto), cents(total), `${total} @ ${pct}%`);
    }
  }
  const sp = T.aplicarRepartoAsistente({ montoComisionSocio: 40 }, u, 'as1', 25);
  assert.deepEqual(plain(sp.reparto), [{ rol: 'vendedor', promotoraId: 'seller-1', monto: 30 }, { rol: 'asistente', promotoraId: 'as1', pct: 25, monto: 10 }]);
});

test('mock-backend aplicarRepartoAsistente: pct is clamped, missing pct means 50, bad or deleted assistant removes the reparto', () => {
  const T = newApp().__T;
  T.promotoras.push({ id: 'as2', nombre: 'Assist2', comisionBase: 10 }, { id: 'as3', nombre: 'Gone', comisionBase: 10, borrado: true });
  assert.equal(T.aplicarRepartoAsistente(null, {}, 'as2', 50), null);
  assert.equal(T.aplicarRepartoAsistente({ montoComisionSocio: 40 }, {}, 'as2', 150).reparto[1].monto, 40);
  assert.equal(T.aplicarRepartoAsistente({ montoComisionSocio: 40 }, {}, 'as2', -20).reparto[1].monto, 0);
  assert.equal(T.aplicarRepartoAsistente({ montoComisionSocio: 40 }, {}, 'as2', undefined).reparto[1].monto, 20);
  assert.equal(T.aplicarRepartoAsistente({ montoComisionSocio: 40 }, {}, 'as2', 'abc').reparto[1].monto, 20);
  assert.equal(T.aplicarRepartoAsistente({ montoComisionSocio: 40, reparto: [{ x: 1 }] }, {}, 'nobody', 50).reparto, undefined, 'an old reparto is removed');
  assert.equal(T.aplicarRepartoAsistente({ montoComisionSocio: 40 }, {}, 'as3', 50).reparto, undefined, 'a deleted assistant gets nothing');
  assert.equal(T.aplicarRepartoAsistente({ montoComisionSocio: 40 }, {}, null, 50).reparto, undefined);
});

test('mock-backend _splitConTratoSellado: re-splits with the percent sealed in the sale, not the current rack deal', () => {
  // Why: owner rule "changing the deal later never recalculates past sales".
  const T = newApp().__T;
  const venta = { split: { comisionPct: 40, montoBruto: 100, montoComisionSocio: 40, montoNetoDueno: 60 } };
  const s = T._splitConTratoSellado(venta, 50, 10);
  assert.equal(s.comisionPct, 40);
  assert.equal(s.montoComisionSocio, 20);
  assert.equal(s.montoNetoDueno, 30);
});

test('mock-backend _splitConTratoSellado: keeps the margin base, the fixed contribution and a guaranteed minimum', () => {
  const T = newApp().__T;
  const margen = { split: { comisionPct: 50, baseComision: 'margen', montoBruto: 100, montoBaseComision: 60, montoComisionSocio: 30 } };
  const m = T._splitConTratoSellado(margen, 200, 100);
  assert.equal(m.baseComision, 'margen');
  assert.equal(m.montoComisionSocio, 50, '50% of (200 - 100)');
  const fijo = { split: { comisionPct: 30, montoBruto: 100, montoBaseComision: 100, contribFijaAplicada: 20, montoComisionSocio: 24 } };
  assert.equal(T._splitConTratoSellado(fijo, 100, 0).montoComisionSocio, 24, '30% of (100 - 20)');
  const minimo = { split: { comisionPct: 5, montoBruto: 100, montoBaseComision: 100, montoComisionSocio: 10 } };
  assert.equal(T._splitConTratoSellado(minimo, 100, 0).montoComisionSocio, 10, 'the original minimum of 10 survives the edit');
  assert.equal(T._splitConTratoSellado(minimo, 8, 0).montoComisionSocio, 8, 'but never more than the new gross');
});

test('mock-backend _splitConTratoSellado: a sale with no split behaves as 0% (no commission appears from nothing)', () => {
  const T = newApp().__T;
  const s = T._splitConTratoSellado({}, 100, 0);
  assert.equal(s.comisionPct, 0);
  assert.equal(s.montoComisionSocio, 0);
  assert.equal(s.montoNetoDueno, 100);
});

/* ===================== mock-backend: through the sales API ===================== */

test('mock-backend calcularSplitVenta (through a sale): rack person 40% on a 100 sale = 40 / 60, sealed in the sale', async () => {
  const app = newApp(); const s = await shop(app);
  const v = await vende(app, s.product);
  assert.equal(v.split.comisionPct, 40);
  assert.equal(v.split.montoComisionSocio, 40);
  assert.equal(v.split.montoNetoDueno, 60);
  assert.equal(v.modoComision, 'acuerdo');
});

test('mock-backend calcularSplitVenta (counter sale "mostrador"): commissioned like any sale with the rack deal', async () => {
  // Why: owner rule 2026-09-30, counter is NOT the house.
  const app = newApp(); const s = await shop(app);
  const v = await vende(app, s.product, { modoComision: 'counter' });
  assert.equal(v.canalVenta, 'mostrador');
  assert.equal(v.modoComision, 'acuerdo');
  assert.equal(v.split.montoComisionSocio, 40);
  assert.equal(v.split.montoNetoDueno, 60);
});

test('mock-backend calcularSplitVenta (counter sale on an own rack with no deal): no commission, no split', async () => {
  const app = newApp(); const s = await shop(app);
  const v = await vende(app, s.ownProduct, { modoComision: 'counter' });
  assert.equal(v.split, null);
});

test('mock-backend calcularSplitVenta (cortesia): cost but no price, so income 0 and commission 0', async () => {
  const app = newApp(); const s = await shop(app);
  const v = await vende(app, s.product, { info: { cortesia: true } });
  assert.equal(v.precioUnit, 0);
  assert.equal(v.costoUnit, 20);
  assert.equal(v.split.montoBruto, 0);
  assert.equal(v.split.montoComisionSocio, 0);
  assert.equal(v.split.montoNetoDueno, 0);
});

test('mock-backend calcularSplitVenta (product percent through a sale): pctAsociado 25 beats the 40% person on that product', async () => {
  const app = newApp(); const s = await shop(app);
  app.__T.productos.find(p => p.id === s.product.id).pctAsociado = 25;
  const v = await vende(app, s.product);
  assert.equal(v.split.comisionPct, 25);
  assert.equal(v.split.montoComisionSocio, 25);
  assert.equal(v.split.origenComision, 'producto');
});

test('mock-backend _cobrado (through /api/reportes/balance): cash estimate is price x qty, plus tax only when tax was added on top', async () => {
  // Why: _cobrado decides how much money counts as collected today.
  const app = newApp(); const s = await shop(app);
  await vende(app, s.ownProduct, { cantidad: 2 });
  const efectivo = async () => (await app.request(`/api/reportes/balance?ubicacionId=${s.own.id}`)).activos.efectivoEstimado;
  assert.equal(await efectivo(), 200);
  await app.request('/api/config/impuesto', 'PUT', { activo: true, tasa: 10, nombre: 'VAT', modo: 'agregado' });
  await vende(app, s.ownProduct, { cantidad: 1 });
  assert.equal(await efectivo(), 310, '200 + (100 + 10 tax added on top)');
});

test('mock-backend _cobrado (through /api/reportes/balance): a return today is subtracted at the same collected amount', async () => {
  const app = newApp(); const s = await shop(app);
  const v1 = await vende(app, s.ownProduct, { cantidad: 2 });
  await vende(app, s.ownProduct, { cantidad: 1 });
  await app.request(`/api/ventas/${v1.id}/devolucion`, 'POST', { motivo: 'fixture' });
  const ef = (await app.request(`/api/reportes/balance?ubicacionId=${s.own.id}`)).activos.efectivoEstimado;
  assert.equal(ef, 100, '300 sold minus the 200 returned');
});

/* ===================== corregirComisionVenta / corregirComisionesDelMes ===================== */

test('mock-backend corregirComisionVenta: recalculates the split, keeps the old numbers in the audit trail', async () => {
  const app = newApp(); const s = await shop(app); const T = app.__T;
  const v = await vende(app, s.product);
  const r = T.corregirComisionVenta(v.id, 50, 'Tester', 'wrong deal', { deferPersist: true });
  assert.equal(r.ok, true);
  assert.equal(v.split.comisionPct, 50);
  assert.equal(v.split.montoComisionSocio, 50);
  assert.equal(v.split.montoNetoDueno, 50);
  assert.equal(v.split.corregida, true);
  assert.equal(v.split.correcciones.length, 1);
  assert.deepEqual(plain(v.split.correcciones[0].antes), { comisionPct: 40, montoComisionSocio: 40, montoNetoDueno: 60 });
  assert.equal(v.split.correcciones[0].despues.montoComisionSocio, 50);
  assert.equal(v.split.correcciones[0].quien, 'Tester');
  assert.equal(v.precioUnit, 100, 'the sale itself does not change');
});

test('mock-backend corregirComisionVenta: 0% is a valid correction, empty/missing/out-of-range percents are refused', async () => {
  const app = newApp(); const s = await shop(app); const T = app.__T;
  const v = await vende(app, s.product);
  for (const bad of [null, undefined, '']) assert.equal(T.corregirComisionVenta(v.id, bad, 'q', 'm', { deferPersist: true }).status, 400, `percent ${String(bad)}`);
  for (const bad of [-1, 100.01, 'abc', NaN]) assert.equal(T.corregirComisionVenta(v.id, bad, 'q', 'm', { deferPersist: true }).status, 400, `percent ${String(bad)}`);
  assert.equal(v.split.montoComisionSocio, 40, 'refused corrections change nothing');
  assert.equal(T.corregirComisionVenta(v.id, 0, 'q', 'm', { deferPersist: true }).ok, true);
  assert.equal(v.split.montoComisionSocio, 0);
  assert.equal(v.split.montoNetoDueno, 100);
});

test('mock-backend corregirComisionVenta: unknown sale is 404, a sale on an own rack (no split) is 400', async () => {
  const app = newApp(); const s = await shop(app); const T = app.__T;
  assert.equal(T.corregirComisionVenta('nope', 10, 'q', 'm', { deferPersist: true }).status, 404);
  const propia = await vende(app, s.ownProduct);
  assert.equal(T.corregirComisionVenta(propia.id, 10, 'q', 'm', { deferPersist: true }).status, 400);
});

test('mock-backend corregirComisionVenta: a settled (liquidada) sale is refused with 409 and keeps its sealed numbers', async () => {
  // Why: what was paid is never edited.
  const app = newApp(); const s = await shop(app); const T = app.__T;
  const v = await vende(app, s.product);
  v.liquidada = true;
  const r = T.corregirComisionVenta(v.id, 10, 'q', 'm', { deferPersist: true });
  assert.equal(r.status, 409);
  assert.equal(v.split.montoComisionSocio, 40);
});

test('mock-backend corregirComisionVenta: a sale with a partial payout in the ledger is refused with 409', async () => {
  const app = newApp(); const s = await shop(app); const T = app.__T;
  const v = await vende(app, s.product);
  await pagaTodo(app, s, s.alice.id, 1000, 'fx-partial');
  const r = T.corregirComisionVenta(v.id, 10, 'q', 'm', { deferPersist: true });
  assert.equal(r.status, 409);
  assert.equal(v.split.montoComisionSocio, 40);
});

test('mock-backend corregirComisionVenta: a returned sale is refused with 409', async () => {
  const app = newApp(); const s = await shop(app); const T = app.__T;
  const v = await vende(app, s.product);
  v.devuelta = true;
  assert.equal(T.corregirComisionVenta(v.id, 10, 'q', 'm', { deferPersist: true }).status, 409);
});

test('mock-backend corregirComisionVenta: margin-based sale keeps its margin base, and a two-person split stays exact', async () => {
  const app = newApp(); const s = await shop(app, { baseComision: 'margen' }); const T = app.__T;
  const v = await vende(app, s.product, { asistenteId: s.bob.id, asistentePct: 33.33 });
  assert.equal(v.split.baseComision, 'margen');
  assert.equal(v.split.montoBaseComision, 80);
  assert.equal(v.split.montoComisionSocio, 32, '40% of the 80 margin');
  assert.equal(T.corregirComisionVenta(v.id, 25, 'q', 'm', { deferPersist: true }).ok, true);
  assert.equal(v.split.montoComisionSocio, 20, '25% of the same 80 margin, base never switches');
  assert.equal(cents(v.split.reparto[0].monto) + cents(v.split.reparto[1].monto), 2000);
});

test('mock-backend corregirComisionesDelMes (through PATCH): fixes pending sales, leaves settled ones, counts both', async () => {
  const app = newApp(); const s = await shop(app);
  const a = await vende(app, s.product);
  const b = await vende(app, s.product);
  b.liquidada = true;
  const r = await app.request(`/api/ubicaciones/${s.rack.id}/comisiones-del-mes`, 'PATCH', { comisionPct: 10, quien: 'Tester', motivo: 'bulk' });
  assert.deepEqual(plain(r), { ok: true, corregidas: 1, fallidas: 0 });
  assert.equal(a.split.montoComisionSocio, 10);
  assert.equal(b.split.montoComisionSocio, 40, 'the settled sale is untouched');
});

test('mock-backend corregirComisionesDelMes: with soloPendientes=false a settled sale is attempted and counted as failed', async () => {
  const app = newApp(); const s = await shop(app);
  const a = await vende(app, s.product);
  const b = await vende(app, s.product);
  b.liquidada = true;
  const r = await app.request(`/api/ubicaciones/${s.rack.id}/comisiones-del-mes`, 'PATCH', { comisionPct: 10, soloPendientes: false });
  assert.deepEqual(plain(r), { ok: true, corregidas: 1, fallidas: 1 });
  assert.equal(a.split.montoComisionSocio, 10);
  assert.equal(b.split.montoComisionSocio, 40);
});

test('mock-backend corregirComisionesDelMes: no commissioned sales this month is a 400; all failing returns the first error', async () => {
  const app = newApp(); const s = await shop(app);
  await assert.rejects(() => app.request(`/api/ubicaciones/${s.rack.id}/comisiones-del-mes`, 'PATCH', { comisionPct: 10 }), /400/);
  const v = await vende(app, s.product);
  await assert.rejects(() => app.request(`/api/ubicaciones/${s.rack.id}/comisiones-del-mes`, 'PATCH', { comisionPct: 'bad' }), /400/);
  assert.equal(v.split.montoComisionSocio, 40, 'an invalid percent changes nothing');
});

/* ===================== _ventaTienePagoComision / corregirPendientesPorCambioComisionista ===================== */

test('mock-backend _ventaTienePagoComision: false when unpaid, true after any payout, even a partial one', async () => {
  const app = newApp(); const s = await shop(app); const T = app.__T;
  const v = await vende(app, s.product);
  assert.equal(T._ventaTienePagoComision(v), false);
  await pagaTodo(app, s, s.alice.id, 500, 'fx-pay-1');
  assert.equal(T._ventaTienePagoComision(v), true, 'a payout of 5.00 out of 40.00 already counts as paid history');
});

test('mock-backend _ventaTienePagoComision: a sale on an own rack (no commission) never reads as paid', async () => {
  const app = newApp(); const s = await shop(app); const T = app.__T;
  const v = await vende(app, s.ownProduct);
  assert.equal(T._ventaTienePagoComision(v), false);
  assert.equal(T._ventaTienePagoComision({ id: 'ghost', ubicacionId: 'nowhere', split: null }), false);
});

test('mock-backend corregirPendientesPorCambioComisionista: pending sales sealed at the old person percent move to the new one', async () => {
  const app = newApp(); const s = await shop(app); const T = app.__T;
  const a = await vende(app, s.product);
  const b = await vende(app, s.product);
  const r = T.corregirPendientesPorCambioComisionista(s.alice, 40, 50, false);
  assert.deepEqual(plain(r), { corregidas: 2 });
  assert.equal(a.split.montoComisionSocio, 50);
  assert.equal(b.split.montoNetoDueno, 50);
  assert.equal(a.split.correcciones[0].tipo, 'persona-base');
  assert.equal(a.split.correcciones[0].quien, 'system');
});

test('mock-backend corregirPendientesPorCambioComisionista: a settled sale is untouched while a pending one moves', async () => {
  const app = newApp(); const s = await shop(app); const T = app.__T;
  const pagada = await vende(app, s.product);
  pagada.liquidada = true;
  const libre = await vende(app, s.product);
  assert.deepEqual(plain(T.corregirPendientesPorCambioComisionista(s.alice, 40, 50, false)), { corregidas: 1 });
  assert.equal(pagada.split.montoComisionSocio, 40);
  assert.equal(libre.split.montoComisionSocio, 50);
});

test('mock-backend corregirPendientesPorCambioComisionista: a partly paid sale is untouched (paid money is never clamped away)', async () => {
  // Why: lowering the earning below money already handed over would erase it in the ledger.
  const app = newApp(); const s = await shop(app); const T = app.__T;
  const parcial = await vende(app, s.product);
  await pagaTodo(app, s, s.alice.id, 100, 'fx-cp-1');
  assert.deepEqual(plain(T.corregirPendientesPorCambioComisionista(s.alice, 40, 10, false)), { corregidas: 0 });
  assert.equal(parcial.split.montoComisionSocio, 40);
});

test('mock-backend corregirPendientesPorCambioComisionista: manually corrected sales and product-percent sales are untouched', async () => {
  const app = newApp(); const s = await shop(app); const T = app.__T;
  const manual = await vende(app, s.product);
  assert.equal(T.corregirComisionVenta(manual.id, 40, 'q', 'manual', { deferPersist: true }).ok, true);
  assert.deepEqual(plain(T.corregirPendientesPorCambioComisionista(s.alice, 40, 50, false)), { corregidas: 0 }, 'manual correction is the owner decision');
  const conProducto = await vende(app, s.product);
  T.productos.find(p => p.id === s.product.id).pctAsociado = 40; // set after the sale: the product percent rules, not the person
  assert.deepEqual(plain(T.corregirPendientesPorCambioComisionista(s.alice, 40, 50, false)), { corregidas: 0 });
  assert.equal(conProducto.split.montoComisionSocio, 40);
  assert.equal(manual.split.montoComisionSocio, 40);
});

test('mock-backend corregirPendientesPorCambioComisionista: complex deals, same percent and bad input return 0 corrected', async () => {
  const app = newApp(); const s = await shop(app); const T = app.__T;
  const v = await vende(app, s.product);
  assert.deepEqual(plain(T.corregirPendientesPorCambioComisionista(s.alice, 40, 50, true)), { corregidas: 0 }, 'tiers/fixed/minimum deals are not guessed');
  assert.deepEqual(plain(T.corregirPendientesPorCambioComisionista(s.alice, 40, 40, false)), { corregidas: 0 });
  assert.deepEqual(plain(T.corregirPendientesPorCambioComisionista(s.alice, NaN, 50, false)), { corregidas: 0 });
  assert.deepEqual(plain(T.corregirPendientesPorCambioComisionista(null, 40, 50, false)), { corregidas: 0 });
  assert.deepEqual(plain(T.corregirPendientesPorCambioComisionista(s.bob, 40, 50, false)), { corregidas: 0 }, 'another person has no sales on this rack');
  assert.equal(v.split.montoComisionSocio, 40);
});

/* ===================== mesesConComision / comisionarVentasDemo ===================== */

function limpiaVentas(T) { T.ventas.length = 0; T.ajustes.length = 0; T.payouts.length = 0; }
const ventaMes = (id, mes, comision, extra) => Object.assign({ id, productoId: 'x', ubicacionId: 'consigna', cantidad: 1, precioUnit: comision * 2,
  fecha: `${mes}-15T17:00:00.000Z`, split: { montoBruto: comision * 2, montoComisionSocio: comision, montoNetoDueno: comision }, liquidada: false }, extra || {});

test('mock-backend mesesConComision: the current month is always listed, newest first, with count, total and pending', () => {
  const T = newApp().__T;
  limpiaVentas(T);
  const actual = mesDe(new Date());
  const [y, m] = actual.split('-').map(Number);
  const prev = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
  const r0 = T.mesesConComision();
  assert.deepEqual(plain(r0), [{ mes: actual, actual: true, ventas: 0, comision: 0, pendiente: 0 }], 'empty book: only the current month');
  T.ventas.push(ventaMes('t1', prev, 10), ventaMes('t2', prev, 5.5, { liquidada: true }), ventaMes('t3', actual, 7));
  const r = T.mesesConComision();
  assert.deepEqual(plain(r.map(x => x.mes)), [actual, prev]);
  assert.equal(r[0].actual, true);
  assert.equal(r[0].ventas, 1);
  assert.equal(cents(r[0].comision), 700);
  assert.equal(r[1].ventas, 2);
  assert.equal(cents(r[1].comision), 1550);
  assert.equal(cents(r[1].pendiente), 1000, 'the settled 5.50 is not pending');
});

test('mock-backend mesesConComision: sales with no split, voided sales, and returns (negative adjustments) are accounted correctly', () => {
  const T = newApp().__T;
  limpiaVentas(T);
  const actual = mesDe(new Date());
  T.ventas.push(ventaMes('u1', actual, 20), ventaMes('u2', actual, 99, { anulada: true }), ventaMes('u3', actual, 5, { split: null }));
  T.ajustes.push({ id: 'aj-1', fecha: `${actual}-15T17:00:00.000Z`, montoComisionSocio: -8, liquidada: false });
  const r = T.mesesConComision()[0];
  assert.equal(r.ventas, 1, 'voided and split-less sales are not counted');
  assert.equal(cents(r.comision), 1200, '20.00 earned minus the 8.00 return adjustment');
  assert.equal(cents(r.pendiente), 1200);
});

test('mock-backend mesesConComision (through /api/liquidaciones/meses): the API returns the same list', async () => {
  const app = newApp(); const T = app.__T;
  limpiaVentas(T);
  T.ventas.push(ventaMes('w1', mesDe(new Date()), 12.34));
  const api = await app.request('/api/liquidaciones/meses');
  assert.deepEqual(api, JSON.parse(JSON.stringify(T.mesesConComision())));
  assert.equal(cents(api[0].comision), 1234);
});

test('mock-backend comisionarVentasDemo: demo sales on shared racks get the rack deal, own racks stay without split', () => {
  // Why: the demo history must show true commissions, computed with the same engine as real sales.
  const T = newApp().__T;
  const demo = T.ventas.filter(v => String(v.id).startsWith('vs-'));
  assert.ok(demo.length > 0);
  for (const v of demo) {
    const u = T.ubicaciones.find(x => x.id === v.ubicacionId);
    if (!u || !u.tipo || u.tipo === 'propio') { assert.equal(v.split, null, `${v.id} on an own rack`); continue; }
    // Legacy demo sales saved as "counter" (pre v429) are skipped by comisionarVentasDemo and keep no split.
    if (v.modoComision === 'counter') { assert.equal(v.split, null, `${v.id} legacy counter demo sale`); continue; }
    assert.equal(v.modoComision, 'acuerdo');
    const bruto = v.precioUnit * v.cantidad;
    assert.equal(cents(v.split.montoComisionSocio) + cents(v.split.montoNetoDueno), cents(bruto), `${v.id} adds up`);
    assert.ok(v.split.montoComisionSocio > 0, `${v.id} has a commission`);
  }
});

test('mock-backend comisionarVentasDemo: running it again keeps every commission amount identical (idempotent in money)', () => {
  const T = newApp().__T;
  const montos = () => JSON.stringify(T.ventas.filter(v => String(v.id).startsWith('vs-')).map(v => [v.id, v.split && v.split.montoComisionSocio, v.split && v.split.montoNetoDueno]));
  const antes = montos();
  T.comisionarVentasDemo();
  assert.equal(montos(), antes);
});

test('mock-backend comisionarVentasDemo: the one-shot _demoImpaga mark is consumed, so a second run settles last month demo sales', () => {
  // Why: pins a demo-only detail (boot calls it once); real sales never have the vs- id prefix.
  const T = newApp().__T;
  const impagasAntes = T.ventas.filter(v => String(v.id).startsWith('vs-') && v.split && v.liquidada === false).length;
  T.comisionarVentasDemo();
  const impagasDespues = T.ventas.filter(v => String(v.id).startsWith('vs-') && v.split && v.liquidada === false).length;
  assert.ok(impagasDespues < impagasAntes, `${impagasDespues} < ${impagasAntes}`);
});

test('mock-backend comisionarVentasDemo: current-month demo commissions are pending, months before last month are settled', () => {
  const T = newApp().__T;
  const actual = mesDe(new Date());
  const [y, m] = actual.split('-').map(Number);
  const pasado = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
  const conSplit = T.ventas.filter(v => String(v.id).startsWith('vs-') && v.split);
  const mesV = (v) => mesDe(new Date(v.fecha));
  const delMes = conSplit.filter(v => mesV(v) === actual);
  const viejas = conSplit.filter(v => mesV(v) < pasado);
  assert.ok(delMes.length > 0 && viejas.length > 0, 'the demo seed spans both cases');
  assert.ok(delMes.every(v => v.liquidada === false));
  assert.ok(viejas.every(v => v.liquidada === true));
});
