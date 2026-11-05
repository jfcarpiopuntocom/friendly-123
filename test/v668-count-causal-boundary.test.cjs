'use strict';
// Physical-count causality: the correct figure depends on observed event IDs,
// not the order in which a wall-clock or whole-product snapshot arrives.
const {test}=require('node:test'),assert=require('node:assert/strict');
const {Journal}=require('../lab/stock-journal/engine.cjs');
const book='V668-SYNTHETIC-COUNT-FRONTIER';
function event(device,seq,kind,qty,extra={}) {
  return {id:device+'-'+seq,device,seq,kind,qty,notebook:book,
    product:'fictive-product',...extra};
}
const open=event('origin',1,'OPEN',9);
const orderPc=event('pc',1,'ORDER',2,{orderId:'sale-pc'});
const salePc=event('pc',2,'FULFILL',2,{orderId:'sale-pc'});
const orderPhone=event('phone',1,'ORDER',1,{orderId:'sale-phone'});
const salePhone=event('phone',2,'FULFILL',1,{orderId:'sale-phone',afterCountId:'count-1'});
function run(events) {const j=new Journal(book);const merged=j.merge(events);assert.ok(merged.ok);return j.project('fictive-product');}

test('sequential: count witnessed PC sale -> base 5 absorbs it, later phone sale produces 4',()=>{
  const count=event('count',1,'COUNT',5,{observes:[open.id,salePc.id],supersedes:[]});
  const p=run([open,orderPc,salePc,orderPhone,count,salePhone]);
  assert.equal(p.trust,'verified'); assert.equal(p.onHand,4);
});
test('causal after-count: both sales happened after count -> 5 - 2 - 1 = 2',()=>{
  const count=event('count',1,'COUNT',5,{observes:[open.id],supersedes:[]});
  const pcAfter={...salePc,afterCountId:count.id};
  const p=run([salePhone,orderPhone,open,count,orderPc,pcAfter]);
  assert.equal(p.trust,'verified'); assert.equal(p.onHand,2);
});
test('concurrent unknown: a missing causal edge cannot be guessed as 2 or 4',()=>{
  const count=event('count',1,'COUNT',5,{observes:[open.id],supersedes:[]});
  const p=run([open,orderPc,salePc,orderPhone,count,salePhone]);
  assert.equal(p.trust,'needs-reconciliation');assert.equal(p.onHand,null);
  assert.ok(p.issues.some(s=>s.includes('unresolved-concurrent-physical:')));
});
