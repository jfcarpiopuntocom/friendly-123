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
