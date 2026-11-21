'use strict';
// C127: execute the production S4 migration function, not a copy of its policy.
// Synthetic IndexedDB journal: never mutate a >512 or >8MiB legacy queue.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../docs/sync-yjs.js'),'utf8');
const begin=source.indexOf('function v2Db()');
const end=source.indexOf('async function leerOutbox()',begin);
assert.ok(begin>0 && end>begin,'S4 production migration must exist');
const production=source.slice(begin,end);

function fixture(pending){
 const original={pending,confirmed:['acked'],checkpoint:'checkpoint-1'};
 const records=new Map([['legacy',original]]);
 const changes=[];
 let transactions=0;
 const db={
  objectStoreNames:{contains:x=>x==='custom'},
  transaction(){
   transactions++;
   const tx={
    objectStore(){return {
      put(value,key){changes.push(['put',key,value]);records.set(key,value);},
      delete(key){changes.push(['delete',key]);records.delete(key);}
    }},oncomplete:null,onabort:null,onerror:null
   };
   queueMicrotask(()=>tx.oncomplete?.());
   return tx;
  }
 };
 const persistencia={db,get:async key=>records.get(key),set:async(key,value)=>records.set(key,value)};
 const ctx={persistencia,API:{rollout:{outboxV2:true}},_v2Ready:null,_v2DB:null,
  _v2Cache:null,_v2Revision:-1,_v2Signatures:new Map(),
  _v2MetaKey:'meta',_outboxKey:'legacy',_v2Prefix:'op:',
  v2Signature:e=>e.id,log(){},Map,Promise,String};
 vm.runInNewContext(production+';globalThis.run=v2Db;',ctx);
 return {run:()=>ctx.run(),ctx,records,changes,get transactions(){return transactions}};
}
function entries(n,bytes=1){
 return Array.from({length:n},(_,i)=>({id:'op-'+i,c:'x'.repeat(bytes),group:'g'}));
}
test('C127: 513 pending legacy ops retain all original bytes and v1 fallback',async()=>{
 const f=fixture(entries(513));
 const old=f.records.get('legacy');
 assert.equal(await f.run(),null);
 assert.equal(f.transactions,0,'no migration transaction for large queue');
 assert.strictEqual(f.records.get('legacy'),old);
 assert.equal(f.records.get('legacy').pending.length,513);
 assert.equal(f.records.has('meta'),false);
 assert.equal(f.changes.length,0);
});
test('C127: exactly 512 small ops migrate with all op IDs and original checkpoint',async()=>{
 const f=fixture(entries(512));
 const db=await f.run();
 assert.ok(db,'small migration should enter v2');
 assert.equal(f.transactions,1);
 assert.equal(f.records.has('legacy'),false,'legacy deletion is in same transaction');
 assert.equal(f.records.get('meta').v,2);
 assert.equal(f.records.get('meta').checkpoint,'checkpoint-1');
 assert.equal(f.records.get('meta').confirmed[0],'acked');
 assert.equal(f.records.get('op:op-0').id,'op-0');
 assert.equal(f.records.get('op:op-511').id,'op-511');
 assert.equal(f.changes.filter(x=>x[0]==='put').length,513);
});
test('C127: one >8MiB envelope retains v1 without partial migration',async()=>{
 const f=fixture(entries(1,8*1024*1024+1));
 assert.equal(await f.run(),null);
 assert.equal(f.transactions,0);
 assert.equal(f.records.get('legacy').pending.length,1);
 assert.equal(f.records.has('meta'),false);
});

test('C129: deferred 513-op legacy queue stays writable; missing atomic IDB still blocks',async()=>{
 const start=source.indexOf('function mutarOutboxAtomicoSinLocks(');
 const end=source.indexOf('\n    function mutarOutbox(',start+10);
 assert.ok(start>0&&end>start,'real production mutation function must exist');
 const mutation=source.slice(start,end);
 async function execute(deferred){
   let legacyWrites=0;
   const ctx={
     v2Db:()=>Promise.resolve(null),API:{rollout:{outboxV2:true}},
     _v2DeferredLegacy:deferred,
     window:{dispatchEvent(){}},CustomEvent:function(){},
     Error,Promise,Map
   };
   vm.runInNewContext(mutation+';globalThis.mutate=mutarOutboxAtomicoSinLocks;',ctx);
   try {await ctx.mutate(()=>{},()=>{legacyWrites++;return 'saved';});return {legacyWrites,blocked:false};}
   catch(e){return {legacyWrites,blocked:String(e).includes('outbox-atomic-indexeddb-required')};}
 }
 assert.deepEqual(await execute(true),{legacyWrites:1,blocked:false},
   'oversized preexisting v1 outbox must remain usable under global S4');
 assert.deepEqual(await execute(false),{legacyWrites:0,blocked:true},
   'new missing-IDB store must not issue a false durability acknowledgement');
});

test('C131: S4 retries first no-IDB result when database becomes ready later in same session',async()=>{
 const meta={v:2,rev:1,checkpoint:'',confirmed:[]};
 const records=new Map([['meta',meta]]);
 const db={objectStoreNames:{contains:x=>x==='custom'}};
 const persistencia={db:null,_db:null,get:async key=>records.get(key)};
 const ctx={persistencia,API:{rollout:{outboxV2:true}},_v2Ready:null,_v2DB:null,
  _v2Cache:null,_v2Revision:-1,_v2DeferredLegacy:false,_v2Signatures:new Map(),
  _v2MetaKey:'meta',_outboxKey:'legacy',_v2Prefix:'op:',v2Signature:x=>x.id,
  log(){},Map,Promise,String};
 vm.runInNewContext(production+';globalThis.run=v2Db;',ctx);
 assert.equal(await ctx.run(),null,'startup can occur before IDB is ready');
 persistencia.db=db;
 assert.strictEqual(await ctx.run(),db,'ready IDB must be detected without page reload');
 assert.strictEqual(ctx._v2DB,db,'atomic S4 store must become active');
});

test('C131: transient IndexedDB metadata-read failure is retried without false ack',async()=>{
 const db={objectStoreNames:{contains:x=>x==='custom'}};
 let reads=0;
 const persistencia={db,get:async()=>{reads++;if(reads===1)throw Error('temporary IDB read unavailable');return {v:2,rev:1,checkpoint:'',confirmed:[]};}};
 const ctx={persistencia,API:{rollout:{outboxV2:true}},_v2Ready:null,_v2DB:null,
  _v2Cache:null,_v2Revision:-1,_v2DeferredLegacy:false,_v2Signatures:new Map(),
  _v2MetaKey:'meta',_outboxKey:'legacy',_v2Prefix:'op:',v2Signature:x=>x.id,
  log(){},Map,Promise,String};
 vm.runInNewContext(production+';globalThis.run=v2Db;',ctx);
 assert.equal(await ctx.run(),null,'first failed read remains rejected safely');
 assert.strictEqual(await ctx.run(),db,'next real operation retries IDB');
 assert.equal(reads,2,'retry performs fresh metadata read');
});
