'use strict';
// One metadata change, two synthetic browser contexts, REAL app Yjs apply+store bridge.
// No external network or production notebooks.
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const {webcrypto}=require('node:crypto'),{performance}=require('node:perf_hooks');
const {setTimeout:delay}=require('node:timers/promises');
const {browser}=require('./helpers/browser.cjs');
async function peer(n){
 const w=browser(); delete w.JSON;
 const fx=await w.request('/api/respaldo/exportar');
 const template=fx.productos.find(p=>Number(p.stockActual)>=1);
 assert.ok(template);
 fx.productos=Array.from({length:n},(_,i)=>({
  ...template,id:'perf-merge-'+i,nombre:'Synthetic '+i,barcode:'PM'+i,sku:'SKU-PM-'+i,familiaId:'',productoBaseId:null,
  stockActual:10,stockBase:10,stockPN:{},stockTs:1,rev:{c:1,d:'benchmark'}
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
(async()=>{
 const [a,b]=await Promise.all([peer(1000),peer(1000)]);
 a.OCYjs._store.sembrar();b.OCYjs._store.sembrar();
 assert.equal(Object.keys(a.OCYjs.getProductos()).length,1000,'source Yjs must hold the real synthetic catalog');
 assert.equal(Object.keys(b.OCYjs.getProductos()).length,1000,'target Yjs must hold the real synthetic catalog');
 a.Y.applyUpdate(a.OCYjs.doc,b.Y.encodeStateAsUpdate(b.OCYjs.doc),'red');
 b.Y.applyUpdate(b.OCYjs.doc,a.Y.encodeStateAsUpdate(a.OCYjs.doc),'red');
 const firstResult=[];
 const bOriginal=b.OCSync.aplicarCatalogo;
 b.OCSync.aplicarCatalogo=function(cat,role,canonical){const r=bOriginal(cat,role,canonical); firstResult.push({ok:r?.ok,actividadCompleta:r?.actividadCompleta,metadata:cat.nombreNegocio||''});return r;};
 a.OCYjs._store.aplicar();b.OCYjs._store.aplicar();
 console.log(JSON.stringify({kind:'initial-merge-readiness',firstResult}));
 b.OCSync.aplicarCatalogo=bOriginal;
 // Synthetic backend's WebSocket intentionally throws. Model the post-recovery
 // state explicitly: initial full merge was already accepted and complete.
 assert.equal(firstResult[0]?.ok,true);
 assert.equal(firstResult[0]?.actividadCompleta,true);
 a.OCYjs.canal.recuperando=false;
 b.OCYjs.canal.recuperando=false;
 const pending=[];
 a.OCYjs.doc.on('update',(u,origin)=>{if(origin==='seed')pending.push(new Uint8Array(u))});
 const patch=await a.request('/api/productos/perf-merge-0','PATCH',{nombre:'Synthetic edited',precio:42});
 const t0=performance.now();
 a.OCYjs._store.sembrar();
 const seedMs=performance.now()-t0;
 const remoteKeys={};
 for (const col of b.OCYjs.colecciones) {
   b.OCYjs.mapas[col].observe((event,tr)=>{
      if(tr.origin==='red')remoteKeys[col]=[...(remoteKeys[col]||[]),...Array.from(event.keysChanged).slice(0,5)];
   });
 }
 b.OCYjs.meta.observe((event,tr)=>{
   if(tr.origin==='red')remoteKeys._meta=[...(remoteKeys._meta||[]),...Array.from(event.keysChanged)];
 });
 const applyShapes=[];
 const originalApply=b.OCSync.aplicarCatalogo;
 b.OCSync.aplicarCatalogo=function(cat,rol,canonical) {
   applyShapes.push({productos:(cat.productos||[]).length,ubicaciones:(cat.ubicaciones||[]).length,
      ventas:(cat.ventas||[]).length,clientes:(cat.clientes||[]).length,
      nombre:cat.nombreNegocio||'',metaCanonical:canonical});
   return originalApply(cat,rol,canonical);
 };
 const t1=performance.now();
 for(const u of pending)b.Y.applyUpdate(b.OCYjs.doc,u,'red');
 b.OCYjs._store.aplicar();
 const applyMs=performance.now()-t1;
 const local=(await a.request('/api/productos')).find(p=>p.id==='perf-merge-0');
 const remote=(await b.request('/api/productos')).find(p=>p.id==='perf-merge-0');
 const yFrom=a.OCYjs.getProductos()['perf-merge-0']||null;
 const yTo=b.OCYjs.getProductos()['perf-merge-0']||null;
 console.log(JSON.stringify({kind:'forensic-meta-visibility',patch:{id:patch?.id,nombre:patch?.nombre,precio:patch?.precio},sourceRev:local?.rev,targetRev:remote?.rev,
   yFromName:yFrom?.nombre,yFromRev:yFrom?.rev,yToName:yTo?.nombre,yToRev:yTo?.rev,
   sourceStockBase:local?.stockBase,targetStockBase:remote?.stockBase,
   sourceYjsCount:Object.keys(a.OCYjs.getProductos()).length,targetYjsCount:Object.keys(b.OCYjs.getProductos()).length,
   sourceYjsFirst:Object.keys(a.OCYjs.getProductos()).slice(0,4),targetYjsFirst:Object.keys(b.OCYjs.getProductos()).slice(0,4)}));

 console.log(JSON.stringify({kind:'single-remote-edit-1000',seedMs:+seedMs.toFixed(2),applyMs:+applyMs.toFixed(2),updates:pending.length,applyShapes,remoteKeys,
  sourceName:local?.nombre,targetName:remote?.nombre,targetPrice:remote?.precio}));
 assert.equal(remote?.nombre,local?.nombre,'Remote must receive a single edited name');
 assert.equal(remote?.precio,local?.precio,'Remote must receive a single edited price');

 assert.equal(applyShapes.at(-1)?.productos,1,'only the product changed on a recovered channel');
 assert.equal(applyShapes.at(-1)?.ubicaciones,0,'unmodified shelves cannot be replayed as work');
 // Mixed metadata and product changes must NOT take the fast route.
 const mixedUpdates=[];
 a.OCYjs.doc.on('update',(update,origin)=>{ if(origin==='seed')mixedUpdates.push(new Uint8Array(update)); });
 vm.runInContext(`OCYjs.doc.transact(function(){
   var p=OCYjs.getProductos()['perf-merge-1'];
   OCYjs.mapas.productos.set('perf-merge-1',Object.assign({},p,{nombre:'Synthetic also changed'}));
   OCYjs.meta.set('nombreNegocio','SYNTHETIC-MIXED-METADATA');
 },'seed');`,a);
 for(const update of mixedUpdates)b.Y.applyUpdate(b.OCYjs.doc,update,'red');
 b.OCYjs._store.aplicar();
 assert.equal(applyShapes.at(-1)?.productos,1000,
   'mixed store identity change demands the full notebook merge');

})().catch(e=>{console.error(e);process.exitCode=1});
