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

test('three browsers converge after out-of-order and repeated deliveries, then an offline fulfilment',()=>{
  const pc=device(),safari=device(),pwa=device();
  for(const j of [pc,safari,pwa]) assert.equal(j.append(OPEN).ok,true);
  const restock=e('adjust:pc:1','pc',1,'ADJUST',undefined,{delta:2});
  delete restock.qty; // ADJUST has a delta, never a qty
  const orderPhone=e('order:phone:2','phone',11,'ORDER',1,{orderId:'sale:phone:2'});
  const shipPhone=e('ship:phone:2','phone',12,'FULFILL',1,{orderId:'sale:phone:2'});
  const preOrder=e('order:pwa:3','pwa',1,'ORDER',3,{orderId:'sale:pwa:3'});
  pc.append(restock);safari.append(orderPhone);safari.append(shipPhone);pwa.append(preOrder);
  assert.equal(pc.project(product).onHand,9);
  assert.equal(safari.project(product).onHand,6);
  assert.equal(pwa.project(product).onHand,7);
  const packets=[pc.export().events,safari.export().events,pwa.export().events];
  // Simulate a partial outage, arbitrary delivery order, duplicated envelopes,
  // and each browser receiving its own previously acknowledged operations.
  for(const j of [pwa,pc,safari]){
    for(const data of packets.slice().reverse()) {
      assert.equal(j.merge(data.slice().reverse()).ok,true);
      assert.equal(j.merge(data).ok,true);
    }
  }
  const projected=[pc,safari,pwa].map(j=>j.project(product));
  for(const view of projected){
    assert.equal(view.trust,'verified');
    assert.equal(view.onHand,8); // opening 7 + restock 2 - physical delivery 1
    assert.equal(view.unfulfilled,3); // PWA preorder is NOT yet delivery
    assert.equal(view.available,5);
  }
  assert.deepEqual(projected[0],projected[1]);
  assert.deepEqual(projected[1],projected[2]);
  // All devices reboot independently; replays remain exactly-once.
  const restarted=[pc,safari,pwa].map(j=>{
    const instance=device();assert.equal(instance.import(j.export()).ok,true);return instance;
  });
  const fulfillment=e('ship:pwa:3','pwa',2,'FULFILL',3,{orderId:'sale:pwa:3'});
  assert.equal(restarted[2].append(fulfillment).ok,true);
  for(const j of restarted){
    assert.equal(j.merge(restarted[2].export().events).ok,true);
    assert.equal(j.merge(restarted[2].export().events).ok,true);
    assert.equal(j.project(product).onHand,5);
    assert.equal(j.project(product).unfulfilled,0);
  }
  assert.deepEqual(restarted[0].project(product),restarted[1].project(product));
  assert.deepEqual(restarted[1].project(product),restarted[2].project(product));
});
test('mixed-license replay is atomic; a conflicting event quarantines evidence rather than overwriting stock',()=>{
  const valid=device(),alien=new Journal('synthetic-another-license');
  valid.append(OPEN);
  alien.append({...OPEN,notebook:'synthetic-another-license'});
  const before=JSON.stringify(valid.export());
  const increment=e('adjust:pc:unique','pc',1,'ADJUST',undefined,{delta:1});
  delete increment.qty;
  const foreign={...increment,id:'foreign:1',notebook:'synthetic-another-license',device:'foreign'};
  assert.throws(()=>valid.merge([increment,foreign]),/cross-notebook event refused/);
  assert.equal(JSON.stringify(valid.export()),before);
  assert.equal(valid.project(product).onHand,7);
  assert.equal(valid.append(increment).ok,true);
  const collision={...increment,delta:-5}; // same opId, incompatible immutable payload
  assert.deepEqual(valid.append(collision),{ok:false,reason:'id-collision',id:increment.id});
  assert.equal(valid.project(product).onHand,null);
  assert.equal(valid.project(product).trust,'needs-reconciliation');
  const after=device();
  assert.equal(after.import(valid.export()).ok,true);
  assert.equal(after.project(product).onHand,null);
  assert.equal(after.export().quarantine.length,1);
});
