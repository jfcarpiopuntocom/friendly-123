'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const http=require('node:http');
const {chromium,webkit}=require('playwright');
const runtime=fs.readFileSync(path.join(__dirname,'../docs/estado-idb.js'),'utf8');
const outboxRuntime=fs.readFileSync(path.join(__dirname,'../docs/sync-outbox.js'),'utf8');

for(const [name,engine] of [['Chromium',chromium],['WebKit',webkit]]) {
test('P0 '+name+' single-DB v2 staging: legacy snapshot retained, encrypted ops copied and read back', {timeout:60000}, async()=>{
 const server=http.createServer((_req,res)=>{res.writeHead(200,{'Content-Type':'text/html'});res.end('<!doctype html><title>synthetic P0</title>')});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const browser=await engine.launch({headless:true});
 try {
  const page=await browser.newPage();
  await page.goto('http://127.0.0.1:'+server.address().port+'/');
  await page.evaluate(async()=>{
   await new Promise((resolve,reject)=>{
    const r=indexedDB.open('f123_estado',1);
    r.onupgradeneeded=()=>r.result.createObjectStore('estado');
    r.onerror=()=>reject(r.error);
    r.onsuccess=()=>{
     const db=r.result,tx=db.transaction('estado','readwrite');
     tx.objectStore('estado').put({_rev:1,nombreNegocio:'SYNTHETIC',productos:[],ventas:[],movimientos:[]},'actual');
     tx.oncomplete=()=>{db.close();resolve();};
     tx.onabort=()=>reject(tx.error);
    };
   });
  });
  await page.addScriptTag({content:runtime});
  await page.addScriptTag({content:outboxRuntime});
  const result=await page.evaluate(async()=>{
   const state=window.OCEstadoIDB;
   const preserved=await state.leer();
   // Ordinary dashboard reads must not perform a schema upgrade in production.
   const beforeVersion=await new Promise((resolve,reject)=>{
    const r=indexedDB.open('f123_estado');r.onsuccess=()=>{const v=r.result.version;r.result.close();resolve(v);};
    r.onerror=()=>reject(r.error);
   });
   const stagedBefore=await state.leerOutboxMigrado('legacy-op-1');
   const invalid=await state.importarOutboxPreparado([{opId:'x',blob:'A'},{opId:'x',blob:'B'}]);
   const copied=await state.importarOutboxPreparado([{opId:'legacy-op-1',blob:'encrypted-one'},{opId:'legacy-op-2',blob:'encrypted-two'}]);
   const a=await state.leerOutboxMigrado('legacy-op-1');
   const b=await state.leerOutboxMigrado('legacy-op-2');
   const duplicate=await state.importarOutboxPreparado([{opId:'legacy-op-1',blob:'overwritten'},{opId:'should-not-exist',blob:'encrypted-three'}]);
   const survivor=await state.leerOutboxMigrado('legacy-op-1');
   const aborted=await state.leerOutboxMigrado('should-not-exist');
   // Newly opened connection uses schema v2; no mutation to source legacy DB.
   const opened=await new Promise((resolve,reject)=>{
    const r=indexedDB.open('f123_estado',2);
    r.onsuccess=()=>{const db=r.result;const names=Array.from(db.objectStoreNames);db.close();resolve(names);};
    r.onerror=()=>reject(r.error);
   });
   return {preserved,beforeVersion,stagedBefore,invalid,copied,a,b,duplicate,survivor,aborted,opened};
  });
  assert.equal(result.preserved.nombreNegocio,'SYNTHETIC');
  assert.equal(result.preserved._rev,1);
  assert.equal(result.beforeVersion,1,'plain dashboard read must not auto-upgrade to v2');
  assert.equal(result.stagedBefore,null,'outbox absent before opt-in migration');
  assert.equal(result.invalid,false,'invalid duplicate input fails closed');
  assert.equal(result.copied,true,'complete + read-back required for staging ACK');
  assert.equal(result.a.blob,'encrypted-one');
  assert.equal(result.b.blob,'encrypted-two');
  assert.equal(result.duplicate,false,'unique opId rejects overwrites');
  assert.equal(result.survivor.blob,'encrypted-one','original migration copy never rewritten');
  assert.equal(result.aborted,null,'failed batch never partially copies the second row');
  for(const store of ['estado','outbox','dedup','trace_intent','trace_outcome'])assert(result.opened.includes(store),store+' exists in same database');
  // The actual legacy adapter stores one encrypted blob with each operation
  // identified by .id; no per-operation rows exist in its old IndexedDB.
  const bridge=await page.evaluate(async()=>{
   window.OCSecure={
    cifrarSync:async text=>'synthetic-enc:'+btoa(text),
    descifrarSync:async blob=>blob.startsWith('synthetic-enc:')?atob(blob.slice(14)):null
   };
   const operations=[
    {id:'original-op-A',method:'POST',url:'/api/synthetic',body:'{"synthetic":true}'},
    {id:'original-op-B',method:'POST',url:'/api/synthetic',body:'{"synthetic":true}'}
   ];
   const blob=await OCSecure.cifrarSync(JSON.stringify(operations));
   const saved=await OCOutbox.guardar(blob);
   const before=await OCOutbox.leer();
   const migrated=await OCOutbox.prepararMigracionAlEstado();
   const after=await OCOutbox.leer();
   const rowA=await OCEstadoIDB.leerOutboxMigrado('original-op-A');
   const rowB=await OCEstadoIDB.leerOutboxMigrado('original-op-B');
   return {saved,before,after,migrated,
    a:rowA&&await OCSecure.descifrarSync(rowA.blob),
    b:rowB&&await OCSecure.descifrarSync(rowB.blob)};
  });
  assert.equal(bridge.saved,true);
  assert.equal(bridge.before,bridge.after,'legacy encrypted source never deleted or changed');
  assert.equal(bridge.migrated.status,'staged-only','no cutover claim');
  assert.equal(bridge.migrated.count,2);
  assert.equal(JSON.parse(bridge.a).id,'original-op-A','preserves original operation identity');
  assert.equal(JSON.parse(bridge.b).id,'original-op-B','preserves original operation identity');
  console.log('P0 v2 staged migration fixture PASS. Legacy source preserved; no sale atomicity or cutover proven.');
 } finally {
  await browser.close();await new Promise(r=>server.close(r));
 }
});
}
