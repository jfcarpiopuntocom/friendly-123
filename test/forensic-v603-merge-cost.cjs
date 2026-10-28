'use strict';
// One metadata change, two synthetic browser contexts, REAL app Yjs apply+store bridge.
// No external network or production notebooks.
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const {webcrypto}=require('node:crypto'),{performance}=require('node:perf_hooks');
const {setTimeout:delay}=require('node:timers/promises');
const {browser}=require('./helpers/browser.cjs');
async function peer(n){
 const w=browser(),fx=await w.request('/api/respaldo/exportar');
 const template=fx.productos.find(p=>Number(p.stockActual)>=1);
 assert.ok(template);
 fx.productos=Array.from({length:n},(_,i)=>({
  ...template,id:'perf-merge-'+i,nombre:'Synthetic '+i,barcode:'PM'+i,sku:'SKU-PM-'+i,familiaId:'',productoBaseId:null,
  stockActual:10,stockBase:10,stockPN:{},stockTs:1,rev:{c:1,d:'benchmark'}
 }));
 fx.ventas=[];fx.movimientos=[];

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
 a.Y.applyUpdate(a.OCYjs.doc,b.Y.encodeStateAsUpdate(b.OCYjs.doc),'red');
 b.Y.applyUpdate(b.OCYjs.doc,a.Y.encodeStateAsUpdate(a.OCYjs.doc),'red');
 a.OCYjs._store.aplicar();b.OCYjs._store.aplicar();
 const pending=[];
 a.OCYjs.doc.on('update',(u,origin)=>{if(origin==='seed')pending.push(new Uint8Array(u))});
 const patch=await a.request('/api/productos/perf-merge-0','PATCH',{nombre:'Synthetic edited',precio:42});
 const t0=performance.now();
 a.OCYjs._store.sembrar();
 const seedMs=performance.now()-t0;
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

 console.log(JSON.stringify({kind:'single-remote-edit-1000',seedMs:+seedMs.toFixed(2),applyMs:+applyMs.toFixed(2),updates:pending.length,
  sourceName:local?.nombre,targetName:remote?.nombre,targetPrice:remote?.precio}));
 assert.equal(remote?.nombre,local?.nombre,'Remote must receive a single edited name');
 assert.equal(remote?.precio,local?.precio,'Remote must receive a single edited price');
})().catch(e=>{console.error(e);process.exitCode=1});
