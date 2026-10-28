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
