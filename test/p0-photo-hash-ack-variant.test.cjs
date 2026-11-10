'use strict';
// P0: a mobile photo visible inline must NEVER produce a cross-device hash
// pointer until its exact bytes have been confirmed in the local hash store.
// Synthetic individual-product variant, no real business/images/network.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {browser}=require('./helpers/browser.cjs');
const PNG='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const H='a'.repeat(64);
async function fixture(){
 const app=browser();
 app.OCAuth={rolActual:()=> 'dueno',puedeGestionar:()=>true};
 const rack=await app.request('/api/ubicaciones','POST',{nombre:'Synthetic photo shelf',tipo:'propio'});
 const product=await app.request('/api/productos','POST',{
   nombre:'Spray de la verdad — Bourgeois [SYNTHETIC]',
   sku:'SYNTH-009-BOURGEOIS',barcode:'SYNTH-009-BOURGEOIS',
   precio:12,stockInicial:7,ubicacionId:rack.id,foto:PNG
 });
 assert.ok(product.id);
 const read=async()=> (await app.request('/api/productos')).find(p=>p.id===product.id);
 return {app,product,read};
}
test('P0 RED: rejected content-addressed blob never publishes missing photoHash to other devices',async()=>{
 const {app,read,product}=await fixture();
 const calls=[];
 app.OCFotos={hashDeDataUrl:async data=>{assert.equal(data,PNG);return H;},
   guardarPorHash:async (hash,data)=>{calls.push([hash,data]);return false;}};
 const converted=await app.OCSync.hashearFotosProductos();
 assert.equal(converted,0,'a failed blob commit cannot count as converted');
 assert.equal(calls.length,1);
 const local=await read();
 assert.equal(local.foto,PNG,'keep source inline photo on mobile; never discard evidence');
 assert.ok(!local.fotoHash,'a hash without durable photo bytes must not be assigned');
 const remote=(app.catalog().productos||[]).find(p=>p.id===product.id);
 assert.ok(!remote?.fotoHash,'the catalog shared to PC must not contain a dangling pointer');
});
test('P0: a later successful durable hash-store write retries and only then announces one pointer',async()=>{
 const {app,read,product}=await fixture();
 let attempts=0;
 app.OCFotos={hashDeDataUrl:async()=>H,
   guardarPorHash:async()=>++attempts===2};
 assert.equal(await app.OCSync.hashearFotosProductos(),0,'first IDB failure must leave photo retryable');
 assert.ok(!(await read()).fotoHash);
 assert.equal(await app.OCSync.hashearFotosProductos(),1,'second confirmed commit can safely announce');
 const p=await read();
 assert.equal(p.fotoHash,H);
 assert.equal(p.foto,PNG,'photo survives hashing without loss');
 const remote=(app.catalog().productos||[]).find(x=>x.id===product.id);
 assert.equal(remote?.fotoHash,H);
 assert.equal(attempts,2);
 assert.equal(await app.OCSync.hashearFotosProductos(),0,'no redundant rehash after confirmed pointer');
 assert.equal(attempts,2);
});
test('P0: thrown quota error must not create a dangling photo pointer',async()=>{
 const {app,read}=await fixture();
 app.OCFotos={hashDeDataUrl:async()=>H,guardarPorHash:async()=>{throw Error('synthetic quota');}};
 assert.equal(await app.OCSync.hashearFotosProductos(),0);
 assert.ok(!(await read()).fotoHash);
 assert.equal((await read()).foto,PNG);
});
