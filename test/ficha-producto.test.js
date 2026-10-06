/* Ficha de producto: proyeccion pura OCLedger.productSheet. Centavos enteros. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const LG = require('../docs/core/ledger.js');

const ubicaciones = [{ id: 'r1', promotoraId: 'ana' }, { id: 'r2', promotoraId: 'bea' }];
const F = '2026-10-03T12:00:00.000Z';
const sale = (id, loc, who, total, socio, extra = {}) => ({
  id, fecha: F, ubicacionId: loc, productoId: 'p1', promotoraId: who, cantidad: 1, precioUnit: total,
  split: { montoComisionSocio: socio }, liquidada: false, ...extra
});
const payout = (id, who, items, extra = {}) => ({
  id, opId: id, status: 'paid', payeeId: who, amountCents: items.reduce((a, i) => a + i.amountCents, 0),
  paidAt: F, items: items.map(i => ({ kind: 'sale', payeeId: who, ...i })), ...extra
});
const run = (ventas, payouts = [], productId = 'p1') => {
  const ledger = LG.buildLedger({ ventas, ajustes: [], payouts, gastos: [], cartera: [], ubicaciones });
  return LG.productSheet({ ledger, payouts, sales: ventas, productId });
};
const person = (s, id) => s.people.find(p => p.personId === id);

test('producto vendido por 2 personas en 2 racks', () => {
  const s = run([sale('s1', 'r1', 'ana', 100, 40), sale('s2', 'r2', 'bea', 50, 20)]);
  assert.equal(s.units, 2);
  assert.equal(s.grossCents, 15000);
  assert.equal(s.returnsCents, 0);
  assert.deepEqual(s.locations.slice().sort(), ['r1', 'r2']);
  assert.deepEqual(s.people.map(p => [p.personId, p.earnedCents, p.paidCents, p.dueCents]), [['ana', 4000, 0, 4000], ['bea', 2000, 0, 2000]]);
  assert.deepEqual(s.totals, { earnedCents: 6000, paidCents: 0, dueCents: 6000 });
});

test('pago parcial: earned - paid = due, solo cuenta ventas de ese producto', () => {
  const v = [sale('s1', 'r1', 'ana', 100, 40), sale('s2', 'r2', 'bea', 50, 20), sale('x', 'r1', 'ana', 10, 4, { productoId: 'p2' })];
  const pays = [payout('o1', 'ana', [{ sourceId: 's1', amountCents: 1500 }, { sourceId: 'x', amountCents: 400 }])];
  const s = run(v, pays);
  const a = person(s, 'ana');
  assert.equal(a.earnedCents, 4000);
  assert.equal(a.paidCents, 1500);
  assert.equal(a.dueCents, 2500);
  assert.deepEqual(s.totals, { earnedCents: 6000, paidCents: 1500, dueCents: 4500 });
});

test('venta devuelta: va a returnsCents y no genera ganancia neta', () => {
  const s = run([sale('s1', 'r1', 'ana', 100, 40), sale('s2', 'r2', 'bea', 50, 20, { devuelta: true })]);
  assert.equal(s.units, 1);
  assert.equal(s.grossCents, 10000);
  assert.equal(s.returnsCents, 5000);
  assert.equal(person(s, 'bea').earnedCents, 0);
  assert.equal(s.totals.earnedCents, 4000);
});

test('pago anulado o revertido no cuenta como pagado', () => {
  const v = [sale('s1', 'r1', 'ana', 100, 40)];
  const voided = payout('o1', 'ana', [{ sourceId: 's1', amountCents: 1000 }], { status: 'voided' });
  assert.equal(run(v, [voided]).totals.paidCents, 0);
  const pay = payout('o2', 'ana', [{ sourceId: 's1', amountCents: 1000 }]);
  const rev = payout('o3', 'ana', [{ sourceId: 's1', amountCents: 1000 }], { reversalOf: 'o2' });
  assert.equal(run(v, [pay, rev]).totals.paidCents, 0);
});

test('producto sin ventas: hoja vacia', () => {
  const s = run([sale('s1', 'r1', 'ana', 100, 40)], [], 'nada');
  assert.equal(s.units, 0); assert.deepEqual(s.people, []); assert.deepEqual(s.totals, { earnedCents: 0, paidCents: 0, dueCents: 0 });
});

/* ---- v454: pagar SOLO un producto (planPayout.sourceIds) ---- */
const PL = require('../docs/core/payout-ledger.js');
const saleB = (id, who, total, socio) => sale(id, 'r1', who, total, socio, { productoId: 'p2' });
const planInput = (ventas, payouts, extra = {}) => ({ sales: ventas, adjustments: [], locations: ubicaciones, payouts, month: '', payeeId: 'ana', ...extra });

test('sourceIds: pagar el producto A deja el B intacto al centavo', () => {
  const v = [sale('a1', 'r1', 'ana', 100, 40), saleB('b1', 'ana', 50, 20)];
  const plan = PL.planPayout(planInput(v, [], { opId: 'op-a', id: 'pay-a', sourceIds: ['a1'] }));
  assert.equal(plan.payout.amountCents, 4000);
  assert.deepEqual(plan.payout.items.map(i => [i.sourceId, i.amountCents]), [['a1', 4000]]);
  const after = PL.balancesByPayee({ sales: v, adjustments: [], locations: ubicaciones, payouts: [plan.payout] });
  assert.equal(after[0].dueCents, 2000); // B sigue debiendo 20.00
  const soloB = PL.balancesByPayee({ sales: v, adjustments: [], locations: ubicaciones, payouts: [plan.payout], sourceIds: ['b1'] });
  assert.equal(soloB[0].dueCents, 2000);
});

test('sourceIds: pago parcial y no se puede pagar mas que lo debido del producto', () => {
  const v = [sale('a1', 'r1', 'ana', 100, 40), saleB('b1', 'ana', 50, 20)];
  const parcial = PL.planPayout(planInput(v, [], { opId: 'op-1', id: 'p1', sourceIds: ['a1'], amountCents: 1500 }));
  assert.equal(parcial.payout.amountCents, 1500);
  const resto = PL.planPayout(planInput(v, [parcial.payout], { opId: 'op-2', id: 'p2', sourceIds: ['a1'] }));
  assert.equal(resto.payout.amountCents, 2500);
  const demasiado = PL.planPayout(planInput(v, [], { opId: 'op-3', id: 'p3', sourceIds: ['a1'], amountCents: 4001 }));
  assert.equal(demasiado.status, 409); // tiene 60.00 en total, pero el producto solo debe 40.00
});

test('sourceIds: reintento con el mismo opId es idempotente', () => {
  const v = [sale('a1', 'r1', 'ana', 100, 40)];
  const p1 = PL.planPayout(planInput(v, [], { opId: 'op-x', id: 'p1', sourceIds: ['a1'] })).payout;
  const again = PL.planPayout(planInput(v, [p1], { opId: 'op-x', id: 'p2', sourceIds: ['a1'] }));
  assert.equal(again.existing, true);
});

test('sin sourceIds todo igual que antes (compatibilidad)', () => {
  const v = [sale('a1', 'r1', 'ana', 100, 40), saleB('b1', 'ana', 50, 20)];
  assert.equal(PL.planPayout(planInput(v, [], { opId: 'op-all', id: 'p9' })).payout.amountCents, 6000);
});

test('productSheet.people[].bySale desglosa por venta y percha', () => {
  const s = run([sale('s1', 'r1', 'ana', 100, 40), sale('s2', 'r2', 'ana', 50, 20)], [payout('o1', 'ana', [{ sourceId: 's1', amountCents: 1500 }])]);
  assert.deepEqual(person(s, 'ana').bySale, [
    { saleId: 's1', locationId: 'r1', earnedCents: 4000, paidCents: 1500, dueCents: 2500 },
    { saleId: 's2', locationId: 'r2', earnedCents: 2000, paidCents: 0, dueCents: 2000 }]);
});
