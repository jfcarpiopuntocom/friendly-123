'use strict';
// C137: source-executed WebKit-style closed IDB handle, synthetic business data only.
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../docs/sync-outbox.js'),'utf8');
const KEY='f123_sync_pending';
function fixture(){
 const records=new Map(),local=new Map(),connections=[];
 let full=false,failOpen=false,opens=0;
 const indexedDB={open(name,version){
  assert.equal(name,'f123_outbox');assert.equal(version,1);
  opens++;
  if(failOpen){const bad={error:new Error('open failed')};queueMicrotask(()=>bad.onerror?.());return bad;}
  const db={closed:false,
   close(){this.closed=true;},
   transaction(store,mode){
    if(this.closed){const e=new Error('Database connection is closing');e.name='InvalidStateError';throw e;}
    assert.equal(store,'cola');
    const tx={error:null};
    tx.objectStore=()=>({
     put(row){assert.equal(mode,'readwrite');queueMicrotask(()=>{records.set(row.id,{...row});tx.oncomplete?.();});},
     get(id){assert.equal(mode,'readonly');const req={};queueMicrotask(()=>{req.result=records.get(id);req.onsuccess?.();tx.oncomplete?.();});return req;}
    });
    return tx;
   }
  };
  connections.push(db);
  const req={result:db};queueMicrotask(()=>req.onsuccess?.());return req;
 }};
 const localStorage={
  getItem:k=>local.get(k)||null,
  setItem(k,v){if(full)throw new Error('localStorage quota full');local.set(k,v);},
  removeItem:k=>local.delete(k)
 };
 const ctx={window:{},indexedDB,localStorage,Date,Promise,console:{warn(){}}};
 vm.runInNewContext(source,ctx,{filename:'sync-outbox.js'});
 return {api:ctx.window.OCOutbox,records,connections,local,quota:b=>{full=b;},failOpen:b=>{failOpen=b;},opens:()=>opens};
}
test('C137: onclose reopens next current write with localStorage full',async()=>{
 const f=fixture();
 assert.equal(await f.api.guardar('sale-first'),true);
 f.quota(true);const old=f.connections[0];old.closed=true;old.onclose?.();
 assert.equal(await f.api.guardar('sale-second'),true);
 assert.equal(f.connections.length,2);
 assert.equal(f.records.get(KEY).blob,'sale-second');
 assert.equal(await f.api.leer(),'sale-second');
 assert.equal(f.local.has(KEY),false);
});
test('C137: onversionchange closes old DB and reopens next encrypted write',async()=>{
 const f=fixture();
 assert.equal(await f.api.guardar('before-upgrade'),true);
 const old=f.connections[0];old.onversionchange?.();
 assert.equal(old.closed,true);
 f.quota(true);assert.equal(await f.api.guardar('after-upgrade'),true);
 assert.equal(f.connections.length,2);
 assert.equal(f.records.get(KEY).blob,'after-upgrade');
});
test('C137: silent Safari InvalidStateError retries CURRENT write in bounded single reopen',async()=>{
 const f=fixture();assert.equal(await f.api.guardar('stable'),true);
 f.connections[0].closed=true;f.quota(true);
 assert.equal(await f.api.guardar('pending'),true);
 assert.equal(f.connections.length,2);
 assert.equal(f.records.get(KEY).blob,'pending');
 assert.equal(f.local.has(KEY),false);
});
test('C137: leer after silent close reopens IDB and retrieves durable encrypted blob',async()=>{
 const f=fixture();assert.equal(await f.api.guardar('durable'),true);
 f.connections[0].closed=true;f.quota(true);
 assert.equal(await f.api.leer(),'durable');
 assert.equal(f.connections.length,2);
});
test('C137: failed reopen + quota full fails closed, preserves last committed row, later retry works',async()=>{
 const f=fixture();assert.equal(await f.api.guardar('stable'),true);
 f.connections[0].closed=true;f.quota(true);f.failOpen(true);
 const before=f.opens();
 assert.equal(await f.api.guardar('lost'),false);
 assert.ok(f.opens()-before<=1,'at most one reopen attempt per write');
 assert.equal(f.records.get(KEY).blob,'stable');
 f.failOpen(false);assert.equal(await f.api.guardar('recovered'),true);
 assert.equal(f.records.get(KEY).blob,'recovered');
});
test('C137: late onclose/versionchange on old handle cannot invalidate the new handle',async()=>{
 const f=fixture();await f.api.guardar('a');
 const old=f.connections[0];old.closed=true;old.onclose?.();
 await f.api.guardar('b');assert.equal(f.connections.length,2);
 old.onclose?.();old.onversionchange?.();await f.api.guardar('c');
 assert.equal(f.connections.length,2);
});
test('C137: concurrent writes share ONE reopen after silent close',async()=>{
 const f=fixture();await f.api.guardar('a');
 f.connections[0].closed=true;f.quota(true);
 const result=await Promise.all([f.api.guardar('s1'),f.api.guardar('s2')]);
 assert.deepEqual(result,[true,true]);
 assert.equal(f.connections.length,2);
});
