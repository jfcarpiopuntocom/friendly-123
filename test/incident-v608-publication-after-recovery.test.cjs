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
  // P0 FORENSIC: observe every boundary; synthetic data only.
  const _aY=a.w.OCYjs.getProductos()['synthetic-stock'];
  const _bY=b.w.OCYjs.getProductos()['synthetic-stock'];
  const _bState=(await b.w.request('/api/respaldo/exportar')).productos.find(p=>p.id==='synthetic-stock');
  console.error('P0_STOCK_11_VS_2_BOUNDARY',JSON.stringify({
    emitterAccepted:accepted.stockActual,
    emitterYjs:_aY&&{stock:_aY.stockActual,base:_aY.stockBase,pn:_aY.stockPN,ts:_aY.stockTs},
    receiverYjs:_bY&&{stock:_bY.stockActual,base:_bY.stockBase,pn:_bY.stockPN,ts:_bY.stockTs},
    receiverStore:_bState&&{stock:_bState.stockActual,base:_bState.stockBase,pn:_bState.stockPN,ts:_bState.stockTs},
    receiverYjsRevision:b.w.OCYjs._catalogoRevision
  }));
  assert.equal(accepted.stockActual,11);
  assert.ok(a.w.OCSync.catalogoPropio(),'recovered durable save opens the existing publication guard');
  assert.ok(events>0,'a previously blocked notification must resume after durable confirmation');
  assert.equal(a.w.OCYjs.getProductos()['synthetic-stock'].stockActual,11,'producer publishes without periodic sweep');
  assert.equal((await b.w.request('/api/productos/synthetic-stock')).stockActual,11,'receiver backend adopts accepted stock');
  assert.ok(a.timers.some(t=>t.interval&&t.ms===2000),'existing fallback remains available but was never invoked');
});


// Minimal synthetic stress: these tests do NOT exercise customer records, relay
// credentials, GitHub production deployments, or arbitrary browser data.
async function physicalFixture(a,b,stockBaseA,stockBaseB) {
  const f=await a.w.request('/api/respaldo/exportar');
  f.productos=[{...f.productos[0],id:'p0-two-actors',nombre:'Synthetic two-actor inventory',
    barcode:'P0-FIXTURE-TWO-PEERS',stockActual:stockBaseA,stockBase:stockBaseA,
    stockPN:{},stockTs:1,rev:{c:1,d:'fixture'}}];
  f.ventas=[];f.movimientos=[];
  const g=JSON.parse(JSON.stringify(f));
  g.productos[0].stockActual=stockBaseB;g.productos[0].stockBase=stockBaseB;
  await a.w.request('/api/respaldo/importar','POST',f);
  await b.w.request('/api/respaldo/importar','POST',g);
  a.w.OCYjs._store.sembrar();b.w.OCYjs._store.sembrar();
  await a.flush();await b.flush();
}
async function exchange(a,b,rounds=1){
  for(let i=0;i<rounds;i++){
    const aState=a.w.Y.encodeStateAsUpdate(a.w.OCYjs.doc);
    const bState=b.w.Y.encodeStateAsUpdate(b.w.OCYjs.doc);
    b.w.Y.applyUpdate(b.w.OCYjs.doc,aState,'red');
    a.w.Y.applyUpdate(a.w.OCYjs.doc,bState,'red');
    a.w.OCYjs._store.aplicar();b.w.OCYjs._store.aplicar();
    await a.flush();await b.flush();
  }
}
const fixtureProduct=async p=>(await p.w.request('/api/respaldo/exportar')).productos.find(x=>x.id==='p0-two-actors');

test('P0 independent PN witnesses converge two offline additions and repeated replay exactly once',async()=>{
  const a=await peer(),b=await peer();
  await physicalFixture(a,b,2,2);
  await a.w.request('/api/productos/p0-two-actors/ajustar','POST',{delta:9,motivo:'actor A'});
  await b.w.request('/api/productos/p0-two-actors/ajustar','POST',{delta:4,motivo:'actor B'});
  await a.flush();await b.flush();
  await exchange(a,b,3);
  for(const p of [a,b]){
    const item=await fixtureProduct(p);
    assert.equal(item.stockActual,15,'both independent additions survive concurrent Y.Map object writes');
    assert.equal(Object.keys(item.stockPN).length,2,'one PN actor per device, not duplicated');
  }
  await exchange(b,a,3);
  assert.equal((await fixtureProduct(a)).stockActual,15,'replay cannot duplicate a counter');
  assert.equal((await fixtureProduct(b)).stockActual,15,'reverse replay cannot duplicate a counter');
});

test('P0 distinct physical baselines preserve BOTH witnesses, never fabricate summed stock',async()=>{
  const a=await peer(),b=await peer();
  await physicalFixture(a,b,2,11);
  await a.w.request('/api/productos/p0-two-actors/ajustar','POST',{delta:9,motivo:'baseline A'});
  await b.w.request('/api/productos/p0-two-actors/ajustar','POST',{delta:4,motivo:'baseline B'});
  await a.flush();await b.flush();
  await exchange(a,b,3);
  for(const p of [a,b]){
    const item=await fixtureProduct(p);
    assert.ok(item.stockEvidencias?.['2']?.pn,'first physical baseline retained');
    assert.ok(item.stockEvidencias?.['11']?.pn,'second physical baseline retained');
    assert.ok([11,15].includes(item.stockActual),'effective display must be one legacy baseline, not an invented sum');
  }
});

test('P0 two offline sales preserve money IDs once and both physical decrements',async()=>{
  const a=await peer(),b=await peer();
  await physicalFixture(a,b,6,6);
  const sA=await a.w.request('/api/productos/p0-two-actors/venta','POST',{cantidad:1});
  const sB=await b.w.request('/api/productos/p0-two-actors/venta','POST',{cantidad:1});
  assert.ok(sA.ventaId && sB.ventaId && sA.ventaId!==sB.ventaId,'two distinct receipt IDs');
  await a.flush();await b.flush();
  await exchange(a,b,3);
  for(const p of [a,b]){
    const snap=await p.w.request('/api/respaldo/exportar');
    const item=snap.productos.find(x=>x.id==='p0-two-actors');
    assert.equal(item.stockActual,4,'both sales subtract one each');
    assert.equal(snap.ventas.filter(x=>x.id===sA.ventaId).length,1,'sale A economic receipt exactly once');
    assert.equal(snap.ventas.filter(x=>x.id===sB.ventaId).length,1,'sale B economic receipt exactly once');
  }
  await exchange(a,b,2);
  assert.equal((await fixtureProduct(a)).stockActual,4,'replay cannot subtract again');
});


test('P0 third peer adopting two disconnected sales retains both receipts exactly once',async()=>{
  const a=await peer(),b=await peer(),c=await peer();
  await physicalFixture(a,b,8,8);
  const snap=await a.w.request('/api/respaldo/exportar');
  await c.w.request('/api/respaldo/importar','POST',snap);
  c.w.OCYjs._store.sembrar();
  const r1=await a.w.request('/api/productos/p0-two-actors/venta','POST',{cantidad:2});
  const r2=await b.w.request('/api/productos/p0-two-actors/venta','POST',{cantidad:1});
  await a.flush();await b.flush();
  await exchange(a,b,3);
  const state=a.w.Y.encodeStateAsUpdate(a.w.OCYjs.doc);
  c.w.Y.applyUpdate(c.w.OCYjs.doc,state,'red');
  c.w.OCYjs._store.aplicar();await c.flush();
  // Third peer has its own concurrent old whole-object product in its Y.Doc.
  // The independent PN witnesses must override only derived SAME-base counts.
  await exchange(c,a,2);await exchange(c,b,2);
  const history=await c.w.request('/api/respaldo/exportar');
  assert.equal(history.productos.find(p=>p.id==='p0-two-actors').stockActual,5);
  assert.equal(history.ventas.filter(v=>v.id===r1.ventaId).length,1);
  assert.equal(history.ventas.filter(v=>v.id===r2.ventaId).length,1);
});

test('P0 300-product notebook: remote PN update converges without full-item write loss',async()=>{
  const a=await peer(),b=await peer();
  const f=await a.w.request('/api/respaldo/exportar');
  const seed={...f.productos[0],stockActual:2,stockBase:2,stockPN:{},stockTs:1,rev:{c:1,d:'fixture'}};
  f.productos=Array.from({length:300},(_,i)=>({...seed,id:'p0-perf-'+i,
    nombre:'Synthetic performance item '+i,barcode:'P0-PERF-'+i}));
  f.ventas=[];f.movimientos=[];
  await a.w.request('/api/respaldo/importar','POST',f);
  await b.w.request('/api/respaldo/importar','POST',f);
  a.w.OCYjs._store.sembrar();b.w.OCYjs._store.sembrar();await a.flush();await b.flush();
  await a.w.request('/api/productos/p0-perf-299/ajustar','POST',{delta:9,motivo:'300 product sync'});
  await a.flush();
  const start=Date.now();
  await exchange(a,b,2);
  const elapsed=Date.now()-start;
  assert.equal((await b.w.request('/api/productos/p0-perf-299')).stockActual,11);
  assert.equal((await b.w.request('/api/respaldo/exportar')).productos.length,300);
  console.error('P0_300_PRODUCT_NOTEBOOK_SYNTHETIC_REPLAY_MS',elapsed);
});
