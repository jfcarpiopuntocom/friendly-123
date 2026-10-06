/* Libro de doble entrada v1 (ADR-001 paso 1). Reglas 1-7 e invariantes (a)-(e).
   Importes en centavos enteros. Sin UI. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const LG = require('../docs/core/ledger.js');
const PL = require('../docs/core/payout-ledger.js');

const ubicaciones = [{ id: 'rack-1', promotoraId: 'alice' }, { id: 'own', tipo: 'propio' }];
const F = '2026-10-03T12:00:00.000Z';
const sale = (id, total, socio, extra = {}) => ({
  id, fecha: F, ubicacionId: 'rack-1', productoId: 'p1', promotoraId: 'alice', cantidad: 1, precioUnit: total,
  split: { montoComisionSocio: socio }, liquidada: false, ...extra
});
const base = (o = {}) => ({ ventas: [], ajustes: [], payouts: [], gastos: [], cartera: [], ubicaciones, ...o });
const lineSum = (e, acct, pid) => e.lines.filter(l => l.account === acct && (pid === undefined || l.personId === pid))
  .reduce((a, l) => a + l.debitCents - l.creditCents, 0);
const entryOf = (L, kind, id) => L.entries.filter(e => e.factKind === kind && e.factId === id);

test('regla 1: consignacion 130 con 85/15 -> Debe 1000, Haber 2000 y 4100', () => {
  const L = LG.buildLedger(base({ ventas: [sale('s1', 130, 110.5)] }));
  assert.equal(L.errors.length, 0);
  const [e] = entryOf(L, 'venta', 's1');
  assert.equal(lineSum(e, '1000'), 13000);
  assert.equal(lineSum(e, '2000', 'alice'), -11050);
  assert.equal(lineSum(e, '4100'), -1950);
});

test('regla 1: fiado va a 1100 en vez de 1000', () => {
  const L = LG.buildLedger(base({ ventas: [sale('s1', 130, 110.5, { fiado: true })] }));
  const [e] = entryOf(L, 'venta', 's1');
  assert.equal(lineSum(e, '1100'), 13000);
  assert.equal(lineSum(e, '1000'), 0);
});

test('regla 1: split.reparto reparte 2000 por persona y el resto a 4100', () => {
  const v = sale('s1', 100, 70, { split: { montoComisionSocio: 70, reparto: [{ promotoraId: 'alice', monto: 40 }, { promotoraId: 'bea', monto: 30 }] } });
  const L = LG.buildLedger(base({ ventas: [v] }));
  const [e] = entryOf(L, 'venta', 's1');
  assert.equal(lineSum(e, '2000', 'alice'), -4000);
  assert.equal(lineSum(e, '2000', 'bea'), -3000);
  assert.equal(lineSum(e, '4100'), -3000);
});

test('regla 1: impuesto incluido va a 2200 y sale de la comision de la casa', () => {
  const v = sale('s1', 112, 80, { impuesto: { tasa: 12, modo: 'incluido', monto: 12 } });
  const L = LG.buildLedger(base({ ventas: [v] }));
  const [e] = entryOf(L, 'venta', 's1');
  assert.equal(lineSum(e, '1000'), 11200);
  assert.equal(lineSum(e, '2200'), -1200);
  assert.equal(lineSum(e, '4100'), -2000);
});

test('regla 1: impuesto agregado suma al total cobrado', () => {
  const v = sale('s1', 100, 80, { impuesto: { tasa: 12, modo: 'agregado', monto: 12 } });
  const L = LG.buildLedger(base({ ventas: [v] }));
  const [e] = entryOf(L, 'venta', 's1');
  assert.equal(lineSum(e, '1000'), 11200);
  assert.equal(lineSum(e, '2200'), -1200);
  assert.equal(lineSum(e, '4100'), -2000);
});

test('regla 2: venta propia -> Haber 4000, sin 2000', () => {
  const v = { id: 'o1', fecha: F, ubicacionId: 'own', productoId: 'p2', cantidad: 2, precioUnit: 7.5, split: null };
  const L = LG.buildLedger(base({ ventas: [v] }));
  const [e] = entryOf(L, 'venta', 'o1');
  assert.equal(lineSum(e, '1000'), 1500);
  assert.equal(lineSum(e, '4000'), -1500);
  assert.equal(lineSum(e, '2000'), 0);
});

test('regla 3: venta anulada conserva el original y agrega reverso exacto con 4900', () => {
  const L = LG.buildLedger(base({ ventas: [sale('s1', 130, 110.5, { anulada: true })] }));
  const es = entryOf(L, 'venta', 's1');
  assert.equal(es.length, 2);
  const [orig, rev] = es;
  assert.equal(lineSum(orig, '4100'), -1950);
  assert.equal(lineSum(rev, '4900'), 1950);
  assert.equal(lineSum(rev, '2000', 'alice'), 11050);
  assert.equal(lineSum(rev, '1000'), -13000);
  assert.equal(L.balances.accounts['1000'].balanceCents, 0);
  assert.equal(L.balances.byPerson['alice'] || 0, 0);
});

test('regla 3: venta devuelta tambien se revierte', () => {
  const L = LG.buildLedger(base({ ventas: [sale('s1', 50, 40, { devuelta: true })] }));
  assert.equal(entryOf(L, 'venta', 's1').length, 2);
  assert.equal(L.balances.accounts['1000'].balanceCents, 0);
});

test('regla 4: ajuste negativo baja 2000 de la persona contra 4100', () => {
  const aj = { id: 'a1', ventaId: 's1', fecha: '2026-10-05T12:00:00.000Z', ubicacionId: 'rack-1', montoComisionSocio: -20 };
  const L = LG.buildLedger(base({ ventas: [sale('s1', 130, 110.5)], ajustes: [aj] }));
  const [e] = entryOf(L, 'ajuste', 'a1');
  assert.equal(lineSum(e, '2000', 'alice'), 2000);
  assert.equal(lineSum(e, '4100'), -2000);
});

test('regla 5: pago paid -> Debe 2000, Haber 1000; reverso y voided son inversos', () => {
  const v = [sale('s1', 130, 110.5)];
  const p = { id: 'p1', opId: 'o1', status: 'paid', payeeId: 'alice', amountCents: 11050, paidAt: '2026-10-06T10:00:00.000Z', items: [{ kind: 'sale', sourceId: 's1', payeeId: 'alice', amountCents: 11050 }] };
  let L = LG.buildLedger(base({ ventas: v, payouts: [p] }));
  const [e] = entryOf(L, 'pago', 'p1');
  assert.equal(lineSum(e, '2000', 'alice'), 11050);
  assert.equal(lineSum(e, '1000'), -11050);
  assert.equal(L.balances.byPerson.alice, 0);
  const rev = { ...p, id: 'p1r', opId: 'o1r', reversalOf: 'p1', paidAt: '2026-10-07T10:00:00.000Z' };
  L = LG.buildLedger(base({ ventas: v, payouts: [p, rev] }));
  assert.equal(L.balances.byPerson.alice, 11050);
  const vo = LG.buildLedger(base({ ventas: v, payouts: [{ ...p, status: 'voided' }] }));
  assert.equal(vo.balances.byPerson.alice, 11050);
  assert.equal(vo.errors.length, 0);
});

test('regla 6: gasto -> Debe 5000, Haber 1000', () => {
  const L = LG.buildLedger(base({ gastos: [{ id: 'g1', monto: 45.25, fecha: F, ubicacionId: 'own' }] }));
  const [e] = entryOf(L, 'gasto', 'g1');
  assert.equal(lineSum(e, '5000'), 4525);
  assert.equal(lineSum(e, '1000'), -4525);
});

test('regla 7: cobro de fiado -> Debe 1000, Haber 1100', () => {
  const L = LG.buildLedger(base({ cartera: [{ id: 'c1', tipo: 'abono', monto: 30, fecha: F, clienteId: 'k1' }] }));
  const [e] = entryOf(L, 'cobro', 'c1');
  assert.equal(lineSum(e, '1000'), 3000);
  assert.equal(lineSum(e, '1100'), -3000);
});

test('regla 8: la cuenta 2100 no se usa y no hay cuentas fuera del plan', () => {
  const L = LG.buildLedger(base({ ventas: [sale('s1', 130, 110.5)], gastos: [{ id: 'g1', monto: 1, fecha: F }] }));
  const ok = new Set(['1000', '1100', '2000', '2100', '2200', '4000', '4100', '4900', '5000']);
  L.entries.forEach(e => e.lines.forEach(l => assert.ok(ok.has(l.account) && l.account !== '2100')));
});

test('hecho sin importe va a errors, no se descarta en silencio', () => {
  const L = LG.buildLedger(base({ ventas: [{ id: 'x', fecha: F, ubicacionId: 'own', cantidad: 1, precioUnit: 0, split: null }] }));
  assert.equal(L.errors.length, 1);
  assert.equal(L.errors[0].factId, 'x');
  assert.ok(L.errors[0].motivo);
});

/* Escenario completo para invariantes */
function escenario() {
  const ventas = [
    sale('s1', 130, 110.5), sale('s2', 100, 70, { split: { montoComisionSocio: 70, reparto: [{ promotoraId: 'alice', monto: 40 }, { promotoraId: 'bea', monto: 30 }] } }),
    sale('s3', 33.33, 28.33, { fiado: true }), sale('s4', 50, 40, { anulada: true }),
    sale('s5', 80, 60, { liquidada: true, fecha: '2026-10-01T12:00:00.000Z' }),
    { id: 'o1', fecha: F, ubicacionId: 'own', cantidad: 1, precioUnit: 9.99, split: null }
  ];
  const ajustes = [{ id: 'a1', ventaId: 's1', fecha: '2026-10-05T12:00:00.000Z', ubicacionId: 'rack-1', montoComisionSocio: -20 }];
  const payouts = [{ id: 'p1', opId: 'o1', status: 'paid', payeeId: 'alice', amountCents: 5000, paidAt: '2026-10-06T10:00:00.000Z', items: [{ kind: 'sale', sourceId: 's1', payeeId: 'alice', amountCents: 5000 }] }];
  const gastos = [{ id: 'g1', monto: 12, fecha: F }];
  const cartera = [{ id: 'c1', tipo: 'abono', monto: 10, fecha: F, clienteId: 'k' }];
  return base({ ventas, ajustes, payouts, gastos, cartera });
}

test('(a) cada asiento suma cero', () => {
  const L = LG.buildLedger(escenario());
  assert.equal(L.errors.length, 0);
  assert.ok(L.entries.length > 6);
  L.entries.forEach(e => {
    const d = e.lines.reduce((a, l) => a + l.debitCents, 0), c = e.lines.reduce((a, l) => a + l.creditCents, 0);
    assert.equal(d, c, e.id);
    e.lines.forEach(l => { assert.ok(Number.isInteger(l.debitCents) && Number.isInteger(l.creditCents)); assert.ok(l.debitCents >= 0 && l.creditCents >= 0); });
  });
});

test('(b) saldo de 2000 por persona = balancesByPayee.dueCents al centavo', () => {
  const inp = escenario();
  const L = LG.buildLedger(inp);
  const rows = PL.balancesByPayee({ sales: inp.ventas, adjustments: inp.ajustes, locations: inp.ubicaciones, payouts: inp.payouts });
  assert.ok(rows.length >= 2);
  rows.forEach(r => assert.equal(L.balances.byPerson[r.payeeId] || 0, r.dueCents, r.payeeId));
});

test('(c) Ganado - Pagado +/- ajustes = Pendiente', () => {
  const inp = escenario();
  const L = LG.buildLedger(inp);
  let ganado = 0, pagado = 0, ajus = 0;
  L.entries.forEach(e => e.lines.filter(l => l.account === '2000').forEach(l => {
    const cr = l.creditCents - l.debitCents;
    if (e.factKind === 'venta') ganado += cr; else if (e.factKind === 'ajuste') ajus += cr; else pagado -= cr;
  }));
  const pend = Object.values(L.balances.byPerson).reduce((a, b) => a + b, 0);
  assert.equal(ganado + ajus - pagado, pend);
  const rows = PL.balancesByPayee({ sales: inp.ventas, adjustments: inp.ajustes, locations: inp.ubicaciones, payouts: inp.payouts });
  assert.equal(pend, rows.reduce((a, r) => a + r.dueCents, 0));
});

test('(d) determinista: otro orden de hechos, mismo libro', () => {
  const inp = escenario();
  const rev = { ...inp, ventas: [...inp.ventas].reverse(), ajustes: [...inp.ajustes].reverse(), payouts: [...inp.payouts].reverse(), gastos: [...inp.gastos].reverse(), cartera: [...inp.cartera].reverse() };
  assert.deepEqual(LG.buildLedger(rev), LG.buildLedger(inp));
});

test('(e) idempotente: hecho repetido (mismo id u opId) no duplica asientos', () => {
  const inp = escenario();
  const dup = { ...inp, ventas: [...inp.ventas, inp.ventas[0]], gastos: [...inp.gastos, inp.gastos[0]], cartera: [...inp.cartera, inp.cartera[0]],
    payouts: [...inp.payouts, { ...inp.payouts[0], id: 'p1-otra-copia' }] };
  const a = LG.buildLedger(inp), b = LG.buildLedger(dup);
  assert.equal(b.entries.length, a.entries.length);
  assert.deepEqual(b.balances, a.balances);
});

test('puro: no muta la entrada', () => {
  const inp = escenario(); const s = JSON.stringify(inp);
  LG.buildLedger(inp);
  assert.equal(JSON.stringify(inp), s);
});
