'use strict';
// Isolated real backend + vendored Yjs; no external relay or customer data.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const {webcrypto}=require('node:crypto');
const {browser}=require('./helpers/browser.cjs');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
async function settle(){for(let i=0;i<20;i++)await tick();}
async function peer(){
  const w=browser(),timers=[];delete w.JSON;
  w.setTimeout=(fn,ms)=>{const timer={fn,ms,on:true};timers.push(timer);return timer;};
  w.clearTimeout=timer=>{if(timer)timer.on=false;};
  w.setInterval=(fn,ms)=>{const timer={fn,ms,on:true,interval:true};timers.push(timer);return timer;};
  const flush=async()=>{
    for(let i=0;i<5;i++){
      for(const timer of timers.filter(t=>t.on&&!t.interval&&t.ms===0)){timer.on=false;timer.fn();}
      await settle();
    }
  };
  Object.assign(w,{crypto:webcrypto,TextEncoder,TextDecoder,
    F123Relay:{connect(){throw Error('External relay forbidden');}},
    BroadcastChannel:class{constructor(){throw Error('External channel forbidden');}}});
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../docs/vendor/yjs-bundle.min.js'),'utf8'),w);
  w.IndexeddbPersistence=class{once(){}};
  w.localStorage.setItem('f123_owned',JSON.stringify({licenseCode:'SYNTHETIC-V608-PUBLICATION'}));
  w.OCAuth={rolActual:()=> 'dueno'};
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../docs/sync-yjs.js'),'utf8'),w);
  for(let i=0;i<100&&w.OCYjs.estado!=='activo';i++)await new Promise(resolve=>setTimeout(resolve,10));
  assert.equal(w.OCYjs.estado,'activo');
  return {w,timers,flush};
}

test('accepted stock republishes after a previous background save failure without waiting for the sweep',async()=>{
  const a=await peer(),b=await peer();
  const fixture=await a.w.request('/api/respaldo/exportar');
  fixture.productos=[{...fixture.productos[0],id:'synthetic-stock',nombre:'Synthetic stock',barcode:'SYN-V608',
    stockActual:2,stockBase:2,stockPN:{},stockTs:1,rev:{c:1,d:'fixture'}}];
  fixture.ventas=[];fixture.movimientos=[];
  for(const p of [a,b]){await p.w.request('/api/respaldo/importar','POST',fixture);p.w.OCYjs._store.sembrar();}
  const transfer=()=>{
    b.w.Y.applyUpdate(b.w.OCYjs.doc,a.w.Y.encodeStateAsUpdate(a.w.OCYjs.doc),'red');
    b.w.OCYjs._store.aplicar();
  };
  transfer();await a.flush();await b.flush();
  let fail=true;
  a.w.navigator.locks={request:(name,options,fn)=>String(name).startsWith('f123-estado-ab')&&fail
    ?Promise.reject(Object.assign(Error('Synthetic lock failure'),{name:'AbortError'}))
    :Promise.resolve((fn||options)())};
  await a.w.request('/api/productos/synthetic-stock','PATCH',{nombre:'Synthetic pending background save'});
  await settle();await a.flush();
  assert.equal(a.w.OCSync.catalogoPropio(),null,'failed storage still blocks publication');
  fail=false;
  let events=0;a.w.addEventListener('oc-catalogo-cambiado',()=>events++);
  const accepted=await a.w.request('/api/productos/synthetic-stock/ajustar','POST',{delta:9,motivo:'Synthetic recovery'});
  await settle();await a.flush();transfer();await b.flush();
  assert.equal(accepted.stockActual,11);
  assert.ok(a.w.OCSync.catalogoPropio(),'recovered durable save opens the existing publication guard');
  assert.ok(events>0,'a previously blocked notification must resume after durable confirmation');
  assert.equal(a.w.OCYjs.getProductos()['synthetic-stock'].stockActual,11,'producer publishes without periodic sweep');
  assert.equal((await b.w.request('/api/productos/synthetic-stock')).stockActual,11,'receiver backend adopts accepted stock');
  assert.ok(a.timers.some(t=>t.interval&&t.ms===2000),'existing fallback remains available but was never invoked');
});
