'use strict';
// Read-only synthetic performance investigation. No real rooms, backups or sales.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {performance}=require('node:perf_hooks'),{webcrypto}=require('node:crypto');
const {setTimeout:delay}=require('node:timers/promises');
const {browser}=require('./helpers/browser.cjs');
async function run(n){
 const w=browser();
 const fixture=await w.request('/api/respaldo/exportar');
 const template=fixture.productos.find(x=>Number(x.stockActual)>=1);
 if(!template)throw Error('Synthetic product template missing');
 fixture.productos=Array.from({length:n},(_,i)=>({
   ...template,id:'perf-synthetic-'+i,nombre:'F'+i,barcode:'PERF-'+i,
   stockActual:10,stockBase:10,stockPN:{},stockTs:1,rev:{c:1,d:'benchmark'}
 }));
 fixture.ventas=[];fixture.movimientos=[];
 await w.request('/api/respaldo/importar','POST',fixture);
 Object.assign(w,{crypto:webcrypto,TextEncoder,TextDecoder,
   WebSocket:class{constructor(){throw Error('production relay forbidden')}},
   BroadcastChannel:class{constructor(){throw Error('network forbidden')}}});
 vm.runInContext(fs.readFileSync(path.join(__dirname,'../docs/vendor/yjs-bundle.min.js'),'utf8'),w);
 w.IndexeddbPersistence=class{once(){}};
 w.localStorage.setItem('f123_owned',JSON.stringify({licenseCode:'SYNTHETIC-ISOLATED-FIXTURE'}));
 vm.runInContext(fs.readFileSync(path.join(__dirname,'../docs/sync-yjs.js'),'utf8'),w);
 for(let i=0;i<100&&w.OCYjs.estado!=='activo';i++)await delay(10);
 if(w.OCYjs.estado!=='activo')throw Error('Yjs failed to start');
 const times=[];
 for(let i=0;i<5;i++){
   const start=performance.now();
   w.OCYjs._store.sembrar();
   times.push(+(performance.now()-start).toFixed(2));
 }
 return {products:n,noopSeedMs:times,meanMs:+(times.reduce((a,b)=>a+b,0)/times.length).toFixed(2)};
}
(async()=>{
 const small=await run(68),large=await run(1000);
 console.log(JSON.stringify({kind:'synthetic-v603-whole-catalog-seed',small,large}));
 if(large.meanMs<0||small.meanMs<0)throw Error('invalid timing');
})().catch(e=>{console.error(e);process.exitCode=1});
