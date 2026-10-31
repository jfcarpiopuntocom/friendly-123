'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {compareReplicas}=require('../lab/stock-journal/forensic-reconciliation.cjs');
const book='SYNTHETIC-NO-CLIENTS';
const event=(device,seq,kind,qty,extra={})=>({
 id:device+':'+seq,device,seq,kind,qty,notebook:book,product:'synthetic-product',...extra});
const base=event('base',1,'OPEN',10);
const order=event('pc',1,'ORDER',2,{orderId:'synthetic-order'});
const inbound=event('phone',1,'RECEIVE',1);
const delivered=event('pwa',1,'FULFILL',1,{orderId:'synthetic-order'});
const replica=(device,events)=>({device,notebook:book,events});
test('MDD: distinct PC/Safari/PWA displays remain forensic until missing valid events replay',()=>{
 const before=compareReplicas({notebook:book,replicas:[
  replica('pc',[base,order]),replica('safari',[base,inbound]),replica('pwa',[base]) ]});
 assert.equal(before.devices,3);
 assert.equal(before.allReplicasHaveSameFacts,false);
 assert.equal(before.comparable,false);
 assert.deepEqual(before.views.map(x=>x.missingCount),[1,1,2]);
 assert.equal(before.canAutoMigrate,false);
 const events=[delivered,base,inbound,order];
 const after=compareReplicas({notebook:book,replicas:[
  replica('pc',events),replica('safari',[...events].reverse()),
  replica('pwa',[base,inbound,order,delivered]) ]});
 assert.equal(after.uniqueEventCount,4);
 assert.equal(after.allReplicasHaveSameFacts,true);
 assert.equal(after.allProductsTrustworthy,true);
 assert.equal(after.comparable,true);
 assert.equal(after.physical[0].physicalStock,10,
  '10 is computed from an opening 10, receipt 1 and fulfillment 1, never a fixed setpoint');
 assert.equal(after.canAutoMigrate,false,'even synthetic convergence never authorizes real migration');
});
test('MDD: equal displayed stock in two independent epochs cannot prove one causal history',()=>{
 const old=event('pc',1,'OPEN',7),independent=event('phone',1,'OPEN',7);
 const r=compareReplicas({notebook:book,replicas:[
  replica('pc',[old,independent]),replica('safari',[independent,old]) ]});
 assert.equal(r.allReplicasHaveSameFacts,true);
 assert.equal(r.allProductsTrustworthy,false);
 assert.equal(r.comparable,false);
 assert.equal(r.physical[0].physicalStock,null);
 assert.equal(r.physical[0].trust,'needs-reconciliation');
});
test('MDD: event ID with divergent payload cannot be silently deduplicated',()=>{
 const original=event('pc',1,'RECEIVE',2),conflicting={...original,qty:3};
 const r=compareReplicas({notebook:book,replicas:[
  replica('pc',[base,original]),replica('phone',[base,conflicting]) ]});
 assert.equal(r.comparable,false);
 assert.equal(r.conflictingEventDigests.length,1);
 assert.equal(r.canAlterProduction,false);
});
test('MDD: reports redact names, device IDs, PIN-like strings and photographs',()=>{
 const facts=[base,order,inbound,delivered];
 const r=compareReplicas({notebook:book,replicas:[
  replica('PRIVATE-PC-DEVICE',facts),replica('PRIVATE-MOBILE-DEVICE',facts)]});
 const raw=JSON.stringify(r);
 for(const secret of [book,'PRIVATE-PC-DEVICE','PRIVATE-MOBILE-DEVICE','synthetic-product','synthetic-order'])
  assert.equal(raw.includes(secret),false);
});
test('MDD: reject cross-shop and malformed customer-bearing event without side effects',()=>{
 assert.throws(()=>compareReplicas({notebook:book,replicas:[
  replica('pc',[base]),{device:'phone',notebook:'other-shop',events:[base]}]}),/cross-notebook/);
 assert.throws(()=>compareReplicas({notebook:book,replicas:[
  replica('pc',[base]),replica('phone',[{...inbound,pin:'NOT-ALLOWED'}])]}),/unexpected event field/);
 assert.throws(()=>compareReplicas({notebook:book,replicas:[
  replica('same-device',[base]),replica('same-device',[base])]}),/duplicate device/);
});
