'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const http=require('node:http');
const {chromium}=require('playwright');
const runtime=fs.readFileSync(path.join(__dirname,'../docs/estado-idb.js'),'utf8');

test('P0 single-DB schema v2 staging: legacy snapshot retained, encrypted ops copied atomically and read back', {timeout:45000}, async()=>{
 const server=http.createServer((_req,res)=>{res.writeHead(200,{'Content-Type':'text/html'});res.end('<!doctype html><title>synthetic P0</title>')});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const browser=await chromium.launch({headless:true});
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
  const result=await page.evaluate(async()=>{
   const state=window.OCEstadoIDB;
   const preserved=await state.leer();
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
   return {preserved,invalid,copied,a,b,duplicate,survivor,aborted,opened};
  });
  assert.equal(result.preserved.nombreNegocio,'SYNTHETIC');
  assert.equal(result.preserved._rev,1);
  assert.equal(result.invalid,false,'invalid duplicate input fails closed');
  assert.equal(result.copied,true,'complete + read-back required for staging ACK');
  assert.equal(result.a.blob,'encrypted-one');
  assert.equal(result.b.blob,'encrypted-two');
  assert.equal(result.duplicate,false,'unique opId rejects overwrites');
  assert.equal(result.survivor.blob,'encrypted-one','original migration copy never rewritten');
  assert.equal(result.aborted,null,'failed batch never partially copies the second row');
  for(const store of ['estado','outbox','dedup','trace_intent','trace_outcome'])assert(result.opened.includes(store),store+' exists in same database');
  console.log('P0 v2 staging fixture PASS. This does NOT migrate the live legacy encrypted blob or prove atomic sale.');
 } finally {
  await browser.close();await new Promise(r=>server.close(r));
 }
});
