'use strict';
// C163 P0: existing encrypted local fallback is the last committed queue when
// IndexedDB retains an older row after one failed transaction.
// Execute the real browser module; no customer data, network, or second store.
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../docs/sync-outbox.js'),'utf8');
const KEY='f123_sync_pending';
function fixture(){
 const durable=new Map(),local=new Map();
 let failWrites=false,dbOpens=0;
 const db={transaction(_name,mode){
   const tx={error:null};
   tx.objectStore=()=>({
     put(row){assert.equal(mode,'readwrite');queueMicrotask(()=>{
       if(failWrites){const error=new Error('synthetic current IDB write aborted');error.name='QuotaExceededError';tx.error=error;tx.onabort?.();return;}
       durable.set(row.id,{...row});tx.oncomplete?.();
     });},
     get(key){assert.equal(mode,'readonly');const req={};queueMicrotask(()=>{
       req.result=durable.get(key);req.onsuccess?.();tx.oncomplete?.();
     });return req;}
   });return tx;
 }};
 const indexedDB={open(name,version){
   assert.equal(name,'f123_outbox');assert.equal(version,1);dbOpens++;
   const req={result:db};queueMicrotask(()=>req.onsuccess?.());return req;
 }};
 const localStorage={
   getItem:key=>local.get(key)||null,
   setItem(key,value){local.set(key,value)},
   removeItem:key=>local.delete(key)
 };
 function coldContext(){
   const root={window:{},indexedDB,localStorage,console:{warn(){}},Date,Promise};
   vm.runInNewContext(source,root,{filename:'sync-outbox.js'});
   return root.window.OCOutbox;
 }
 return {api:coldContext(),coldContext,durable,local,fail:on=>{failWrites=on},get opens(){return dbOpens}};
}
test('C163 RED: after IDB write abort fallback holds NEWER encrypted queue than stale IDB row',async()=>{
 const f=fixture();
 assert.equal(await f.api.guardar('encrypted:old-outbox'),true);
 assert.equal(f.durable.get(KEY).blob,'encrypted:old-outbox');
 f.fail(true);
 assert.equal(await f.api.guardar('encrypted:current-outbox-with-new-sale'),true);
 assert.equal(f.durable.get(KEY).blob,'encrypted:old-outbox','IDB never wrote newer operation');
 assert.equal(f.local.get(KEY),'encrypted:current-outbox-with-new-sale','local fallback really committed current queue');
 assert.equal(await f.api.leer(),'encrypted:current-outbox-with-new-sale',
  'live read must not silently resurrect older queued operations');
 const reopened=f.coldContext();
 assert.equal(await reopened.leer(),'encrypted:current-outbox-with-new-sale',
  'cold reopen must keep current encrypted outbox without a recovery project');
});
test('C163: successful newer IDB commit retires fallback, subsequent reads use IDB',async()=>{
 const f=fixture();await f.api.guardar('encrypted:old');f.fail(true);
 assert.equal(await f.api.guardar('encrypted:middle'),true);
 f.fail(false);
 assert.equal(await f.api.guardar('encrypted:latest'),true);
 assert.equal(f.durable.get(KEY).blob,'encrypted:latest');
 assert.equal(f.local.has(KEY),false,'only successful durable commit removes fallback');
 assert.equal(await f.api.leer(),'encrypted:latest');
 assert.equal(await f.coldContext().leer(),'encrypted:latest');
});
test('C163: empty fallback preserves existing IDB read, old legacy backup still readable',async()=>{
 const f=fixture();await f.api.guardar('encrypted:normal');
 assert.equal(f.local.has(KEY),false);
 assert.equal(await f.api.leer(),'encrypted:normal');
 const old=fixture();old.local.set(KEY,'encrypted:legacy-only');
 assert.equal(await old.api.leer(),'encrypted:legacy-only');
});
