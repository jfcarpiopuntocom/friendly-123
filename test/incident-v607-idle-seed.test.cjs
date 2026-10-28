const assert=require('node:assert/strict');
'use strict';
// Synthetic idle-seed regression; transport is blocked and all edits stay in memory.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {performance}=require('node:perf_hooks'),{webcrypto}=require('node:crypto');
const {setTimeout:delay}=require('node:timers/promises');
const {browser}=require('./helpers/browser.cjs');
async function run(n){
 const w=browser(); delete w.JSON;
 const fixture=await w.request('/api/respaldo/exportar');
 const template=fixture.productos.find(x=>Number(x.stockActual)>=1);
 if(!template)throw Error('Synthetic product template missing');
 fixture.productos=Array.from({length:n},(_,i)=>({
   ...template,id:'perf-synthetic-'+i,nombre:'F'+i,barcode:'PERF-'+i,
   stockActual:10,stockBase:10,stockPN:{},stockTs:1,rev:{c:1,d:'benchmark'}
 }));
 fixture.ventas=[];fixture.movimientos=[];

 Object.assign(w,{crypto:webcrypto,TextEncoder,TextDecoder,
   WebSocket:class{constructor(){throw Error('production relay forbidden')}},
   BroadcastChannel:class{constructor(){throw Error('network forbidden')}}});
 vm.runInContext(fs.readFileSync(path.join(__dirname,'../docs/vendor/yjs-bundle.min.js'),'utf8'),w);
 w.IndexeddbPersistence=class{once(){}};
 w.localStorage.setItem('f123_owned',JSON.stringify({licenseCode:'SYNTHETIC-ISOLATED-FIXTURE'}));
 vm.runInContext(fs.readFileSync(path.join(__dirname,'../docs/sync-yjs.js'),'utf8'),w);
 for(let i=0;i<100&&w.OCYjs.estado!=='activo';i++)await delay(10);
 if(w.OCYjs.estado!=='activo')throw Error('Yjs failed to start');
 await w.request('/api/respaldo/importar','POST',fixture);
 w.OCYjs._store.sembrar();
 assert.equal(Object.keys(w.OCYjs.getProductos()).length,n,'Yjs fixture must contain N real synthetic product rows');
 w.OCYjs._store.sembrar();
 let reads=0,normalizations=0;
 const read=w.OCSync.catalogoPropio;
 w.OCSync.catalogoPropio=function(){reads++;return read.call(this);};
 w.OCLatencia={ahoraRelay(){normalizations++;return Date.now();}};
 const times=[];
 for(let i=0;i<5;i++){
   const start=performance.now();
   w.OCYjs._store.sembrar();
   times.push(+(performance.now()-start).toFixed(2));
 }
 assert.equal(reads,5,'one catalog projection per synchronous seed');
 assert.equal(normalizations,0,'unchanged normalized products must not repeat stock merge');
 const id='perf-synthetic-0';
 await w.request('/api/productos/'+id+'/ajustar','POST',{delta:-3,motivo:'synthetic adjustment'});
 w.OCYjs._store.sembrar();
 assert.equal(w.OCYjs.getProductos()[id].stockActual,7,'local stock edit must invalidate the fixed point');
 await w.request('/api/productos/'+id,'PATCH',{nombre:'Edited locally',precio:42});
 w.OCYjs._store.sembrar();
 assert.equal(w.OCYjs.getProductos()[id].nombre,'Edited locally');
 w.__perfId=id;
 vm.runInContext("OCYjs.doc.transact(function(){var p=OCYjs.mapas.productos.get(__perfId);OCYjs.mapas.productos.set(__perfId,Object.assign({},p,{stockPN:Object.assign({},p.stockPN,{remote:{add:0,sub:1}}),stockActual:6,stockTs:Date.now()}));},'red');",w);
 w.OCYjs._store.sembrar();
 assert.equal(w.OCYjs.getProductos()[id].stockActual,6,'remote PN counter with unchanged metadata revision must survive');
 vm.runInContext("OCYjs.doc.transact(function(){var p=OCYjs.mapas.productos.get(__perfId);OCYjs.mapas.productos.set(__perfId,Object.assign({},p,{nombre:'Remote edit',rev:{c:999,d:'remote'}}));},'red');",w);
 normalizations=0;w.OCYjs._store.sembrar();
 assert.ok(normalizations>0,'remote replacement must invalidate the product fixed point');
 assert.equal(w.OCYjs.getProductos()[id].nombre,'Remote edit','stale local metadata cannot overwrite remote edit');
 const extraId='perf-synthetic-1';
 let extra={fotoHash:'synthetic-photo-hash',rev:{c:1000,d:'local'}};
 w.OCSync.catalogoPropio=function(){const cat=read.call(this);Object.assign(cat.productos.find(p=>p.id===extraId),extra);return cat;};
 w.OCYjs._store.sembrar();
 assert.equal(w.OCYjs.getProductos()[extraId].fotoHash,extra.fotoHash,'photo pointer edit must invalidate the fixed point');
 extra={borrado:true,rev:{c:1001,d:'local'}};w.OCYjs._store.sembrar();
 assert.equal(w.OCYjs.getProductos()[extraId].borrado,true,'product tombstone must still publish');
 extra={borrado:false,rev:{c:1002,d:'local'}};w.OCYjs._store.sembrar();
 assert.equal(w.OCYjs.getProductos()[extraId].borrado,false,'product restoration must still publish');
 return {products:n,noopSeedMs:times,meanMs:+(times.reduce((a,b)=>a+b,0)/times.length).toFixed(2)};
}
(async()=>{
 const small=await run(68),large=await run(1000);
 console.log(JSON.stringify({kind:'synthetic-v607-idle-seed',small,large}));
 if(large.meanMs<0||small.meanMs<0)throw Error('invalid timing');
})().catch(e=>{console.error(e);process.exitCode=1});
