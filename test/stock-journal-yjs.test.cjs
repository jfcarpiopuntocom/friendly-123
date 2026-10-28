'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const {webcrypto}=require('node:crypto');
const {browser}=require('./helpers/browser.cjs');
const {Journal}=require('../lab/stock-journal/engine.cjs');
const {ShadowYjsBridge}=require('../lab/stock-journal/yjs-bridge.cjs');
const vendor=fs.readFileSync(path.join(__dirname,'../docs/vendor/yjs-bundle.min.js'),'utf8');
const BOOK='synthetic-journal-fixture';
function make() {
 const context=browser();
 Object.assign(context,{crypto:webcrypto,TextEncoder,TextDecoder});
 vm.runInContext(vendor,context);
 const Y=context.Y;
 assert(Y && Y.Doc && Y.applyUpdate,'must load the actual vendored Yjs distribution');
 const doc=new Y.Doc(),journal=new Journal(BOOK),bridge=new ShadowYjsBridge(doc,journal);
 return {Y,doc,journal,bridge};
}
function ev(device,seq,kind,product,qty,extra={}){
 return {id:device+':'+seq,device,seq,notebook:BOOK,kind,product,qty,...extra};
}
async function transmit(a,b) {
 b.Y.applyUpdate(b.doc,new Uint8Array(a.Y.encodeStateAsUpdate(a.doc)),'red');
 await b.bridge.flush();
}
test('real Yjs: two disconnected peers converge on two preorders without double selling',async()=>{
 const [a,b]=[make(),make()],base=ev('base',1,'OPEN','cream',1);
 await a.bridge.publish(base);await transmit(a,b);
 await a.bridge.publish(ev('pc',1,'ORDER','cream',1,{orderId:'sale-pc'}));
 await b.bridge.publish(ev('phone',1,'ORDER','cream',1,{orderId:'sale-phone'}));
 await transmit(a,b);await transmit(b,a);
 const ap=a.journal.project('cream'),bp=b.journal.project('cream');
 assert.deepEqual(ap,bp);
 assert.equal(ap.unfulfilled,2);assert.equal(ap.preorder,1);assert.equal(ap.onHand,1);
 assert.equal(ap.available,0);assert.equal(a.bridge.errors.length,0);assert.equal(b.bridge.errors.length,0);
 a.bridge.close();b.bridge.close();
});
test('real Yjs: three peers, offline operations in different orders and duplicate reconnects',async()=>{
 const [a,b,c]=[make(),make(),make()];
 await a.bridge.publish(ev('base',1,'OPEN','cream',10));
 await transmit(a,b);await transmit(a,c);
 await a.bridge.publish(ev('pc',1,'RECEIVE','cream',3));
 await b.bridge.publish(ev('phone',1,'RECEIVE','cream',2));
 await c.bridge.publish(ev('third',1,'ORDER','cream',8,{orderId:'sale-third'}));
 await transmit(c,b);await transmit(a,c);await transmit(b,a);
 await transmit(a,b);await transmit(b,c);await transmit(c,a);
 await transmit(a,b);await transmit(a,b);await transmit(b,c);
 const projections=[a,b,c].map(x=>x.journal.project('cream'));
 assert.deepEqual(projections[0],projections[1]);assert.deepEqual(projections[1],projections[2]);
 assert.equal(projections[0].onHand,15);assert.equal(projections[0].unfulfilled,8);
 assert.equal(projections[0].available,7);
 assert.equal(a.journal.size,4);assert.equal(b.journal.size,4);assert.equal(c.journal.size,4);
 for(const peer of [a,b,c])peer.bridge.close();
});
test('real Yjs: SAME ID with DIFFERENT payload survives on separate witness keys and is quarantined',async()=>{
 const [a,b]=[make(),make()];
 const base=ev('base',1,'OPEN','cream',10);
 await a.bridge.publish(base);await transmit(a,b);
 await a.bridge.publish(ev('pc',1,'RECEIVE','cream',3));
 await b.bridge.publish(ev('pc',1,'RECEIVE','cream',5));
 await transmit(a,b);await transmit(b,a);
 await a.bridge.flush();await b.bridge.flush();
 assert.equal(a.bridge.map.size,3,'both conflicting witnesses must survive Yjs convergence');
 assert.equal(b.bridge.map.size,3);
 for(const peer of [a,b]){
  const x=peer.journal.project('cream');
  assert.equal(x.onHand,null);
  assert.ok(x.issues.includes('quarantined-id-collision'));
  assert.equal(peer.journal.size,2,'quarantined event must not replace accepted evidence');
  assert.equal(peer.journal.quarantined.length,1);
  peer.bridge.close();
 }
});
test('rejected local collision is still propagated as a quarantined witness to the other peer',async()=>{
 const [a,b]=[make(),make()];
 await a.bridge.publish(ev('base',1,'OPEN','cream',10));
 const original=ev('pc',1,'RECEIVE','cream',3);
 assert.equal((await a.bridge.publish(original)).ok,true);
 const rejected=await a.bridge.publish({...original,qty:5});
 assert.equal(rejected.ok,false,'business operation must remain rejected');
 assert.equal(rejected.witnessPublished,true,'conflicting evidence must not be hidden locally');
 await a.bridge.flush();
 await transmit(a,b);
 assert.equal(a.bridge.map.size,3);
 assert.equal(b.bridge.map.size,3);
 for(const peer of [a,b]){
   assert.equal(peer.journal.project('cream').trust,'needs-reconciliation');
   assert.equal(peer.journal.quarantined.length,1);
   assert.equal(peer.journal.size,2,'only the first canonical movement is accepted');
   peer.bridge.close();
 }
});
test('Yjs: a sequence-only rejected witness reaches peers and survives rehydration',async()=>{
 const [source,remote,reopened]=[make(),make(),make()];
 await source.bridge.publish(ev('base',1,'OPEN','cream',10));
 const original=ev('pc',1,'RECEIVE','cream',3);
 await source.bridge.publish(original);
 const alt={...original,id:'pc:other-id',qty:5};
 const result=await source.bridge.publish(alt);
 assert.equal(result.ok,false);assert.equal(result.reason,'sequence-collision');
 assert.equal(result.witnessPublished,true);
 await transmit(source,remote);
 assert.equal(remote.journal.project('cream').trust,'needs-reconciliation');
 const backup=remote.journal.export();
 assert.equal(reopened.journal.import(backup).ok,true);
 assert.equal(await reopened.bridge.seedFromJournal(),3);
 assert.equal(reopened.journal.project('cream').trust,'needs-reconciliation');
 for(const p of [source,remote,reopened])p.bridge.close();
});
test('Yjs: overwrite of a known immutable witness repairs its bytes and preserves peer state',async()=>{
 const [a,b]=[make(),make()];
 const opening=ev('base',1,'OPEN','cream',7);
 await a.bridge.publish(opening);
 await transmit(a,b);
 const [key]=[...a.bridge.map.keys()];
 const canonical=a.bridge.map.get(key);
 a.bridge.map.set(key,JSON.stringify({...opening,qty:900}));
 await a.bridge.flush();
 assert.equal(a.bridge.map.get(key),canonical,'corrupted witness must self-heal');
 await transmit(a,b);
 assert.equal(a.journal.project('cream').onHand,7);
 assert.equal(b.journal.project('cream').onHand,7);
 a.bridge.close();b.bridge.close();
});
test('real Yjs: forged or corrupted event witness cannot enter journal',async()=>{
 const a=make();
 a.bridge.map.set('fake#notsha256',JSON.stringify(ev('base',1,'OPEN','cream',999)));
 await a.bridge.flush();
 assert.equal(a.journal.size,0);assert.equal(a.bridge.errors.length,1);
 a.bridge.close();
});
test('real Yjs: one new product event updates only one Y.Map key, not other 1000 products',async()=>{
 const [a,b]=[make(),make()];
 for(let i=0;i<1000;i++) await a.bridge.publish(ev('base',i+1,'OPEN','sku-'+i,5));
 await transmit(a,b);
 assert.equal(b.journal.size,1000);
 const before=b.bridge.inbound;
 await a.bridge.publish(ev('pc',1,'RECEIVE','sku-333',4));
 await transmit(a,b);
 assert.equal(b.journal.project('sku-333').onHand,9);
 assert.equal(b.journal.project('sku-444').onHand,5);
 assert.equal(b.bridge.inbound-before,1,'the bridge must consume one changed key');
 a.bridge.close();b.bridge.close();
});

test('P0 Yjs tombstone: accidental deletion of a known immutable witness must self-heal',async()=>{
 const [a,b]=[make(),make()];
 await a.bridge.publish(ev('base',1,'OPEN','cream',7));
 await transmit(a,b);
 assert.equal(b.journal.project('cream').onHand,7);
 const key=[...a.bridge.map.keys()][0];
 a.bridge.map.delete(key); // simulate accidental remote map tombstone
 await a.bridge.flush();
 await transmit(a,b);
 await b.bridge.flush();
 assert.ok(a.bridge.map.has(key),'source must restore its local immutable event witness');
 assert.ok(b.bridge.map.has(key),'other peers must retain/relearn the evidence');
 assert.equal(a.journal.project('cream').onHand,7);
 assert.equal(b.journal.project('cream').onHand,7);
 a.bridge.close();b.bridge.close();
});

test('restored local backup reseeds all witnesses, including multiple divergent payloads',async()=>{
 const source=make(),reopened=make(),remote=make();
 await source.bridge.publish(ev('base',1,'OPEN','cream',10));
 const original=ev('pc',1,'RECEIVE','cream',3);
 await source.bridge.publish(original);
 await source.bridge.publish({...original,qty:5}); // intentional hash/key collision; must quarantine
 assert.equal(source.journal.quarantined.length,1);
 const snapshot=source.journal.export();
 assert.equal(reopened.journal.import(snapshot).ok,true);
 assert.equal(await reopened.bridge.seedFromJournal(),3);
 await transmit(reopened,remote);
 assert.equal(remote.bridge.map.size,3);
 assert.equal(remote.journal.size,2);
 assert.equal(remote.journal.quarantined.length,1);
 assert.equal(remote.journal.project('cream').trust,'needs-reconciliation');
 source.bridge.close();reopened.bridge.close();remote.bridge.close();
});
