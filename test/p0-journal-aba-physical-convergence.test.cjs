'use strict';
// Exact v633 shape: equal displayed number does not establish a common epoch.
// Shadow journal never writes business data or interprets cash receipts as stock.
const {test}=require('node:test'),assert=require('node:assert/strict');
const {Journal}=require('../lab/stock-journal/engine.cjs');
const notebook='synthetic-one-shop-not-a-real-license',product='synthetic-book';
const e=(id,device,seq,kind,qty,extra={})=>({id,device,seq,kind,qty,
  notebook,product,...extra});
function device(){return new Journal(notebook)}
const OPEN=e('opening:verified','counter',1,'OPEN',7);
const order=e('order:phone:1','phone',1,'ORDER',1,{orderId:'sale:phone:1'});
const sale=e('fulfill:phone:1','phone',2,'FULFILL',1,{orderId:'sale:phone:1'});
test('two screenshots equal, then real B movement, then A sync, then restart: both converge causally',()=>{
  const pc=device(),phone=device();
  pc.append(OPEN);phone.append(OPEN);
  assert.equal(pc.project(product).onHand,7);
  assert.equal(phone.project(product).onHand,7);
  phone.append(order);phone.append(sale);
  assert.equal(phone.project(product).onHand,6);
  assert.equal(pc.project(product).onHand,7);
  const packet=phone.export().events;
  pc.merge(packet);pc.merge(packet); // duplicate relay replay never repeats sale
  assert.equal(pc.project(product).onHand,6);
  assert.equal(phone.project(product).onHand,6);
  const restoredPC=device(),restoredPhone=device();
  restoredPC.import(pc.export());restoredPhone.import(phone.export());
  assert.deepEqual(restoredPC.project(product),restoredPhone.project(product));
  assert.equal(restoredPC.project(product).onHand,6);
  // An additional change in A is visible in B, no fixed target count.
  const nextOrder=e('order:pc:1','pc',1,'ORDER',1,{orderId:'sale:pc:1'});
  const nextFulfill=e('fulfill:pc:1','pc',2,'FULFILL',1,{orderId:'sale:pc:1'});
  restoredPC.append(nextOrder);restoredPC.append(nextFulfill);
  restoredPhone.merge(restoredPC.export().events);
  assert.equal(restoredPhone.project(product).onHand,5);
  assert.deepEqual(restoredPC.project(product),restoredPhone.project(product));
});
test('two independent same-number counts cannot rewrite physical history as a single epoch',()=>{
  const pc=device(),phone=device(),shared=device();
  for(const j of [pc,phone,shared])j.append(OPEN);
  pc.append(e('count:pc','pc',1,'COUNT',7,{observes:['opening:verified'],supersedes:[]}));
  phone.append(e('count:phone','phone',1,'COUNT',7,{observes:['opening:verified'],supersedes:[]}));
  shared.merge(pc.export().events);shared.merge(phone.export().events);
  assert.equal(shared.project(product).onHand,null);
  assert.equal(shared.project(product).trust,'needs-reconciliation');
  assert.ok(shared.project(product).issues.includes('concurrent-counts'));
});
test('offline order and partial payment do not move physical stock until fulfillment',()=>{
  const a=device(),b=device();a.append(OPEN);b.append(OPEN);
  const prepaid=e('order:b','phone',1,'ORDER',2,{orderId:'sale:preorder'});
  b.append(prepaid);a.merge(b.export().events);
  assert.equal(a.project(product).onHand,7);
  assert.equal(b.project(product).onHand,7);
  assert.throws(()=>b.append(e('payment:b','phone',2,'PAYMENT',1,{orderId:'sale:preorder'})),/unknown event kind/);
  b.append(e('delivered:b','phone',2,'FULFILL',2,{orderId:'sale:preorder'}));
  a.merge(b.export().events);
  assert.equal(a.project(product).onHand,5);
  assert.equal(b.project(product).onHand,5);
});