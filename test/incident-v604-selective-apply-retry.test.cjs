'use strict';
// (JFC 2026-10-27) Aplicacion selectiva de productos remotos: si falla (excepcion o
// ok:false) NO se pierden los IDs; la siguiente aplicacion es completa y hay UN reintento.
// Tambien: origenes desconocidos (idb/null) fuerzan el merge completo (fail closed).
// Harness sintetico: sin red ni datos de produccion (igual que forensic-v603-merge-cost.cjs).
const {test}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const {webcrypto}=require('node:crypto');
const {setTimeout:delay}=require('node:timers/promises');
const {browser}=require('./helpers/browser.cjs');
async function peer(n){
 const w=browser(); delete w.JSON;
 const fx=await w.request('/api/respaldo/exportar');
 const template=fx.productos.find(p=>Number(p.stockActual)>=1);
 assert.ok(template);
 fx.productos=Array.from({length:n},(_,i)=>({
  ...template,id:'retry-'+i,nombre:'Synthetic '+i,barcode:'RT'+i,sku:'SKU-RT-'+i,familiaId:'',productoBaseId:null,
  stockActual:10,stockBase:10,stockPN:{},stockTs:1,rev:{c:1,d:'retry'}
 }));
 fx.ventas=[];fx.movimientos=[];fx.selloUltimo='';fx.actividadCompartida=[];fx.actividad=[];
 Object.assign(w,{crypto:webcrypto,TextEncoder,TextDecoder,
   WebSocket:class{constructor(){throw Error('No production transport')}},
   BroadcastChannel:class{constructor(){throw Error('No external channel')}}});
 vm.runInContext(fs.readFileSync(path.join(__dirname,'../docs/vendor/yjs-bundle.min.js'),'utf8'),w);
 w.IndexeddbPersistence=class{once(){}};
 w.localStorage.setItem('f123_owned',JSON.stringify({licenseCode:'SYNTHETIC-ISOLATED-FIXTURE'}));
 vm.runInContext(fs.readFileSync(path.join(__dirname,'../docs/sync-yjs.js'),'utf8'),w);
 for(let i=0;i<100&&w.OCYjs.estado!=='activo';i++)await delay(10);
 assert.equal(w.OCYjs.estado,'activo');
 await w.request('/api/respaldo/importar','POST',fx);
 return w;
}
// Deja a b con el primer merge completo ya aceptado y captura sus timers (los del VM son no-op).
async function listo(){
 const [a,b]=await Promise.all([peer(3),peer(3)]);
 a.OCYjs._store.sembrar();b.OCYjs._store.sembrar();
 a.Y.applyUpdate(a.OCYjs.doc,b.Y.encodeStateAsUpdate(b.OCYjs.doc),'red');
 b.Y.applyUpdate(b.OCYjs.doc,a.Y.encodeStateAsUpdate(a.OCYjs.doc),'red');
 b.OCYjs._store.aplicar();                 // merge completo aceptado
 a.OCYjs._store.aplicar();
 // segunda ronda: absorbe lo que sembrar() de cada lado vuelve a publicar (meta, etc.)
 a.OCYjs._store.sembrar();b.OCYjs._store.sembrar();
 a.Y.applyUpdate(a.OCYjs.doc,b.Y.encodeStateAsUpdate(b.OCYjs.doc),'red');
 b.Y.applyUpdate(b.OCYjs.doc,a.Y.encodeStateAsUpdate(a.OCYjs.doc),'red');
 b.OCYjs._store.aplicar();a.OCYjs._store.aplicar();
 a.OCYjs.canal.recuperando=false;b.OCYjs.canal.recuperando=false;
 const timers=[];
 b.setTimeout=function(fn,ms){timers.push({fn,ms});return timers.length;};
 const shapes=[];const orig=b.OCSync.aplicarCatalogo;
 b.OCSync.aplicarCatalogo=function(cat,rol,c){shapes.push((cat.productos||[]).length);return orig(cat,rol,c);};
 return {a,b,timers,shapes,orig};
}
async function editar(a,id,nombre){
 // Edicion de A directa en su Y.Map (origen "seed" = escritura local), con rev mas nueva.
 const ups=[];const h=(u,o)=>{if(o==='seed')ups.push(new Uint8Array(u));};
 a.OCYjs.doc.on('update',h);
 a.__id=id;a.__nombre=nombre;
 vm.runInContext(`OCYjs.doc.transact(function(){
   var p=OCYjs.getProductos()[__id];
   OCYjs.mapas.productos.set(__id,Object.assign({},p,{nombre:__nombre,precio:42,rev:{c:50,d:'device-A'}}));
 },'seed');`,a);
 a.OCYjs.doc.off('update',h);
 assert.equal(ups.length,1,'el aparato A emite un update de producto');
 return ups;
}
const nombre=async(w,id)=>(await w.request('/api/productos')).find(p=>p.id===id)?.nombre;

for(const modo of ['throw','ok:false']){
 test('aplicacion selectiva que falla ('+modo+') no pierde el producto A: reintento completo',async()=>{
  const {a,b,timers,shapes,orig}=await listo();
  const ups=await editar(a,'retry-0','A edited remote');
  for(const u of ups)b.Y.applyUpdate(b.OCYjs.doc,u,'red');
  shapes.length=0;timers.length=0;
  b.OCSync.aplicarCatalogo=function(cat){shapes.push((cat.productos||[]).length);
    if(modo==='throw')throw new Error('boom');return {ok:false};};
  b.OCYjs._store.aplicar();                                  // selectiva (1 producto) y falla
  assert.equal(shapes.at(-1),1,'la primera aplicacion es selectiva');
  assert.notEqual(await nombre(b,'retry-0'),'A edited remote');
  const reint=timers.filter(t=>t.ms===2000);
  assert.equal(reint.length,1,'debe agendarse exactamente UN reintento de ~2000 ms');
  b.OCYjs._store.aplicar();                                  // no se apila otro reintento
  assert.equal(timers.filter(t=>t.ms===2000).length,1,'los reintentos no se apilan');
  b.OCSync.aplicarCatalogo=function(cat,rol,c){shapes.push((cat.productos||[]).length);return orig(cat,rol,c);};
  reint[0].fn();                                             // dispara el reintento
  assert.equal(shapes.at(-1),3,'el reintento es una aplicacion COMPLETA');
  assert.equal(await nombre(b,'retry-0'),'A edited remote','el producto A llega al store');
 });
}

test('reintentos: backoff progresivo no martillea relay; un exito reinicia el contador',async()=>{
 const {a,b,timers,orig}=await listo();
 const ups=await editar(a,'retry-0','A cap');
 for(const u of ups)b.Y.applyUpdate(b.OCYjs.doc,u,'red');
 b.OCSync.aplicarCatalogo=function(){throw new Error('boom');};
 b.OCYjs._store.aplicar();
 const delays=[2000,4000,8000,16000,32000];
 for(const ms of delays){
  const i=timers.findIndex(t=>t.ms===ms);
  assert.ok(i>=0,'expected bounded retry delay '+ms);
  const t=timers.splice(i,1)[0];t.fn();
 }
 assert.ok(timers.some(t=>t.ms===64000),'unresolved work is retained but next retry backs off');
 b.OCSync.aplicarCatalogo=orig;
 b.OCYjs._store.aplicar();
 assert.equal(await nombre(b,'retry-0'),'A cap');
 b.OCSync.aplicarCatalogo=function(){throw new Error('boom');};
 const ups2=await editar(a,'retry-1','A cap 2');
 for(const u of ups2)b.Y.applyUpdate(b.OCYjs.doc,u,'red');
 b.OCYjs._store.aplicar();
 assert.ok(timers.some(t=>t.ms===2000),'successful application resets retry delay');
});

test('1b: un update con origen desconocido (idb) tras el primer merge fuerza el merge completo',async()=>{
 const {a,b,shapes}=await listo();
 const u0=await editar(a,'retry-0','via red');
 const u1=await editar(a,'retry-1','via idb');
 for(const u of u1)b.Y.applyUpdate(b.OCYjs.doc,u,'idb');
 for(const u of u0)b.Y.applyUpdate(b.OCYjs.doc,u,'red');
 shapes.length=0;
 b.OCYjs._store.aplicar();
 assert.equal(shapes.at(-1),3,'origen desconocido => aplicacion completa, no selectiva');
 assert.equal(await nombre(b,'retry-1'),'via idb');
 assert.equal(await nombre(b,'retry-0'),'via red');
});

test('1b: la escritura local (origen seed) NO mata la via selectiva',async()=>{
 const {a,b,shapes}=await listo();
 b.OCYjs._store.sembrar();                                   // escritura local propia
 const ups=await editar(a,'retry-0','solo uno');
 for(const u of ups)b.Y.applyUpdate(b.OCYjs.doc,u,'red');
 shapes.length=0;
 b.OCYjs._store.aplicar();
 assert.equal(shapes.at(-1),1,'sigue selectiva');
});
