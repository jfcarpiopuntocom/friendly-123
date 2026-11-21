'use strict';
// C112 P0: run the exact browser-side mock-backend.js, never customer network.
// HTTP 200 for product creation requires a strict atomic IDB ACK, not background save.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {browser}=require('./helpers/browser.cjs');
const create=(w,barcode)=>w.fetch('/api/productos',{method:'POST',body:JSON.stringify({
  nombre:'Synthetic durable product', barcode,sku:barcode,stockInicial:7,
  precio:12,costo:5,umbralRojo:2,umbralAmarillo:5
})});
const state=w=>w.request('/api/respaldo/exportar');
function count(state,barcode){return state.productos.filter(p=>p.barcode===barcode).length}

test('C112 RED: a rejected durable product create NEVER yields 200, stock, audit or catalog event',async()=>{
 const w=browser();
 const barcode='C112-REJECT-0001';
 const before=await state(w);
 let notices=0,strictCalls=0;
 w.addEventListener('oc-catalogo-cambiado',()=>{notices++});
 const originalSet=w.localStorage.setItem;
 w.localStorage.setItem=()=>{throw Error('synthetic alternate A/B store unavailable')};
 w.OCEstadoIDB={soportado:true,guardarConRevision:async()=>{strictCalls++;return false;},ultimoError:()=>null};
 let response;
 try{response=await create(w,barcode);}finally{w.localStorage.setItem=originalSet;delete w.OCEstadoIDB;}
 assert.equal(response.status,503,'must not report success while the durable write was refused');
 assert.ok(strictCalls>=1,'creation must invoke strict CAS');
 const after=await state(w);
 assert.equal(count(after,barcode),0,'failed creation must not remain in catalog');
 assert.equal(after.movimientos.length,before.movimientos.length,'no ghost high-integrity audit fact');
 assert.equal(after.selloUltimo,before.selloUltimo,'movement seal must roll back');
 assert.equal(notices,0,'uncommitted product cannot be published to another browser');
});

test('C112 RED: product remains provisional until ACK; on true only one event and one signed movement',async()=>{
 const w=browser();
 const barcode='C112-COMMIT-0001';
 const before=await state(w);
 let notices=0,pending;
 w.addEventListener('oc-catalogo-cambiado',()=>{notices++});
 const originalSet=w.localStorage.setItem;
 w.localStorage.setItem=()=>{throw Error('synthetic A/B not writable')};
 w.OCEstadoIDB={soportado:true,guardarConRevision:(candidate,expectedRev)=>new Promise(resolve=>{pending={candidate,expectedRev,resolve}}),ultimoError:()=>null};
 let response,settled=false;
 try{
   const inFlight=create(w,barcode).then(v=>{settled=true;return v});
   for(let i=0;i<150&&!pending;i++)await Promise.resolve();
   assert.ok(pending,'strict CAS must be in flight before HTTP success');
   assert.equal(settled,false,'user cannot see 200 before durable transaction completes');
   assert.equal(notices,0,'no catalog fan-out while save is pending');
   assert.equal(count(pending.candidate,barcode),1,'strict snapshot contains the new item');
   pending.resolve(true);
   response=await inFlight;
 }finally{w.localStorage.setItem=originalSet;delete w.OCEstadoIDB;}
 assert.equal(response.status,200);
 const after=await state(w);
 assert.equal(count(after,barcode),1);
 assert.equal(after.movimientos.length,before.movimientos.length+1,'exactly one signed alta movement');
 assert.equal(notices,1,'exactly one catalog notification follows ACK');
});

test('C112: ordinary offline fixture still accepts a new product with available durable A/B',async()=>{
 const w=browser();
 const barcode='C112-LEGACY-0001';
 const r=await create(w,barcode);
 assert.equal(r.status,200,'local backwards-compatible storage must still work');
 const result=await r.json();
 assert.ok(result&&result.id);
 assert.equal(count(await state(w),barcode),1);
});
