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
 return {app,product,rack,read};
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
 const remote=(app.OCSync.estadoParaCheckpoint().productos||[]).find(p=>p.id===product.id);
 assert.ok(remote,'the product must be in the real cold-join checkpoint');
 assert.ok(!remote.fotoHash,'the checkpoint must not contain dangling photo pointer');
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
 // GET /api/productos strips internal fotoHash; inspect checkpoint below instead.
 assert.equal(p.foto,PNG,'photo survives hashing without loss');
 const remote=(app.OCSync.estadoParaCheckpoint().productos||[]).find(x=>x.id===product.id);
 assert.ok(remote,'variant must appear in cold-join checkpoint');
 assert.equal(remote.fotoHash,H);
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


test('P0 RED: rejected shelf bytes NEVER publish fotoHash or fotoRev in cold-join checkpoint',async()=>{
 const {app,rack}=await fixture();
 let attempts=0;
 app.OCFotos={leerFoto:async id=>{assert.equal(id,String(rack.id));return PNG;},
   hashDeDataUrl:async data=>{assert.equal(data,PNG);return H;},
   guardarPorHash:async(h,data)=>{assert.equal(h,H);assert.equal(data,PNG);attempts++;return false;}};
 assert.equal(await app.OCSync.hashearFotosPerchas(),0,'failed IDB commit does not count as converted');
 const remote=(app.OCSync.estadoParaCheckpoint().ubicaciones||[]).find(u=>u.id===rack.id);
 assert.ok(remote,'the shelf must remain visible to cold join');
 assert.ok(!remote.fotoHash,'no dangling shelf photo pointer');
 assert.ok(!remote.fotoRev,'failed copy must not mark photo as already handled');
 assert.equal(attempts,1,'the byte write must be attempted');
});
test('P0: shelf photo retries after rejected bytes and only publishes after true ACK',async()=>{
 const {app,rack}=await fixture();
 let attempts=0;
 app.OCFotos={leerFoto:async()=>PNG,hashDeDataUrl:async()=>H,guardarPorHash:async()=>++attempts===2};
 const check=()=> (app.OCSync.estadoParaCheckpoint().ubicaciones||[]).find(u=>u.id===rack.id);
 assert.equal(await app.OCSync.hashearFotosPerchas(),0);
 assert.ok(!check().fotoHash);
 assert.ok(!check().fotoRev);
 assert.equal(await app.OCSync.hashearFotosPerchas(),1);
 assert.equal(check().fotoHash,H);
 assert.ok(check().fotoRev,'confirmed bytes can create shelf revision');
 assert.equal(await app.OCSync.hashearFotosPerchas(),0);
 assert.equal(attempts,2,'after success, no redundant hash writes');
});
test('P0: thrown quota error keeps shelf photo unannounced and retryable',async()=>{
 const {app,rack}=await fixture();
 app.OCFotos={leerFoto:async()=>PNG,hashDeDataUrl:async()=>H,
   guardarPorHash:async()=>{throw Error('synthetic IDB quota rejection');}};
 assert.equal(await app.OCSync.hashearFotosPerchas(),0);
 const u=(app.OCSync.estadoParaCheckpoint().ubicaciones||[]).find(x=>x.id===rack.id);
 assert.ok(u);
 assert.ok(!u.fotoHash);
 assert.ok(!u.fotoRev);
});
