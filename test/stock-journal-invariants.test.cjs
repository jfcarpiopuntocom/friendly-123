'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {Journal}=require('../lab/stock-journal/engine.cjs');
const BOOK='fixture-only-not-a-real-license';
function event(device,seq,kind,product,qty,extra={}) {
 return {id:device+':'+seq,notebook:BOOK,device,seq,kind,product,qty,...extra};
}
function init(id='cream',qty=1) {
 const j=new Journal(BOOK);
 assert.equal(j.append(event('base',1,'OPEN',id,qty)).ok,true);
 return j;
}
function state(j,p='cream'){return j.project(p);}
test('opening stock + independent +3 is deterministic and deduplicated',()=>{
 const a=init('cream',15),add=event('pc',1,'RECEIVE','cream',3);
 assert.equal(a.append(add).added,1);assert.equal(a.append(add).duplicate,1);
 assert.equal(a.project('cream').onHand,18);
 assert.equal(a.project('cream').facts,2);
});
test('event ID with a different payload is quarantined without overwriting fact',()=>{
 const a=init('cream',15),e=event('pc',1,'RECEIVE','cream',3);
 a.append(e);const altered={...e,qty:5};
 const r=a.append(altered);
 assert.equal(r.ok,false);assert.equal(r.reason,'id-collision');
 assert.equal(a.size,2);assert.equal(state(a).onHand,null);
 assert.ok(state(a).issues.includes('quarantined-id-collision'));
});
test('device sequence reused with another ID is quarantined',()=>{
 const a=init(),e=event('pc',1,'RECEIVE','cream',3);
 a.append(e);
 const r=a.append({...e,id:'pc:NEW'});
 assert.equal(r.reason,'sequence-collision');assert.equal(a.size,2);
});
test('different conflicting legacy openings are NEVER selected by wall clock',()=>{
 const a=init('cream',15);
 a.append(event('phone',1,'OPEN','cream',13));
 const s=state(a);
 assert.equal(s.trust,'needs-reconciliation');
 assert.equal(s.onHand,null);
 assert.ok(s.issues.includes('multiple-opening-epochs'));
});
test('two concurrent +3 from different devices commute, no duplicate on replay',()=>{
 const op=event('base',1,'OPEN','cream',12);
 const A=event('pc',1,'RECEIVE','cream',3),B=event('phone',1,'RECEIVE','cream',3);
 const x=new Journal(BOOK),y=new Journal(BOOK);
 x.merge([op,A,B,A]); y.merge([B,op,A,B]);
 assert.deepEqual(state(x),state(y));
 assert.equal(state(x).onHand,18);
});
test('physical one, TWO offline orders: both saved, one preorder, no double physical decrement',()=>{
 const base=event('base',1,'OPEN','cream',1);
 const A=event('pc',1,'ORDER','cream',1,{orderId:'sale:1:line:1'});
 const B=event('phone',1,'ORDER','cream',1,{orderId:'sale:2:line:1'});
 const pc=new Journal(BOOK),phone=new Journal(BOOK);
 pc.merge([base,A]);phone.merge([base,B]);
 assert.equal(state(pc).preorder,0);assert.equal(state(phone).preorder,0);
 pc.merge(phone.export().events);phone.merge(pc.export().events);
 for(const j of [pc,phone]){
   const s=state(j);
   assert.equal(s.onHand,1);assert.equal(s.unfulfilled,2);
   assert.equal(s.reserved,1);assert.equal(s.preorder,1);
   assert.equal(s.available,0);assert.equal(s.orders,2);
 }
});
test('receive after preorder: allocate to commitments FIRST, not free inventory and not delivered',()=>{
 const j=init('cream',1);
 j.append(event('pc',1,'ORDER','cream',1,{orderId:'sale:1:line:1'}));
 j.append(event('phone',1,'ORDER','cream',1,{orderId:'sale:2:line:1'}));
 j.append(event('supplier',1,'RECEIVE','cream',1));
 const s=state(j);
 assert.equal(s.onHand,2);assert.equal(s.unfulfilled,2);
 assert.equal(s.preorder,0);assert.equal(s.reserved,2);assert.equal(s.available,0);
});
test('fulfillment consumes physical EXACTLY once, not payment/fiado installments',()=>{
 const j=init('cream',2);
 j.append(event('pc',1,'ORDER','cream',2,{orderId:'sale:101:line:1'}));
 const delivery=event('pc',2,'FULFILL','cream',1,{orderId:'sale:101:line:1'});
 j.append(delivery);j.append(delivery);
 assert.equal(state(j).onHand,1);
 assert.equal(state(j).unfulfilled,1);
 assert.throws(()=>j.append(event('pc',3,'PAYMENT','cream',1,{orderId:'sale:101:line:1'})),/unknown event kind/);
});
test('partial fulfillment and cancellation do not double subtract',()=>{
 const j=init('cream',5);
 j.append(event('pc',1,'ORDER','cream',4,{orderId:'s:1'}));
 j.append(event('pc',2,'FULFILL','cream',2,{orderId:'s:1'}));
 j.append(event('pc',3,'CANCEL','cream',2,{orderId:'s:1'}));
 const s=state(j);
 assert.equal(s.onHand,3);assert.equal(s.unfulfilled,0);assert.equal(s.available,3);
});
test('physical count with observed movement is correct and does not double-add it',()=>{
 const j=init('cream',10);
 j.append(event('pc',1,'RECEIVE','cream',3));
 j.append(event('counter',1,'COUNT','cream',12,{observes:['base:1','pc:1'],supersedes:[]}));
 assert.equal(state(j).onHand,12);
 j.append(event('pc',2,'RECEIVE','cream',2,{afterCountId:'counter:1'}));
 assert.equal(state(j).onHand,14);
});
test('physical movement concurrent with unobserved count stays uncertain',()=>{
 const j=init('cream',10);
 j.append(event('counter',1,'COUNT','cream',10,{observes:['base:1'],supersedes:[]}));
 j.append(event('phone',1,'RECEIVE','cream',3)); // not causally after count
 const s=state(j);
 assert.equal(s.onHand,null);assert.equal(s.trust,'needs-reconciliation');
 assert.ok(s.issues.some(x=>x.includes('unresolved-concurrent-physical')));
});
test('two concurrent counts are a CONFLICT even if they coincidentally show the same qty',()=>{
 const j=init('cream',10);
 j.append(event('pc',1,'COUNT','cream',12,{observes:['base:1'],supersedes:[]}));
 j.append(event('phone',1,'COUNT','cream',12,{observes:['base:1'],supersedes:[]}));
 assert.equal(state(j).onHand,null);
 assert.ok(state(j).issues.includes('concurrent-counts'));
 // A verified later count can reconcile both explicitly.
 j.append(event('counter',1,'COUNT','cream',11,{observes:['base:1'],supersedes:['pc:1','phone:1']}));
 assert.equal(state(j).onHand,11);
});
test('missing observed movement is not silently treated as a clean count',()=>{
 const j=init('cream',10);
 j.append(event('counter',1,'COUNT','cream',10,{observes:['base:1','unknown:1'],supersedes:[]}));
 assert.equal(state(j).onHand,null);
 assert.ok(state(j).issues.includes('missing-observed-movement'));
});
test('missing physical baseline never becomes zero merely because no events arrived',()=>{
 const j=new Journal(BOOK);
 j.append(event('pc',1,'RECEIVE','cream',3));
 assert.equal(state(j).onHand,null);
 assert.equal(state(j).trust,'needs-reconciliation');
});
test('overfulfilled order quarantines projection; never invent valid physical count',()=>{
 const j=init('cream',2);
 j.append(event('pc',1,'ORDER','cream',1,{orderId:'sale:A'}));
 j.append(event('pc',2,'FULFILL','cream',2,{orderId:'sale:A'}));
 assert.equal(state(j).onHand,null);
 assert.ok(state(j).issues.includes('overcommitted-order:sale:A'));
});
test('negative physical claim is explicitly unsafe rather than clamped to zero',()=>{
 const j=init('cream',1);
 j.append(event('pc',1,'ORDER','cream',2,{orderId:'sale:A'}));
 j.append(event('pc',2,'FULFILL','cream',2,{orderId:'sale:A'}));
 const s=state(j);
 assert.equal(s.onHand,null);assert.ok(s.issues.includes('physical-deficit'));
});
test('backup export/import and repeated merge are idempotent',()=>{
 const a=init('cream',4);a.append(event('pc',1,'ORDER','cream',3,{orderId:'sale:1'}));
 a.append(event('phone',1,'RECEIVE','cream',1));
 const b=new Journal(BOOK);
 for(let t=0;t<4;t++) b.import(a.export());
 assert.deepEqual(a.export(),b.export());assert.deepEqual(state(a),state(b));assert.equal(b.size,3);
});
test('three peers converge independently of different arrival and merge orders',()=>{
 const events=[event('base',1,'OPEN','cream',5),
 event('pc',1,'ORDER','cream',3,{orderId:'pcSale'}),
 event('phone',1,'ORDER','cream',4,{orderId:'phoneSale'}),
 event('third',1,'RECEIVE','cream',2)];
 const [a,b,c]=[new Journal(BOOK),new Journal(BOOK),new Journal(BOOK)];
 a.merge(events);b.merge([...events].reverse());c.merge([events[2],events[0]]);
 c.merge(b.export().events);b.merge(c.export().events);
 assert.deepEqual(state(a),state(b));assert.deepEqual(state(b),state(c));
 assert.equal(state(a).onHand,7);assert.equal(state(a).preorder,0);
 assert.equal(state(a).available,0);
});
test('atomic batch with ID collision never half-applies valid events',()=>{
 const j=init('cream',1);
 const first=event('base',1,'OPEN','cream',999);
 const second=event('pc',1,'RECEIVE','cream',30);
 const result=j.merge([second,first]);
 assert.equal(result.ok,false);assert.equal(result.added,0);
 assert.equal(j.size,1);
});
test('cross-license event or snapshot can never enter another notebook',()=>{
 const j=init();
 const foreign={...event('pc',1,'RECEIVE','cream',3),notebook:'other'};
 assert.throws(()=>j.append(foreign),/cross-notebook/);
 assert.throws(()=>j.import({schema:1,notebook:'other',events:[]}),/incompatible/);
});
test('append snapshots values, so changing the caller object never changes historic movement',()=>{
 const j=init('cream',3),raw=event('pc',1,'RECEIVE','cream',2);
 j.append(raw);raw.qty=9000;
 assert.equal(state(j).onHand,5);
});
test('duplicate order line with a new event ID is detected (legacy PN/ledger double-charge guard)',()=>{
 const j=init('cream',3);
 j.append(event('pc',1,'ORDER','cream',1,{orderId:'sale:7:line1'}));
 j.append(event('phone',1,'ORDER','cream',1,{orderId:'sale:7:line1'}));
 const s=state(j);
 assert.equal(s.onHand,null);
 assert.ok(s.issues.includes('duplicate-business-order:sale:7:line1'));
});
test('after-count causal provenance is mandatory, not wall-time or unobserved rounding',()=>{
 const j=init('cream',10);
 j.append(event('pc',1,'COUNT','cream',7,{observes:['base:1'],supersedes:[]}));
 j.append(event('phone',1,'RECEIVE','cream',2,{afterCountId:'unknown-count'}));
 assert.equal(state(j).trust,'needs-reconciliation');
});
test('product-level projection: events on other products never rewrite this result',()=>{
 const j=init('cream',4);
 const s=state(j);
 j.append(event('other',1,'RECEIVE','soap',20));
 assert.deepEqual(state(j),s);
});
