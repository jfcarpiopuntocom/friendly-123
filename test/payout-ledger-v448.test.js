const { test } = require('node:test');
const assert = require('node:assert/strict');
const L = require('../docs/core/payout-ledger.js');

const locations = [{ id:'rack-1', promotoraId:'alice' }];
const sale = (id, amount, extra={}) => ({
  id, fecha:'2026-10-03T12:00:00.000Z', ubicacionId:'rack-1', promotoraId:'alice',
  split:{ montoComisionSocio:amount }, liquidada:false, ...extra
});

test('Payout Ledger: computes exact cents and one payee due without mutating sales', () => {
  const sales=[sale('s1', 10.005), sale('s2', 20)];
  const before=JSON.stringify(sales);
  const rows=L.balancesByPayee({sales,adjustments:[],locations,payouts:[],month:'2026-10',locationId:'rack-1'});
  assert.equal(rows.length,1);
  assert.equal(rows[0].payeeId,'alice');
  assert.equal(rows[0].dueCents,3001);
  assert.equal(JSON.stringify(sales),before);
});

test('Payout Ledger: legacy liquidada remains paid without inventing a payout', () => {
  const sales=[sale('s1', 15,{liquidada:true})];
  const rows=L.balancesByPayee({sales,adjustments:[],locations,payouts:[],month:'2026-10',locationId:'rack-1'});
  assert.equal(rows[0].earnedCents,1500);
  assert.equal(rows[0].paidCents,1500);
  assert.equal(rows[0].dueCents,0);
});

test('Payout Ledger: same opId is idempotent', () => {
  const sales=[sale('s1', 25)];
  const input={sales,adjustments:[],locations,payouts:[],month:'2026-10',locationId:'rack-1',
    payeeId:'alice',opId:'pay-op-1',id:'pay-1',method:'transferencia',paidAt:'2026-10-05T20:00:00.000Z'};
  const first=L.planPayout(input);
  assert.equal(first.payout.amountCents,2500);
  const second=L.planPayout({...input,payouts:[first.payout],id:'pay-2'});
  assert.equal(second.existing,true);
  assert.equal(second.payout.id,'pay-1');
});

test('Payout Ledger: paid payout removes due but preserves earned history', () => {
  const sales=[sale('s1', 25)];
  const p=L.planPayout({sales,adjustments:[],locations,payouts:[],month:'2026-10',locationId:'rack-1',
    payeeId:'alice',opId:'pay-op-1',id:'pay-1',method:'efectivo',paidAt:'2026-10-05T20:00:00.000Z'}).payout;
  const row=L.balancesByPayee({sales,adjustments:[],locations,payouts:[p],month:'2026-10',locationId:'rack-1'})[0];
  assert.equal(row.earnedCents,2500);
  assert.equal(row.dueCents,0);
});

test('Payout Ledger: a post-payment negative adjustment reduces the next cash payout', () => {
  const sales=[sale('s1', 100,{liquidada:true}), sale('s2', 50)];
  const adjustments=[{id:'a1',ventaId:'s1',fecha:'2026-10-05T12:00:00.000Z',ubicacionId:'rack-1',montoComisionSocio:-20,liquidada:false}];
  const row=L.balancesByPayee({sales,adjustments,locations,payouts:[],month:'2026-10',locationId:'rack-1'})[0];
  assert.equal(row.dueCents,3000);
  const p=L.planPayout({sales,adjustments,locations,payouts:[],month:'2026-10',locationId:'rack-1',
    payeeId:'alice',opId:'pay-op-offset',id:'pay-offset',method:'transferencia',paidAt:'2026-10-05T20:00:00.000Z'}).payout;
  assert.equal(p.amountCents,3000);
  assert.ok(p.items.some(x=>x.kind==='adjustment' && x.offset===true));
});

test('Payout Ledger: two payees remain separate even inside the same sale', () => {
  const sales=[sale('s1', 100,{split:{montoComisionSocio:100,reparto:[
    {promotoraId:'alice',monto:60},{promotoraId:'bob',monto:40}
  ]}})];
  const rows=L.balancesByPayee({sales,adjustments:[],locations,payouts:[],month:'2026-10',locationId:'rack-1'});
  assert.equal(rows.length,2);
  assert.equal(rows.find(x=>x.payeeId==='alice').dueCents,6000);
  assert.equal(rows.find(x=>x.payeeId==='bob').dueCents,4000);
});

test('Payout Ledger v1 refuses ambiguous partial cash recording instead of silently lying', () => {
  const sales=[sale('s1', 25)];
  const r=L.planPayout({sales,adjustments:[],locations,payouts:[],month:'2026-10',locationId:'rack-1',
    payeeId:'alice',opId:'pay-partial',id:'pay-partial',amountCents:1000,method:'efectivo'});
  assert.equal(r.status,409);
  assert.match(r.error,/full current amount due/i);
});


test('Payout Ledger: a reversal reopens the exact obligation while legacy liquidada stays only a compatibility flag', () => {
  const sales=[sale('s1',25,{liquidada:true})];
  const p=L.planPayout({sales:[sale('s1',25)],adjustments:[],locations,payouts:[],month:'2026-10',locationId:'rack-1',
    payeeId:'alice',opId:'pay-rev-base',id:'pay-rev-base',method:'efectivo',paidAt:'2026-10-05T20:00:00.000Z'}).payout;
  const reversal={...p,id:'rev-1',opId:'reverse:pay-rev-base',reversalOf:p.id,type:'reversal'};
  const row=L.balancesByPayee({sales,adjustments:[],locations,payouts:[p,reversal],month:'2026-10',locationId:'rack-1'})[0];
  assert.equal(row.dueCents,2500);
});


test('Payout Ledger: partial payout records exact cash and leaves the remainder due', () => {
  const sales = [sale('s-part-1',40), sale('s-part-2',35)];
  const input = { sales, adjustments:[], locations, payouts:[], month:'2026-10', locationId:'rack-1' };
  const plan = L.planPayout({ ...input, payeeId:'alice', opId:'partial-1', id:'pay-part-1', amountCents:2500, method:'transferencia' });
  assert.equal(plan.error, undefined);
  assert.equal(plan.payout.amountCents,2500);
  assert.equal(plan.payout.amount,25);
  const after = L.balancesByPayee({ ...input, payouts:[plan.payout] }).find(x => x.payeeId === 'alice');
  assert.equal(after.paidCents,2500);
  assert.equal(after.dueCents,5000);
});

test('Payout Ledger: partial payout cannot exceed the amount due', () => {
  const sales = [sale('s-overpay',40)];
  const input = { sales, adjustments:[], locations, payouts:[], month:'2026-10', locationId:'rack-1' };
  const plan = L.planPayout({ ...input, payeeId:'alice', opId:'overpay-1', id:'pay-overpay-1', amountCents:4001, method:'efectivo' });
  assert.equal(plan.status,409);
  assert.match(plan.error,/exceed/i);
});
