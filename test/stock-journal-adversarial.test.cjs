'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {Journal}=require('../lab/stock-journal/engine.cjs');
const book='adversarial-synthetic-only';
function e(d,seq,kind,p,qty,ext={}){return {id:d+':'+seq,notebook:book,device:d,seq,kind,product:p,qty,...ext};}
test('P0: a physical count which did not observe the OPEN cannot claim an exact baseline',()=>{
 const j=new Journal(book);
 j.append(e('base',1,'OPEN','cream',15));
 j.append(e('counter',1,'COUNT','cream',10,{observes:[],supersedes:[]}));
 const s=j.project('cream');
 assert.equal(s.onHand,null,'the physical count may be concurrent with unobserved opening/epoch');
 assert.equal(s.trust,'needs-reconciliation');
});
test('P0: count references another product physical movement, must NOT be accepted',()=>{
 const j=new Journal(book);
 j.append(e('base',1,'OPEN','cream',10));
 j.append(e('other',1,'RECEIVE','soap',9));
 j.append(e('counter',1,'COUNT','cream',10,{observes:['base:1','other:1'],supersedes:[]}));
 assert.equal(j.project('cream').onHand,null,'cross-product observations do not establish a causal frontier');
});
test('P0: count references business order as observed physical movement, must reject',()=>{
 const j=new Journal(book);
 j.append(e('base',1,'OPEN','cream',1));
 j.append(e('pc',1,'ORDER','cream',2,{orderId:'sale:1'}));
 j.append(e('counter',1,'COUNT','cream',1,{observes:['base:1','pc:1'],supersedes:[]}));
 const s=j.project('cream');
 assert.equal(s.onHand,null,'orders do not alter physical stock');
 assert.equal(s.trust,'needs-reconciliation');
});

test('P0: sequence-only collisions with distinct IDs survive backup without inventing stock',()=>{
 const j=new Journal(book);
 j.append(e('base',1,'OPEN','cream',10));
 j.append(e('pc',1,'RECEIVE','cream',3));
 const alt={...e('pc',1,'RECEIVE','cream',5),id:'different-id'};
 assert.equal(j.append(alt).reason,'sequence-collision');
 const saved=j.export(),reopened=new Journal(book);
 assert.equal(reopened.import(saved).ok,true);
 assert.deepEqual(reopened.export(),saved);
 assert.equal(reopened.project('cream').onHand,null);
 assert.ok(reopened.project('cream').issues.includes('quarantined-sequence-collision'));
});
test('P0: a device sequence reused for another product taints BOTH products',()=>{
 const j=new Journal(book);
 j.append(e('base',1,'OPEN','cream',10));
 j.append(e('base',2,'OPEN','soap',20));
 j.append(e('pc',1,'RECEIVE','cream',3));
 const alt={...e('pc',1,'RECEIVE','soap',5),id:'reused-id'};
 assert.equal(j.append(alt).reason,'sequence-collision');
 for (const product of ['cream','soap']) {
   assert.equal(j.project(product).onHand,null);
   assert.ok(j.project(product).issues.includes('quarantined-sequence-collision'));
 }
 const restored=new Journal(book);
 assert.equal(restored.import(j.export()).ok,true);
 for (const product of ['cream','soap']) assert.equal(restored.project(product).onHand,null);
});
test('P0: same-ID cross-product collisions taint accepted product, not only rejected one',()=>{
 const j=new Journal(book);
 j.append(e('base',1,'OPEN','cream',10));
 j.append(e('base',2,'OPEN','soap',20));
 const original=e('pc',1,'RECEIVE','cream',3);
 j.append(original);
 assert.equal(j.append({...original,product:'soap',qty:7}).reason,'id-collision');
 for(const product of ['cream','soap']){
   assert.equal(j.project(product).onHand,null);
   assert.ok(j.project(product).issues.includes('quarantined-id-collision'));
 }
});
test('P0: internally contradictory NEW batch is never applied, and its entire envelope restores',()=>{
 const j=new Journal(book);
 j.append(e('base',1,'OPEN','cream',10));
 const first=e('pc',1,'RECEIVE','cream',3),second={...first,qty:5};
 const r=j.merge([first,second]);
 assert.equal(r.ok,false);assert.equal(r.rejectedBatchStored,true);
 assert.equal(j.size,1,'neither disputed fact becomes physical inventory');
 assert.equal(j.quarantined.length,0,'no orphan single-witness quarantine');
 assert.equal(j.rejectedBatches.length,1);
 assert.deepEqual(j.rejectedBatches[0].events,[first,second]);
 assert.equal(j.project('cream').onHand,null);
 const backup=j.export(),reopened=new Journal(book);
 assert.equal(reopened.import(backup).ok,true);
 assert.deepEqual(reopened.export(),backup);
 assert.equal(reopened.project('cream').onHand,null);
});
test('P0: a rejected batch retains unrelated movements without applying them',()=>{
 const j=new Journal(book);
 j.append(e('base',1,'OPEN','cream',5));
 j.append(e('base',2,'OPEN','soap',7));
 j.append(e('pc',1,'RECEIVE','cream',2));
 const attempted=e('pc',1,'RECEIVE','cream',5);
 const unrelated=e('supplier',1,'RECEIVE','soap',9);
 const r=j.merge([unrelated,attempted]);
 assert.equal(r.ok,false);assert.equal(j.size,3);
 assert.equal(j.rejectedBatches[0].events.length,2);
 assert.equal(j.project('soap').onHand,null,'unapplied but disputed batch cannot look complete');
 assert.equal(j.project('cream').onHand,null);
 const reopened=new Journal(book);
 assert.equal(reopened.import(j.export()).ok,true);
 assert.deepEqual(reopened.export(),j.export());
});
test('P0: fabricated rejected batch without contradictory witnesses is not importable',()=>{
 const j=new Journal(book);
 j.append(e('base',1,'OPEN','cream',1));
 const backup=j.export();
 backup.rejectedBatches=[{reason:'id-collision',events:[e('pc',1,'RECEIVE','cream',5)]}];
 const reopened=new Journal(book);
 assert.throws(()=>reopened.import(backup),/unsubstantiated/);
 assert.equal(reopened.size,0);
});
test('P0: backup preserves conflicting evidence, not only the winner of an event ID',()=>{
 const j=new Journal(book);
 j.append(e('base',1,'OPEN','cream',10));
 const original=e('pc',1,'RECEIVE','cream',3);
 j.append(original);
 j.append({...original,qty:4});
 j.append({...original,qty:5});
 assert.equal(j.quarantined.length,2,'three signed claims imply two losing alternatives');
 const backup=j.export(),restored=new Journal(book);
 restored.import(backup);
 assert.equal(restored.quarantined.length,2,'two different losing facts survive export and restore');
 assert.equal(restored.project('cream').trust,'needs-reconciliation');
 assert.equal(restored.size,2);
});
