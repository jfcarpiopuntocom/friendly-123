'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../docs/sync-yjs.js'),'utf8');
test('S4: staged migration atomically moves old blob and preserves all envelopes',()=>{
 assert.match(source,/API\.rollout && API\.rollout\.outboxV2/);
 const first=source.indexOf('var tx = db.transaction(["custom"], "readwrite")');
 const end=source.indexOf('      });\n          _v2Cache = old;',first);
 assert.ok(first>=0&&end>first,'one transaction owns migration');
 const body=source.slice(first,end);
 assert.match(body,/old\.pending\.forEach/);
 assert.match(body,/store\.put\(entry, _v2Prefix \+ entry\.id\)/);
 assert.match(body,/store\.put\(\{v:2,rev:1/);
 assert.match(body,/store\.delete\(_outboxKey\)/);
 assert.match(body,/tx\.oncomplete = resolve/);
});
test('S4: one new movement never rewrites all historic operations',()=>{
 const first=source.indexOf('    function guardarOutbox() {');
 const end=source.indexOf('    function mutarOutbox(change) {',first);
 assert.ok(first>=0&&end>first);
 const saved=source.slice(first,end);
 assert.match(saved,/if \(!_v2Signatures\.has\(id\) \|\| _v2Signatures\.get\(id\) !== v2Signature\(entry\)\)/);
 assert.match(saved,/store\.put\(entry, _v2Prefix \+ id\)/);
 assert.match(saved,/store\.delete\(_v2Prefix \+ id\)/);
 assert.match(saved,/confirmed:_outbox\.confirmed/);
});
test('S4: non-enabled clients retain the previous storage algorithm',()=>{
 assert.match(source,/if \(!\(API\.rollout && API\.rollout\.outboxV2\) && \(!meta \|\| meta\.v !== 2\)\) return null/);
 assert.match(source,/if \(persistencia && typeof persistencia\.set === "function"\) return persistencia\.set\(_outboxKey, _outbox\)/);
});


test('S4: atomic v1->v2 migration, readback, incremental append, and reload in synthetic real IndexedDB', async()=>{
 const {indexedDB,IDBKeyRange}=require('fake-indexeddb');
 const db=await new Promise((resolve,reject)=>{
   const req=indexedDB.open('p0-s4-synthetic-'+Date.now(),1);
   req.onupgradeneeded=()=>req.result.createObjectStore('custom');
   req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);
 });
 function rawPut(key,value) {
   return new Promise((resolve,reject)=>{
     const tx=db.transaction('custom','readwrite'), req=tx.objectStore('custom').put(value,key);
     tx.oncomplete=resolve;tx.onerror=tx.onabort=()=>reject(tx.error);
   });
 }
 function rawGet(key) {
   return new Promise((resolve,reject)=>{
     const req=db.transaction('custom','readonly').objectStore('custom').get(key);
     req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);
   });
 }
 const legacyKey='f123_relay_outbox_v1-y',metaKey='f123_relay_outbox_v2-y:meta';
 const old={pending:[
  {k:'op',id:'A',c:'synthetic-cipher-A',fingerprint:'f-A'},
  {k:'op',id:'B',c:'synthetic-cipher-B',fingerprint:'f-B',group:'grp'}
 ],checkpoint:'synthetic-only',checkpointLayer:'f123_relay_cupo_v1',confirmed:['already-acked']};
 await rawPut(legacyKey,old);
 const begin=source.indexOf('    var _v2DB = null, _v2Ready = null, _v2Cache = null');
 const end=source.indexOf('    function mutarOutbox(change) {',begin);
 assert.ok(begin>0&&end>begin,'real production migration functions');
 const code=source.slice(begin,end);
 const vm=require('node:vm');
 function harness(testRoom){
   const persistencia={db,_db:Promise.resolve(db),get:rawGet,set:rawPut};
   const ctx=vm.createContext({
     API:{rollout:{outboxV2:testRoom},roomId:'synthetic-room'},suffix:'-y',
     persistencia,IDBKeyRange,localStorage:{},_outboxKey:legacyKey,
     _outbox:{pending:[],confirmed:[],checkpoint:''}
   });
   vm.runInContext(code,ctx);
   ctx.getQueue=()=>ctx.leerOutbox();
   ctx.putQueue=queue=>{ctx._outbox=queue;return ctx.guardarOutbox();};
   return ctx;
 }
 const a=harness(true),migrated=await a.getQueue();
 assert.equal(migrated.pending.length,2);
 assert.equal((await rawGet(legacyKey)),undefined,'monolith deleted on same transaction only after copies');
 assert.equal((await rawGet(metaKey)).v,2);
 assert.equal((await rawGet(metaKey)).checkpointLayer,'f123_relay_cupo_v1','migration preserves source-specific proof');
 assert.equal((await rawGet('f123_relay_outbox_v2-y:op:A')).c,'synthetic-cipher-A');
 assert.equal((await rawGet('f123_relay_outbox_v2-y:op:B')).group,'grp');
 migrated.pending.push({k:'op',id:'C',c:'synthetic-cipher-C',fingerprint:'f-C'});
 await a.putQueue(migrated);
 assert.equal((await rawGet(metaKey)).rev,2);
 assert.equal((await rawGet('f123_relay_outbox_v2-y:op:C')).c,'synthetic-cipher-C');
 const b=harness(true),reopened=await b.getQueue();
 assert.deepEqual(Array.from(reopened.pending,x=>String(x.id)),['A','B','C']);
 assert.equal(reopened.checkpointLayer,'f123_relay_cupo_v1','reload must retain ACK layer');
 reopened.pending=reopened.pending.filter(x=>x.id!=='B');
 reopened.checkpointLayer='f123_relay_cupo_fb_v1';
 await b.putQueue(reopened);
 assert.equal((await rawGet(metaKey)).checkpointLayer,'f123_relay_cupo_fb_v1','provider proof persists atomically with outbox metadata');
 const c=harness(true),reloaded=await c.getQueue();
 assert.equal(reloaded.checkpointLayer,'f123_relay_cupo_fb_v1','a later reload sees updated layer proof');
 assert.equal((await rawGet('f123_relay_outbox_v2-y:op:B')),undefined,'ACK removes only retired envelope');
 assert.equal((await rawGet('f123_relay_outbox_v2-y:op:A')).c,'synthetic-cipher-A');
 assert.equal((await rawGet('f123_relay_outbox_v2-y:op:C')).c,'synthetic-cipher-C');
 db.close();
});

test('S4 never duplicates a large customer backlog or deletes the v1 source',async()=>{
 const {indexedDB,IDBKeyRange}=require('fake-indexeddb'),vm=require('node:vm');
 const req=indexedDB.open('s4-oversize-'+Date.now(),1);
 const db=await new Promise((resolve,reject)=>{
   req.onupgradeneeded=()=>req.result.createObjectStore('custom');
   req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);
 });
 const key='f123_relay_outbox_v1-y';
 const old={pending:Array.from({length:513},(_,i)=>({id:String(i),k:'op',c:'cipher'})),confirmed:[],checkpoint:''};
 const put=(k,v)=>new Promise((resolve,reject)=>{
   const tx=db.transaction('custom','readwrite');tx.objectStore('custom').put(v,k);
   tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);
 });
 const get=k=>new Promise(resolve=>{
   const req=db.transaction('custom','readonly').objectStore('custom').get(k);
   req.onsuccess=()=>resolve(req.result);
 });
 await put(key,old);
 const begin=source.indexOf('    var _v2DB = null, _v2Ready = null, _v2Cache = null');
 const end=source.indexOf('    function mutarOutbox(change) {',begin);
 const ctx=vm.createContext({API:{rollout:{outboxV2:true},roomId:'synthetic'},suffix:'-y',
   persistencia:{db,_db:Promise.resolve(db),get,set:put},_outboxKey:key,
   _outbox:{pending:[],confirmed:[],checkpoint:''},IDBKeyRange,localStorage:{},log(){}});
 vm.runInContext(source.slice(begin,end),ctx);
 const read=await vm.runInContext('leerOutbox()',ctx);
 assert.equal(read.pending.length,513);
 assert.equal((await get(key)).pending.length,513);
 assert.equal(await get('f123_relay_outbox_v2-y:meta'),undefined);
 db.close();
});
