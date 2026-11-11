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
   // The same staged pass must be idempotent and resumable, not a PK abort.
   const repeated=await OCOutbox.prepararMigracionAlEstado();
   const expanded=[...operations,{id:'original-op-C',method:'POST',url:'/api/synthetic',body:'{"synthetic":true}'}];
   await OCOutbox.guardar(await OCSecure.cifrarSync(JSON.stringify(expanded)));
   const updatedSource=await OCOutbox.leer();
   const resumed=await OCOutbox.prepararMigracionAlEstado();
   const afterResume=await OCOutbox.leer();
   const rowA=await OCEstadoIDB.leerOutboxMigrado('original-op-A');
   const rowB=await OCEstadoIDB.leerOutboxMigrado('original-op-B');
   const rowC=await OCEstadoIDB.leerOutboxMigrado('original-op-C');
   // Conflicting payload for an already imported identity is a hard block,
   // never an overwrite. Legacy source is still intact for inspection.
   const conflicting=expanded.map(x=>x.id==='original-op-A'
     ? {...x,body:'{"synthetic":"different-payload"}'}:x);
   await OCOutbox.guardar(await OCSecure.cifrarSync(JSON.stringify(conflicting)));
   const conflictingSource=await OCOutbox.leer();
   const conflict=await OCOutbox.prepararMigracionAlEstado();
   const afterConflict=await OCOutbox.leer();
   const retained=await OCEstadoIDB.leerOutboxMigrado('original-op-A');
   // A legacy writer adds op E while the staging loop is encrypting D.
   // The first pass MUST detect a changed ciphertext and refuse cutover.
   const opD={id:'original-op-D',method:'POST',url:'/api/synthetic',body:'{"synthetic":true}'};
   const opE={id:'original-op-E',method:'POST',url:'/api/synthetic',body:'{"synthetic":true}'};
   const withD=[...expanded,opD];
   const cipher=OCSecure.cifrarSync;
   await OCOutbox.guardar(await cipher(JSON.stringify(withD)));
   let sourceBumped=false;
   OCSecure.cifrarSync=async text=>{
     if(!sourceBumped&&text.startsWith('{"id":"original-op-D"')){
       sourceBumped=true;
       await OCOutbox.guardar(await cipher(JSON.stringify([...withD,opE])));
     }
     return cipher(text);
   };
   const stale=await OCOutbox.prepararMigracionAlEstado();
   OCSecure.cifrarSync=cipher;
   const afterStale=await OCOutbox.leer();
   const recovery=await OCOutbox.prepararMigracionAlEstado();
   const finalSource=await OCOutbox.leer();
   const recoveredE=await OCEstadoIDB.leerOutboxMigrado('original-op-E');
   return {saved,before,after,migrated,repeated,updatedSource,afterResume,resumed,
    stale,afterStale,recovery,finalSource,recoveredE:recoveredE&&await OCSecure.descifrarSync(recoveredE.blob),
    conflictingSource,afterConflict,conflict,
    retained:retained&&await OCSecure.descifrarSync(retained.blob),
    a:rowA&&await OCSecure.descifrarSync(rowA.blob),
    b:rowB&&await OCSecure.descifrarSync(rowB.blob),
    c:rowC&&await OCSecure.descifrarSync(rowC.blob)};
  });
  assert.equal(bridge.saved,true);
  assert.equal(bridge.before,bridge.after,'legacy encrypted source never deleted or changed');
  assert.equal(bridge.migrated.status,'staged-only','no cutover claim');
  assert.equal(bridge.migrated.count,2);
  assert.equal(bridge.migrated.copiedThisPass,2);
  assert.equal(bridge.migrated.sourceCipherHashMatches,true,'ciphertext SHA-256 verified before and after staging');
  assert.equal(bridge.migrated.opIdSetHashMatches,true,'sorted logical operation identity set hash checked');
  assert.equal(bridge.repeated.status,'staged-only','staging can resume safely with same source');
  assert.equal(bridge.repeated.copiedThisPass,0,'repeat pass must not duplicate operations');
  assert.equal(bridge.resumed.status,'staged-only');
  assert.equal(bridge.resumed.copiedThisPass,1,'only the new legacy op is staged');
  assert.equal(bridge.resumed.opIdSetHashMatches,true);
  assert.equal(bridge.updatedSource,bridge.afterResume,'source remains untouched on incremental migration');
  assert.equal(JSON.parse(bridge.a).id,'original-op-A','preserves original operation identity');
  assert.equal(JSON.parse(bridge.b).id,'original-op-B','preserves original operation identity');
  assert.equal(JSON.parse(bridge.c).id,'original-op-C','reconciles new writer operation added after first pass');
  assert.equal(bridge.conflict.status,'blocked','same opId with altered payload is fail-closed');
  assert.equal(bridge.conflict.reason,'identity-conflict');
  assert.equal(bridge.conflictingSource,bridge.afterConflict,'legacy source never deleted even on conflict');
  assert.equal(JSON.parse(bridge.retained).body,'{"synthetic":true}','previously copied operation must not be overwritten by conflict');
  assert.equal(bridge.stale.status,'stale-source','legacy writer during staging invalidates the result');
  assert.equal(bridge.stale.sourcePreserved,true);
  assert.equal(bridge.recovery.status,'staged-only','recovery rechecks the fresh source');
  assert.equal(bridge.recovery.copiedThisPass,1,'only operation E needs importing on retry');
  assert.equal(bridge.afterStale,bridge.finalSource,'legacy writer update survives staging and recovery');
  assert.equal(JSON.parse(bridge.recoveredE).id,'original-op-E','newest concurrent legacy operation eventually included');
  console.log('P0 staging: SHA-256 source/set, reentrant retry, stale writer detection and recovery PASS; no live cutover/atomic sale.');
 } finally {
  await browser.close();await new Promise(r=>server.close(r));
 }
});
}
