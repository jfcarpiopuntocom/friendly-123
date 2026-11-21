'use strict';
// C135: source-executed Safari-style closed IDB handle, no real business data.
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../docs/sync-outbox.js'),'utf8');
const KEY='f123_sync_pending';
function fixture(){
 const records=new Map(),local=new Map(),connections=[];
 let full=false;
 const indexedDB={open(name,version){
  assert.equal(name,'f123_outbox');assert.equal(version,1);
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
  const req={result:db};
  queueMicrotask(()=>req.onsuccess?.());
  return req;
 }};
 const localStorage={
  getItem:k=>local.get(k)||null,
  setItem(k,v){if(full)throw new Error('localStorage quota full');local.set(k,v);},
  removeItem:k=>local.delete(k)
 };
 const ctx={window:{},indexedDB,localStorage,Date,Promise,console:{warn(){}}};
 vm.runInNewContext(source,ctx,{filename:'sync-outbox.js'});
 return {api:ctx.window.OCOutbox,records,connections,local,quota:b=>{full=b;}};
}
test('C135: IDB spontaneous close event reopens durable store on next current write, without localStorage',async()=>{
 const f=fixture();
 assert.equal(await f.api.guardar('sale-first'),true);
 assert.equal(f.connections.length,1);
 f.quota(true);
 const old=f.connections[0];old.closed=true;old.onclose?.();
 assert.equal(await f.api.guardar('sale-second'),true,'fresh IDB must recover with localStorage quota exhausted');
 assert.equal(f.connections.length,2,'actual reopened IDB, not a silent localStorage fallback');
 assert.equal(f.records.get(KEY).blob,'sale-second');
 assert.equal(await f.api.leer(),'sale-second');
 assert.equal(f.local.has(KEY),false);
});
test('C135: versionchange closes prior connection and reopens for next encrypted write',async()=>{
 const f=fixture();
 assert.equal(await f.api.guardar('before-upgrade'),true);
 const old=f.connections[0];
 old.onversionchange?.();
 assert.equal(old.closed,true,'old IDB handle must release version upgrade lock');
 f.quota(true);
 assert.equal(await f.api.guardar('after-upgrade'),true);
 assert.equal(f.connections.length,2);
 assert.equal(f.records.get(KEY).blob,'after-upgrade');
});
test('C135: Safari InvalidStateError without onclose invalidates cached handle; next write retries IDB',async()=>{
 const f=fixture();
 assert.equal(await f.api.guardar('stable'),true);
 f.connections[0].closed=true;f.quota(true);
 assert.equal(await f.api.guardar('pending'),false,'failed IDB plus quota cannot claim durability');
 assert.equal(f.records.get(KEY).blob,'stable','failed write never overwrote durable state');
 assert.equal(await f.api.guardar('pending'),true,'next real operation must reopen stale handle');
 assert.equal(f.connections.length,2);
 assert.equal(f.records.get(KEY).blob,'pending');
});
