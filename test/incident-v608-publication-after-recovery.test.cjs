'use strict';
// Isolated real backend + vendored Yjs; no external relay or customer data.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const {webcrypto}=require('node:crypto');
const {browser}=require('./helpers/browser.cjs');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
async function settle(){for(let i=0;i<20;i++)await tick();}
async function peer(options={}){
  const w=browser(options.storage),timers=[];delete w.JSON;
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
  const syncFile=options.legacy === 'v606' ? process.env.F123_V606_SYNC_FILE :
    options.legacy ? process.env.F123_V607_SYNC_FILE : path.join(__dirname,'../docs/sync-yjs.js');
  assert.ok(syncFile&&fs.existsSync(syncFile),'v607 historical sync script must be fetched at exact pinned SHA');
  vm.runInContext(fs.readFileSync(syncFile,'utf8'),w);
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
    // Two-way exchange like a real relay. One-way delivery left B's own concurrent seed item of the same key
    // un-merged on A; Yjs breaks that tie by random clientID, so B's stale seed won ~50% of runs.
    a.w.Y.applyUpdate(a.w.OCYjs.doc,b.w.Y.encodeStateAsUpdate(b.w.OCYjs.doc),'red');
    a.w.OCYjs._store.aplicar();
  };
  transfer();await a.flush();await b.flush();
  // Reproduce failure in the CURRENT A/B + IDB durability path.
  // navigator.locks was retired; injecting a Web Lock rejection did nothing.
  let fail=true;
  const setItem=a.w.localStorage.setItem.bind(a.w.localStorage);
  a.w.localStorage.setItem=(key,value)=>{
    if(fail)throw Object.assign(Error('Synthetic durable write failure'),{name:'AbortError'});
    return setItem(key,value);
  };
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
async function exchangeBinaryDelta(a,b){
  const A=a.w.Y,B=b.w.Y;
  const bVector=B.encodeStateVector(b.w.OCYjs.doc);
  const aVector=A.encodeStateVector(a.w.OCYjs.doc);
  const t0=Date.now();
  const bytesFromA=A.encodeStateAsUpdate(a.w.OCYjs.doc,bVector);
  const bytesFromB=B.encodeStateAsUpdate(b.w.OCYjs.doc,aVector);
  const t1=Date.now();
  B.applyUpdate(b.w.OCYjs.doc,bytesFromA,'red');
  A.applyUpdate(a.w.OCYjs.doc,bytesFromB,'red');
  const t2=Date.now();
  // The production Y.Doc "update" listener itself schedules the receiver
  // application. Do not call _store.aplicar() again; that would artificially
  // duplicate a full-catalog pass in the benchmark.
  await b.flush();
  const t3=Date.now();
  return {bytesA:bytesFromA.byteLength,bytesB:bytesFromB.byteLength,encodeMs:t1-t0,applyYjsMs:t2-t1,receiverStoreMs:t3-t2,totalMs:t3-t0};
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

test('P0 same-base PN witness does not duplicate its counter into stockEvidencias of ordinary catalog',async()=>{
  const a=await peer(),b=await peer();
  await physicalFixture(a,b,7,7);
  await a.w.request('/api/productos/p0-two-actors/ajustar','POST',{delta:1,motivo:'ordinary in-stock addition'});
  await a.flush();await exchange(a,b,2);
  const p=await fixtureProduct(b);
  assert.equal(p.stockActual,8);
  assert.equal(Object.keys(p.stockPN).length,1);
  assert.equal(Object.keys(p.stockEvidencias||{}).length,0,
    'same-base movements are already in stockPN and individual Yjs witnesses; dont duplicate every sale into a backup-sized conflict log');
});

test('P0 Yjs witness remains unique and idempotent on many same-actor counter updates',async()=>{
  const a=await peer(),b=await peer();
  await physicalFixture(a,b,7,7);
  // Deliberately reuse the same device actor in a synthetic local client:
  // PN counter advances, but old witness entries must never be double-added.
  for(let i=0;i<8;i++){
    await a.w.request('/api/productos/p0-two-actors/ajustar','POST',{delta:1,motivo:'repeated synthetic movement '+i});
    await a.flush();
  }
  await exchange(a,b,3);
  assert.equal((await fixtureProduct(a)).stockActual,15);
  assert.equal((await fixtureProduct(b)).stockActual,15);
  await exchange(b,a,3);
  assert.equal((await fixtureProduct(b)).stockActual,15);
});


test('P0 offline last unit: two distinct sales are both recorded, negative physical count remains visible as deficit',async()=>{
  const a=await peer(),b=await peer();
  await physicalFixture(a,b,1,1);
  const saleA=await a.w.request('/api/productos/p0-two-actors/venta','POST',{cantidad:1});
  const saleB=await b.w.request('/api/productos/p0-two-actors/venta','POST',{cantidad:1});
  assert.ok(saleA.ventaId&&saleB.ventaId&&saleA.ventaId!==saleB.ventaId);
  await a.flush();await b.flush();await exchange(a,b,3);
  for(const device of [a,b]){
    const snap=await device.w.request('/api/respaldo/exportar');
    const p=snap.productos.find(x=>x.id==='p0-two-actors');
    assert.equal(p.stockActual,0,'do not fabricate negative physical stock as a count');
    assert.equal(p.stockDeficit,1,'do not hide the oversold physical unit');
    assert.equal(snap.ventas.filter(x=>x.id===saleA.ventaId).length,1);
    assert.equal(snap.ventas.filter(x=>x.id===saleB.ventaId).length,1);
  }
});

test('P0 adversarial replay order: 4 deterministic disconnect/reconnect schedules preserve same-base PN facts',async()=>{
  const sequences=[[0,1,2],[2,1,0],[1,2,0],[2,0,1]];
  for(let index=0;index<sequences.length;index++){
    const a=await peer(),b=await peer();
    await physicalFixture(a,b,10,10);
    await a.w.request('/api/productos/p0-two-actors/ajustar','POST',{delta:3,motivo:'schedule '+index+' A'});
    await b.w.request('/api/productos/p0-two-actors/ajustar','POST',{delta:-2,motivo:'schedule '+index+' B'});
    await a.flush();await b.flush();
    const updates=[
      a.w.Y.encodeStateAsUpdate(a.w.OCYjs.doc),
      b.w.Y.encodeStateAsUpdate(b.w.OCYjs.doc)
    ];
    for(const op of sequences[index]){
      if(op===0) b.w.Y.applyUpdate(b.w.OCYjs.doc,updates[0],'red');
      else if(op===1) a.w.Y.applyUpdate(a.w.OCYjs.doc,updates[1],'red');
      else { a.w.Y.applyUpdate(a.w.OCYjs.doc,updates[1],'red');b.w.Y.applyUpdate(b.w.OCYjs.doc,updates[0],'red'); }
    }
    a.w.OCYjs._store.aplicar();b.w.OCYjs._store.aplicar();
    await a.flush();await b.flush();
    await exchange(a,b,2);
    assert.equal((await fixtureProduct(a)).stockActual,11,'A invariant schedule '+index);
    assert.equal((await fixtureProduct(b)).stockActual,11,'B invariant schedule '+index);
  }
});

test('P0 1000-product notebook: one remote PN change must be preserved without destructive catalog overwrite',async()=>{
  const a=await peer(),b=await peer();
  const f=await a.w.request('/api/respaldo/exportar');
  const p0={...f.productos[0],stockActual:4,stockBase:4,stockPN:{},stockTs:1,rev:{c:1,d:'fixture'}};
  f.productos=Array.from({length:1000},(_,i)=>({...p0,id:'large-stock-'+i,
    nombre:'Synthetic product '+i,barcode:'SYN-PERF-LARGE-'+i}));
  f.ventas=[];f.movimientos=[];
  await a.w.request('/api/respaldo/importar','POST',f);
  await b.w.request('/api/respaldo/importar','POST',f);
  a.w.OCYjs._store.sembrar();b.w.OCYjs._store.sembrar();
  await a.flush();await b.flush();
  // Separate initial full 1000-product hydration from the steady-state edit.
  const bootstrapStart=Date.now();await exchange(a,b,2);
  const bootstrapElapsed=Date.now()-bootstrapStart;
  const x=await a.w.request('/api/productos/large-stock-999/ajustar','POST',{delta:7,motivo:'1000 item consistency'});
  assert.equal(x.stockActual,11);
  await a.flush();
  const _applyB=b.w.OCSync.aplicarCatalogo;
  const applied=[];
  b.w.OCSync.aplicarCatalogo=function(remoto,rol,bandera){
    applied.push({productos:(remoto.productos||[]).length,actividad:(remoto.actividad||[]).length});
    return _applyB(remoto,rol,bandera);
  };
  const deltaMetrics=await exchangeBinaryDelta(a,b);
  console.error('P0_1000_PRODUCT_RECEIVER_APPLY_ROWS',JSON.stringify(applied));
  const p=(await b.w.request('/api/respaldo/exportar')).productos;
  assert.equal(p.length,1000);
  assert.equal(p.find(x=>x.id==='large-stock-999').stockActual,11);
  console.error('P0_1000_PRODUCT_BOOTSTRAP_MS',bootstrapElapsed);
  console.error('P0_1000_PRODUCT_INCREMENTAL_DELTA_METRICS',JSON.stringify(deltaMetrics));
});


test('P0 hot-path witness scan: increment only one product without walking every historical witness',async()=>{
  const a=await peer(),b=await peer();
  await physicalFixture(a,b,5,5);
  for(let i=0;i<32;i++){
    const r=await a.w.request('/api/productos/p0-two-actors/ajustar','POST',{delta:1,motivo:'synthetic forensic PN '+i});
    assert.equal(r.stockActual,6+i);
    await a.flush();
  }
  await exchangeBinaryDelta(a,b);
  assert.equal((await fixtureProduct(b)).stockActual,37);
  const map=b.w.OCYjs.stockPNTestigos;
  assert.ok(map&&map.size>=32,'enough independent history to detect a full map walk');
  const original=map.forEach;
  let historicalVisits=0;
  map.forEach=function(callback,...rest){
    return original.call(this,function(...args){historicalVisits++;return callback(...args);},...rest);
  };
  try{
    await a.w.request('/api/productos/p0-two-actors/ajustar','POST',{delta:1,motivo:'only new fact'});
    await a.flush();
    await exchangeBinaryDelta(a,b);
    assert.equal((await fixtureProduct(b)).stockActual,38,'new operation preserved');
    assert.equal(historicalVisits,0,'hot path must use indexed facts, not iterate all immutable history for one change');
  } finally {
    map.forEach=original;
  }
});


test('P0 unexpected Yjs witness rewrite invalidates cache but does not alter committed stock',async()=>{
  const a=await peer(),b=await peer();
  await physicalFixture(a,b,5,5);
  await a.w.request('/api/productos/p0-two-actors/ajustar','POST',{delta:9,motivo:'synthetic witness'});
  await a.flush();await exchangeBinaryDelta(a,b);
  assert.equal((await fixtureProduct(b)).stockActual,14);
  const mapa=b.w.OCYjs.stockPNTestigos;
  const key=Array.from(mapa.keys())[0];
  assert.ok(key,'witness key exists');
  const original=mapa.get(key);
  let fullReads=0;const forEach=mapa.forEach;
  mapa.forEach=function(fn,...args){return forEach.call(this,function(...row){fullReads++;return fn(...row);},...args);};
  try {
    // Unexpected external write to the SAME Y.Map key must fail closed and
    // rebuild the index. This is not an authorized way to cancel a sale.
    mapa.set(key,vm.runInContext('('+JSON.stringify(original)+')',b.w));
    b.w.OCYjs._store.aplicar();await b.flush();
    assert.equal((await fixtureProduct(b)).stockActual,14,'committed stock is unchanged');
    assert.ok(fullReads>=1,'cache rebuilt after illegal same-key update');
  } finally { mapa.forEach=forEach; }
});


test('P0 pinned v607 bridge with new bridge: two disconnected sales retain each physical decrement and both receipts',async()=>{
  const a=await peer(),b=await peer({legacy:true});
  await physicalFixture(a,b,6,6);
  const rA=await a.w.request('/api/productos/p0-two-actors/venta','POST',{cantidad:1});
  const rB=await b.w.request('/api/productos/p0-two-actors/venta','POST',{cantidad:1});
  assert.ok(rA.ventaId&&rB.ventaId&&rA.ventaId!==rB.ventaId);
  await a.flush();await b.flush();await exchange(a,b,3);
  for(const p of [a,b]){
    const snapshot=await p.w.request('/api/respaldo/exportar');
    assert.equal(snapshot.productos.find(x=>x.id==='p0-two-actors').stockActual,4,
      'different shell Yjs versions must not lose either offline physical movement');
    assert.equal(snapshot.ventas.filter(x=>x.id===rA.ventaId).length,1);
    assert.equal(snapshot.ventas.filter(x=>x.id===rB.ventaId).length,1);
  }
});


test('P0 pinned v606 Yjs bridge versus new bridge: two offline sales remain unique',async()=>{
  // Real historical v606 bridge, common synthetic backend; NOT full mixed-shell test.
  const a=await peer(),b=await peer({legacy:'v606'});
  await physicalFixture(a,b,6,6);
  const rA=await a.w.request('/api/productos/p0-two-actors/venta','POST',{cantidad:1});
  const rB=await b.w.request('/api/productos/p0-two-actors/venta','POST',{cantidad:1});
  assert.ok(rA.ventaId&&rB.ventaId&&rA.ventaId!==rB.ventaId);
  await a.flush();await b.flush();await exchange(a,b,3);
  for(const p of [a,b]){
    const snapshot=await p.w.request('/api/respaldo/exportar');
    assert.equal(snapshot.productos.find(x=>x.id==='p0-two-actors').stockActual,4);
    assert.equal(snapshot.ventas.filter(x=>x.id===rA.ventaId).length,1);
    assert.equal(snapshot.ventas.filter(x=>x.id===rB.ventaId).length,1);
  }
});


test('P0 RED epoch ABA: same numeric recount base must not inherit old physical epoch witnesses',async()=>{
  const a=await peer();
  const snapshot=await a.w.request('/api/respaldo/exportar');
  snapshot.productos=[{...snapshot.productos[0],id:'p0-epoch-aba',nombre:'Synthetic ABA',
    barcode:'SYN-EPOCH-ABA',stockActual:5,stockBase:5,stockPN:{},stockTs:1,rev:{c:1,d:'fixture'}}];
  snapshot.ventas=[];snapshot.movimientos=[];
  await a.w.request('/api/respaldo/importar','POST',snapshot);
  a.w.OCYjs._store.sembrar();await a.flush();
  await a.w.request('/api/productos/p0-epoch-aba/ajustar','POST',{delta:3,motivo:'epoch E1'});
  await a.flush();
  assert.equal((await a.w.request('/api/productos/p0-epoch-aba')).stockActual,8);
  assert.ok(a.w.OCYjs.stockPNTestigos.size>0,'old epoch movements are recorded');
  // Simulate a distinct physical recount E2 with the SAME numerical base.
  // Give the recount a distinct durable epoch. Old untagged witnesses from E1
  // must not be admitted to this new physical recount E2.
  const old=a.w.OCYjs.getProductos()['p0-epoch-aba'];
  const recount={...old,stockBase:5,stockActual:5,stockPN:{},stockEpochId:'synthetic-epoch-E2',stockTs:old.stockTs+1,
    rev:{c:(old.rev?.c||1)+100,d:'synthetic-distinct-physical-recount'}};
  // Yjs is vendored in the VM: provide a same-realm object, not a Node object.
  a.w.OCYjs.mapas.productos.set('p0-epoch-aba',vm.runInContext('('+JSON.stringify(recount)+')',a.w));
  a.w.OCYjs._store.aplicar();await a.flush();
  const actual=(await a.w.request('/api/productos/p0-epoch-aba')).stockActual;
  assert.equal(actual,5,'a distinct physical recount at base 5 must not inherit E1 +3');
});

test('P0 two peers retain E2 physical recount and its subsequent movement',async()=>{
  const a=await peer(), b=await peer();
  await physicalFixture(a,b,5,5);
  await a.w.request('/api/productos/p0-two-actors/ajustar','POST',{delta:3,motivo:'E1'});
  await a.flush(); await exchange(a,b,2);
  const previous=a.w.OCYjs.getProductos()['p0-two-actors'];
  const recount={...previous,stockBase:5,stockActual:5,stockPN:{},
    stockEpochId:'E2-synthetic',stockTs:previous.stockTs+100,
    rev:{c:1000,d:'recount'}};
  a.w.OCYjs.mapas.productos.set('p0-two-actors',
    vm.runInContext('('+JSON.stringify(recount)+')',a.w));
  a.w.OCYjs._store.aplicar(); await a.flush(); await exchange(a,b,2);
  assert.equal((await fixtureProduct(b)).stockActual,5);
  await b.w.request('/api/productos/p0-two-actors/ajustar','POST',{delta:-1,motivo:'E2'});
  await b.flush(); await exchange(b,a,3);
  for(const p of [a,b]){
    const item=await fixtureProduct(p);
    assert.equal(item.stockActual,4);
    assert.equal(item.stockEpochId,'E2-synthetic');
    assert.ok(p.w.OCYjs.stockPNTestigos.size >= 2,'historic and active movement witnesses remain durable');
  }
  await exchange(a,b,3);
  assert.equal((await fixtureProduct(a)).stockActual,4,'repeated replay cannot resurrect E1 movements');
  assert.equal((await fixtureProduct(b)).stockActual,4,'reverse replay cannot duplicate E2 decrement');
});

test('P0 epoch-tagged backup retains identity after local restore and Yjs publication',async()=>{
  const a=await peer(), b=await peer();
  const backup=await a.w.request('/api/respaldo/exportar');
  backup.productos=[{...backup.productos[0],id:'p0-epoch-backup',
    nombre:'Synthetic epoch backup',barcode:'SYN-EPOCH-RESTORE',
    stockBase:5,stockActual:5,stockPN:{},stockEpochId:'synthetic-backup-E2',
    stockTs:1,rev:{c:1,d:'fixture'}}];
  backup.ventas=[];backup.movimientos=[];
  for(const device of [a,b]){
    const result=await device.w.request('/api/respaldo/importar','POST',backup);
    assert.equal(result.ok,true);
    const stored=(await device.w.request('/api/respaldo/exportar')).productos.find(p=>p.id==='p0-epoch-backup');
    assert.equal(stored.stockEpochId,'synthetic-backup-E2');
    device.w.OCYjs._store.sembrar();await device.flush();
  }
  await exchange(a,b,2);
  for(const device of [a,b]){
    const item=(await device.w.request('/api/respaldo/exportar')).productos.find(p=>p.id==='p0-epoch-backup');
    assert.equal(item.stockEpochId,'synthetic-backup-E2');
    assert.equal(item.stockActual,5);
  }
});

test('P0 explicit competing physical epochs must not auto-overwrite by timestamp',async()=>{
  const a=await peer(), b=await peer();
  const original=await a.w.request('/api/respaldo/exportar');
  original.productos=[{...original.productos[0],id:'p0-competing-epochs',
    nombre:'Synthetic conflict',barcode:'SYN-EPOCH-CONFLICT',stockBase:5,
    stockActual:5,stockPN:{},stockEpochId:'E2-local',stockTs:10,
    rev:{c:1,d:'fixture'}}];
  original.ventas=[];original.movimientos=[];
  const alternate=JSON.parse(JSON.stringify(original));
  alternate.productos[0].stockBase=9;
  alternate.productos[0].stockActual=9;
  alternate.productos[0].stockEpochId='E3-remote';
  alternate.productos[0].stockTs=100;
  assert.equal((await a.w.request('/api/respaldo/importar','POST',original)).ok,true);
  assert.equal((await b.w.request('/api/respaldo/importar','POST',alternate)).ok,true);
  const beforeA=(await a.w.request('/api/respaldo/exportar')).productos.find(p=>p.id==='p0-competing-epochs');
  const beforeB=(await b.w.request('/api/respaldo/exportar')).productos.find(p=>p.id==='p0-competing-epochs');
  console.error('P0_COMPETING_EPOCH_BEFORE',JSON.stringify({a:{epoch:beforeA.stockEpochId,stock:beforeA.stockActual,ts:beforeA.stockTs},b:{epoch:beforeB.stockEpochId,stock:beforeB.stockActual,ts:beforeB.stockTs}}));
  a.w.OCYjs._store.sembrar();b.w.OCYjs._store.sembrar();
  await a.flush();await b.flush();
  for(let round=0;round<4;round++) {
    await exchange(a,b,1);
    const currentA=(await a.w.request('/api/respaldo/exportar')).productos.find(p=>p.id==='p0-competing-epochs');
    const currentB=(await b.w.request('/api/respaldo/exportar')).productos.find(p=>p.id==='p0-competing-epochs');
    console.error('P0_EPOCH_ROUND',JSON.stringify({round,a:{e:currentA.stockEpochId,s:currentA.stockActual,b:currentA.stockBase,pn:currentA.stockPN,ts:currentA.stockTs},b:{e:currentB.stockEpochId,s:currentB.stockActual,b:currentB.stockBase,pn:currentB.stockPN,ts:currentB.stockTs}}));
    assert.equal(currentA.stockEpochId,'E2-local','A physical epoch round '+round);
    assert.equal(currentA.stockActual,5,'A physical count round '+round);
    assert.equal(currentB.stockEpochId,'E3-remote','B physical epoch round '+round);
    assert.equal(currentB.stockActual,9,'B physical count round '+round);
  }
  const local=(await a.w.request('/api/respaldo/exportar')).productos.find(p=>p.id==='p0-competing-epochs');
  console.error('P0_COMPETING_EPOCH_AFTER',JSON.stringify({a:{epoch:local.stockEpochId,stock:local.stockActual,base:local.stockBase,ts:local.stockTs},remote:a.w.OCYjs.getProductos()['p0-competing-epochs']?.stockEpochId}));
  assert.equal(local.stockEpochId,'E2-local','unrelated explicit physical epochs cannot be chosen by timestamp alone');
  assert.equal(local.stockActual,5,'preserve local physical stock pending manual reconciliation');
  const other=(await b.w.request('/api/respaldo/exportar')).productos.find(p=>p.id==='p0-competing-epochs');
  assert.equal(other.stockEpochId,'E3-remote','other peer retains independent epoch');
  assert.equal(other.stockActual,9,'other physical count is not silently replaced');
  await exchange(b,a,3);
  assert.equal((await a.w.request('/api/productos/p0-competing-epochs')).stockActual,5);
  assert.equal((await b.w.request('/api/productos/p0-competing-epochs')).stockActual,9);
});

test('P0 same numeric base with two explicit epochs cannot merge counter witnesses',async()=>{
  const a=await peer(),b=await peer();
  const base=await a.w.request('/api/respaldo/exportar');
  base.productos=[{...base.productos[0],id:'p0-epoch-equal',
    nombre:'Synthetic equal base epochs',barcode:'SYN-EQUAL-EPOCH',
    stockActual:5,stockBase:5,stockPN:{},stockEpochId:'E2-A',stockTs:10,
    rev:{c:1,d:'fixture'}}];
  base.ventas=[];base.movimientos=[];
  const other=JSON.parse(JSON.stringify(base));
  other.productos[0].stockEpochId='E3-B';
  other.productos[0].stockTs=200;
  for(const [device,fixture] of [[a,base],[b,other]]){
    assert.equal((await device.w.request('/api/respaldo/importar','POST',fixture)).ok,true);
    device.w.OCYjs._store.sembrar();await device.flush();
  }
  await a.w.request('/api/productos/p0-epoch-equal/ajustar','POST',{delta:2,motivo:'E2 only'});
  await b.w.request('/api/productos/p0-epoch-equal/ajustar','POST',{delta:4,motivo:'E3 only'});
  await a.flush();await b.flush();
  for(let round=0;round<3;round++)await exchange(a,b,1);
  const pa=(await a.w.request('/api/respaldo/exportar')).productos.find(x=>x.id==='p0-epoch-equal');
  const pb=(await b.w.request('/api/respaldo/exportar')).productos.find(x=>x.id==='p0-epoch-equal');
  console.error('P0_EQUAL_EPOCH_BOUNDARIES',JSON.stringify({
    a:{epoch:pa.stockEpochId,base:pa.stockBase,pn:pa.stockPN,stock:pa.stockActual},
    b:{epoch:pb.stockEpochId,base:pb.stockBase,pn:pb.stockPN,stock:pb.stockActual},
    yA:a.w.OCYjs.getProductos()['p0-epoch-equal'],
    yB:b.w.OCYjs.getProductos()['p0-epoch-equal']
  }));
  assert.equal(pa.stockActual,7,'do not add E3 movement to E2');
  assert.equal(pb.stockActual,9,'do not add E2 movement to E3');
  assert.equal(pa.stockEpochId,'E2-A');
  assert.equal(pb.stockEpochId,'E3-B');
});

test('P0 newly created products issue distinct persistent physical epochs',async()=>{
  const a=await peer();
  const one=await a.w.request('/api/productos','POST',{
    nombre:'Synthetic epoch one',barcode:'SYN-EPOCH-ONE',precio:10,costo:3,stockInicial:5
  });
  const two=await a.w.request('/api/productos','POST',{
    nombre:'Synthetic epoch two',barcode:'SYN-EPOCH-TWO',precio:10,costo:3,stockInicial:5
  });
  assert.ok(one.id && two.id,'products created');
  const exported=await a.w.request('/api/respaldo/exportar');
  const p1=exported.productos.find(p=>p.id===one.id);
  const p2=exported.productos.find(p=>p.id===two.id);
  assert.ok(p1.stockEpochId && p2.stockEpochId,'physical epochs persisted in backup');
  assert.notEqual(p1.stockEpochId,p2.stockEpochId,'physical epochs are not the numeric stock base');
  a.w.OCYjs._store.sembrar();await a.flush();
  assert.equal(a.w.OCYjs.getProductos()[one.id].stockEpochId,p1.stockEpochId);
});

test('P0 invalid physical epoch in backup rejects import before any mutation',async()=>{
  const a=await peer();
  const before=await a.w.request('/api/respaldo/exportar');
  const invalid=JSON.parse(JSON.stringify(before));
  invalid.productos[0].stockEpochId='X'.repeat(161);
  await assert.rejects(
    a.w.request('/api/respaldo/importar','POST',invalid),
    /invalid physical inventory epoch/,
    'malformed epoch must be rejected before import'
  );
  const after=await a.w.request('/api/respaldo/exportar');
  assert.deepEqual(after.productos,before.productos,'rejected backup must not change products');
});

test('P0 new product keeps physical epoch after sale and two-peer stock publication',async()=>{
  const a=await peer(),b=await peer();
  const created=await a.w.request('/api/productos','POST',
    {nombre:'Synthetic new sale',barcode:'SYN-P0-CREATE-SALE',precio:12,costo:4,stockInicial:5});
  assert.ok(created.id);
  const start=(await a.w.request('/api/respaldo/exportar')).productos.find(p=>p.id===created.id);
  assert.ok(start.stockEpochId);
  await a.flush();a.w.OCYjs._store.sembrar();await a.flush();
  await exchange(a,b,2);
  const received=(await b.w.request('/api/respaldo/exportar')).productos.find(p=>p.id===created.id);
  assert.ok(received,'new product must reach peer B');
  assert.equal(received.stockEpochId,start.stockEpochId);
  await a.w.request('/api/productos/'+created.id+'/ajustar','POST',{delta:-1,motivo:'synthetic first sale stock'});
  await a.flush();await exchange(a,b,2);
  const next=(await b.w.request('/api/respaldo/exportar')).productos.find(p=>p.id===created.id);
  assert.equal(next.stockActual,4);
  assert.equal(next.stockEpochId,start.stockEpochId);
});

test('P0 new product has independent offline adjustments on both peers and stable replay',async()=>{
  const a=await peer(),b=await peer();
  const created=await a.w.request('/api/productos','POST',
    {nombre:'Synthetic bidirectional',barcode:'SYN-BIDIRECTIONAL-EPOCH',precio:8,costo:2,stockInicial:10});
  const id=created.id;
  const original=(await a.w.request('/api/respaldo/exportar')).productos.find(x=>x.id===id);
  a.w.OCYjs._store.sembrar();await a.flush();await exchange(a,b,2);
  assert.equal((await b.w.request('/api/productos/'+id)).stockActual,10);
  await a.w.request('/api/productos/'+id+'/ajustar','POST',{delta:3,motivo:'offline A'});
  await b.w.request('/api/productos/'+id+'/ajustar','POST',{delta:-2,motivo:'offline B'});
  await a.flush();await b.flush();
  for(let round=0;round<4;round++)await exchange(a,b,1);
  for(const p of [a,b]){
    const item=(await p.w.request('/api/respaldo/exportar')).productos.find(x=>x.id===id);
    assert.equal(item.stockActual,11,'both independent physical movements preserved');
    assert.equal(item.stockEpochId,original.stockEpochId,'epoch ID remains unchanged');
  }
});

test('P0 reboot from persisted local state plus restored Yjs snapshot retains epoch and stock exactly once',async()=>{
  const a=await peer(),b=await peer();
  const created=await a.w.request('/api/productos','POST',{
    nombre:'Synthetic durable reboot',barcode:'SYN-P0-REBOOT',precio:12,costo:4,stockInicial:5
  });
  assert.ok(created.id);
  await a.w.request('/api/productos/'+created.id+'/ajustar','POST',
    {delta:-2,motivo:'reboot physical movement'});
  await a.flush();await exchange(a,b,2);
  const before=(await a.w.request('/api/respaldo/exportar')).productos.find(p=>p.id===created.id);
  assert.equal(before.stockActual,3);
  assert.ok(before.stockEpochId);
  const persistedDocBytes=a.w.Y.encodeStateAsUpdate(a.w.OCYjs.doc);
  // New browser VM shares only the persisted localStorage from the original
  // device. The encrypted IndexedDB Yjs bytes are injected separately,
  // modelling a reboot without using any real browser/customer storage.
  const reloaded=await peer({storage:a.w.localStorage});
  await reloaded.flush();
  reloaded.w.Y.applyUpdate(reloaded.w.OCYjs.doc,persistedDocBytes,'red');
  reloaded.w.OCYjs._store.aplicar();await reloaded.flush();
  const restored=(await reloaded.w.request('/api/respaldo/exportar')).productos.find(p=>p.id===created.id);
  assert.ok(restored,'product persists after reboot');
  assert.equal(restored.stockEpochId,before.stockEpochId,'reboot cannot invent a new epoch');
  assert.equal(restored.stockActual,3,'reboot cannot duplicate a decrement');
  await exchange(b,reloaded,3);
  const final=(await reloaded.w.request('/api/respaldo/exportar')).productos.find(p=>p.id===created.id);
  assert.equal(final.stockActual,3,'replaying a known peer cannot resurrect spent stock');
  assert.equal(final.stockEpochId,before.stockEpochId);
});

test('P0 v607 stale same-number legacy stock cannot contaminate explicit physical epoch',async()=>{
  const current=await peer(),legacy=await peer({legacy:true});
  const fixture=await current.w.request('/api/respaldo/exportar');
  fixture.productos=[{...fixture.productos[0],id:'p0-stale-v607',
    nombre:'Synthetic stale bridge',barcode:'SYN-P0-STALE-V607',
    stockActual:5,stockBase:5,stockPN:{},stockEpochId:'E2-current',
    stockTs:200,rev:{c:1,d:'synthetic'}}];
  fixture.ventas=[];fixture.movimientos=[];
  const older=JSON.parse(JSON.stringify(fixture));
  delete older.productos[0].stockEpochId;
  older.productos[0].stockTs=100;
  assert.equal((await current.w.request('/api/respaldo/importar','POST',fixture)).ok,true);
  assert.equal((await legacy.w.request('/api/respaldo/importar','POST',older)).ok,true);
  current.w.OCYjs._store.sembrar();legacy.w.OCYjs._store.sembrar();
  await current.flush();await legacy.flush();
  await legacy.w.request('/api/productos/p0-stale-v607/ajustar','POST',{delta:2,motivo:'older bridge local stock'});
  await legacy.flush();await exchange(legacy,current,3);
  const now=(await current.w.request('/api/respaldo/exportar')).productos.find(p=>p.id==='p0-stale-v607');
  assert.equal(now.stockEpochId,'E2-current','old bridge cannot revoke confirmed physical epoch');
  assert.equal(now.stockActual,5,'unscoped legacy movement cannot increase a new physical count');
  await exchange(current,legacy,2);
  const final=(await current.w.request('/api/respaldo/exportar')).productos.find(p=>p.id==='p0-stale-v607');
  assert.equal(final.stockActual,5,'repeated old bridge traffic cannot resurrect obsolete stock');
});

test('P0 a v607 offline sale is not erased by a competing modern physical epoch',async()=>{
  const current=await peer(),old=await peer({legacy:true});
  const snap=await current.w.request('/api/respaldo/exportar');
  snap.productos=[{...snap.productos[0],id:'p0-mixed-sale-epochs',
    nombre:'Synthetic legacy sale preservation',barcode:'SYN-MIXED-EPOCH-SALE',
    stockBase:5,stockActual:5,stockPN:{},stockEpochId:'E2-physical-recount',
    stockTs:200,rev:{c:1,d:'synthetic'}}];
  snap.ventas=[];snap.movimientos=[];
  const oldSnap=JSON.parse(JSON.stringify(snap));
  delete oldSnap.productos[0].stockEpochId;
  oldSnap.productos[0].stockTs=100;
  assert.equal((await current.w.request('/api/respaldo/importar','POST',snap)).ok,true);
  assert.equal((await old.w.request('/api/respaldo/importar','POST',oldSnap)).ok,true);
  current.w.OCYjs._store.sembrar();old.w.OCYjs._store.sembrar();
  await current.flush();await old.flush();
  const _priorApply=current.w.OCSync.aplicarCatalogo;
  current.w.OCSync.aplicarCatalogo=function(remoto,...params) {
    const rid='p0-mixed-sale-epochs';
    const product=(remoto.productos||[]).find(p=>p.id===rid);
    const before=(current.w.OCSync.catalogoPropio()?.productos||[]).find(p=>p.id===rid);
    const applied=_priorApply(remoto,...params);
    const after=(current.w.OCSync.catalogoPropio()?.productos||[]).find(p=>p.id===rid);
    console.error('P0_MIXED_BACKEND_MERGE',JSON.stringify({
      before:before&&{s:before.stockActual,e:before.stockEpochId,pn:before.stockPN},
      remote:product&&{s:product.stockActual,e:product.stockEpochId,pn:product.stockPN},
      after:after&&{s:after.stockActual,e:after.stockEpochId,pn:after.stockPN}
    }));
    return applied;
  };
  const _yMap=current.w.OCYjs.mapas.productos;
  const _priorSet=_yMap.set;
  _yMap.set=function(id,value){
    if(id==='p0-mixed-sale-epochs')
      console.error('P0_MIXED_CURRENT_YMAP_WRITE',JSON.stringify({s:value.stockActual,e:value.stockEpochId,pn:value.stockPN}));
    return _priorSet.call(this,id,value);
  };
  const sold=await old.w.request('/api/productos/p0-mixed-sale-epochs/venta','POST',{cantidad:1});
  assert.ok(sold.ventaId,'legacy peer produced real sale receipt');
  await old.flush();await exchange(old,current,3);
  const live=await current.w.request('/api/respaldo/exportar');
  const item=live.productos.find(x=>x.id==='p0-mixed-sale-epochs');
  const oldNow=(await old.w.request('/api/respaldo/exportar')).productos.find(p=>p.id==='p0-mixed-sale-epochs');
  console.error('P0_MIXED_OLD_SALE_BOUNDARY',JSON.stringify({
    current:{s:item.stockActual,b:item.stockBase,e:item.stockEpochId,pn:item.stockPN,ts:item.stockTs},
    old:{s:oldNow.stockActual,b:oldNow.stockBase,e:oldNow.stockEpochId,pn:oldNow.stockPN,ts:oldNow.stockTs},
    yCurrent:current.w.OCYjs.getProductos()['p0-mixed-sale-epochs'],
    witnesses:current.w.OCYjs.stockPNTestigos.size,
    saleCount:live.ventas.filter(v=>v.id===sold.ventaId).length
  }));
  console.error('P0_MIXED_SALE_BOUNDARY',JSON.stringify({item:{base:item.stockBase,epoch:item.stockEpochId,pn:item.stockPN,stock:item.stockActual,ts:item.stockTs},legacy:(await old.w.request('/api/respaldo/exportar')).productos.find(x=>x.id==='p0-mixed-sale-epochs'),winning:current.w.OCYjs.getProductos()['p0-mixed-sale-epochs']}));
  assert.equal(item.stockEpochId,'E2-physical-recount');
  assert.equal(item.stockActual,5,'legacy E1 sale must not be counted twice in E2');
  assert.equal(live.ventas.filter(x=>x.id===sold.ventaId).length,1,
    'old-sale receipt must survive without applying its physical movement to E2');
  // Force the stale v607 whole-product snapshot to win the Y.Map's
  // last-writer slot, regardless of random CRDT client IDs. The protected
  // physical E2 count must remain unchanged while its old receipt survives.
  const legacyRecord=old.w.OCYjs.getProductos()['p0-mixed-sale-epochs'];
  current.w.OCYjs.mapas.productos.set('p0-mixed-sale-epochs',
    vm.runInContext('('+JSON.stringify(legacyRecord)+')',current.w));
  current.w.OCYjs._store.aplicar();await current.flush();
  const forced=(await current.w.request('/api/respaldo/exportar')).productos.find(p=>p.id==='p0-mixed-sale-epochs');
  assert.equal(forced.stockEpochId,'E2-physical-recount');
  assert.equal(forced.stockActual,5,'forced legacy Y.Map overwrite cannot change active E2 physical count');
  await exchange(current,old,3);
  const repeated=await current.w.request('/api/respaldo/exportar');
  assert.equal(repeated.ventas.filter(x=>x.id===sold.ventaId).length,1,
    'receipt cannot duplicate after replay');
});

test('P0 late third peer converges explicit-epoch stock after independent offline movements and stale replay',async()=>{
  const a=await peer(),b=await peer(),c=await peer();
  const original=await a.w.request('/api/respaldo/exportar');
  original.productos=[{...original.productos[0],id:'p0-three-peers',nombre:'Synthetic 3 peers',
    barcode:'SYN-P0-THIRD',stockBase:5,stockActual:5,stockPN:{},
    stockEpochId:'SYN-ONE-PHYSICAL-EPOCH',stockTs:1,rev:{c:1,d:'fixture'}}];
  original.ventas=[];original.movimientos=[];
  for(const p of [a,b]){
    assert.equal((await p.w.request('/api/respaldo/importar','POST',original)).ok,true);
    p.w.OCYjs._store.sembrar();await p.flush();
  }
  // Two independent devices operate without exchanging their new PN facts.
  await a.w.request('/api/productos/p0-three-peers/ajustar','POST',{delta:3,motivo:'offline A'});
  await b.w.request('/api/productos/p0-three-peers/ajustar','POST',{delta:-2,motivo:'offline B'});
  await a.flush();await b.flush();
  // Late peer C first learns only A's historical state, then meets B.
  await exchange(a,c,2);
  const cInitial=(await c.w.request('/api/respaldo/exportar')).productos.find(p=>p.id==='p0-three-peers');
  assert.equal(cInitial.stockActual,8,'late third device sees known A movement');
  await exchange(b,c,2);
  await exchange(c,a,3);
  await exchange(c,b,3);
  for(const p of [a,b,c]){
    const item=(await p.w.request('/api/respaldo/exportar')).productos.find(x=>x.id==='p0-three-peers');
    assert.ok(item,'late peer must retain product');
    assert.equal(item.stockEpochId,'SYN-ONE-PHYSICAL-EPOCH');
    assert.equal(item.stockActual,6,'base 5 + 3 - 2 converges on all devices');
    assert.equal(Object.keys(item.stockPN).length,2,'distinct PN actors are not merged or lost');
  }
  // Replay the earliest snapshots after full convergence. Old packets may
  // arrive late and must not silently reverse a committed movement.
  await exchange(a,c,2);
  await exchange(b,a,2);
  for(const p of [a,b,c]){
    const item=(await p.w.request('/api/respaldo/exportar')).productos.find(x=>x.id==='p0-three-peers');
    assert.equal(item.stockActual,6,'replaying stale Y.Doc history is idempotent');
  }
});

test('P0 third late peer cannot resolve rival physical epochs by guessing stock totals',async()=>{
  const a=await peer(),b=await peer(),c=await peer();
  const one=await a.w.request('/api/respaldo/exportar');
  one.productos=[{...one.productos[0],id:'p0-rival-third',
    nombre:'Synthetic rival late third',barcode:'SYN-RIVAL-THIRD',stockBase:5,
    stockActual:5,stockPN:{},stockEpochId:'SYN-RECOUNT-A',stockTs:100,
    rev:{c:1,d:'fixture'}}];
  one.ventas=[];one.movimientos=[];
  const two=JSON.parse(JSON.stringify(one));
  two.productos[0].stockBase=9;two.productos[0].stockActual=9;
  two.productos[0].stockEpochId='SYN-RECOUNT-B';two.productos[0].stockTs=200;
  for(const [p,snapshot] of [[a,one],[b,two]]){
    assert.equal((await p.w.request('/api/respaldo/importar','POST',snapshot)).ok,true);
    p.w.OCYjs._store.sembrar();await p.flush();
  }
  // C learns a physical history from A before the competing B history arrives.
  await exchange(a,c,2);await exchange(b,c,2);
  await exchange(c,a,3);await exchange(c,b,3);
  const get=async p=>(await p.w.request('/api/respaldo/exportar')).productos.find(x=>x.id==='p0-rival-third');
  const pa=await get(a),pb=await get(b),pc=await get(c);
  assert.equal(pa.stockActual,5,'A retains its distinct physical count');
  assert.equal(pa.stockEpochId,'SYN-RECOUNT-A');
  assert.equal(pb.stockActual,9,'B retains its distinct physical count');
  assert.equal(pb.stockEpochId,'SYN-RECOUNT-B');
  assert.ok([5,9].includes(pc.stockActual),'third peer cannot invent 14 from rival counts');
  assert.ok(['SYN-RECOUNT-A','SYN-RECOUNT-B'].includes(pc.stockEpochId),
    'third device must not invent an epoch for unresolved history');
  await exchange(c,b,2);await exchange(b,a,2);await exchange(a,c,2);
  assert.equal((await get(a)).stockActual,5);
  assert.equal((await get(b)).stockActual,9);
});

test('P0 same catalog fingerprint cannot masquerade as equal physical stock',async()=>{
  const a=await peer(),b=await peer();
  const base=await a.w.request('/api/respaldo/exportar');
  base.productos=[{...base.productos[0],id:'p0-stock-fingerprint',
    nombre:'Synthetic inventory comparison',barcode:'SYN-P0-HASH',
    stockBase:11,stockActual:11,stockPN:{},stockEpochId:'E1-11',
    stockTs:1,rev:{c:1,d:'fixture'}}];
  base.productos.push({...base.productos[0],id:'p0-stock-fingerprint-second',
    nombre:'Synthetic second product',barcode:'SYN-P0-HASH-SECOND',
    stockActual:3,stockBase:3,stockPN:{},stockEpochId:'E1-3'});
  base.ventas=[];base.movimientos=[];
  const other=JSON.parse(JSON.stringify(base));
  other.productos[0].stockBase=2;
  other.productos[0].stockActual=2;
  other.productos[0].stockEpochId='E2-2';
  for(const [p,bak] of [[a,base],[b,other]])
    assert.equal((await p.w.request('/api/respaldo/importar','POST',bak)).ok,true);
  // Preserve the older metadata-only catalog checksum for compatibility;
  // explicitly prove that it cannot certify inventory equality.
  assert.equal(a.w.OCSync.huella().completa,b.w.OCSync.huella().completa);
  const beforeA=await a.w.request('/api/respaldo/exportar');
  const beforeB=await b.w.request('/api/respaldo/exportar');
  const [ha,hb]=await Promise.all([a.w.OCSync.huellaInventario(),b.w.OCSync.huellaInventario()]);
  assert.equal(ha.ok,true);assert.equal(hb.ok,true);
  assert.equal(ha.comparable,true);assert.equal(hb.comparable,true);
  assert.equal(ha.certificado,false,'one-device hash never certifies peer synchronization');
  assert.equal(hb.certificado,false,'one-device hash never certifies peer synchronization');
  assert.equal(ha.algoritmo,'SHA-256');
  assert.equal(ha.existencias.length,64);
  assert.notEqual(ha.existencias,hb.existencias,'11 and 2 cannot share the stock checksum');
  assert.notEqual(ha.movimientos,hb.movimientos,'physical epochs also differ');
  assert.deepEqual((await a.w.request('/api/respaldo/exportar')).productos,beforeA.productos,
    'read-only checksum may not change notebook A');
  assert.deepEqual((await b.w.request('/api/respaldo/exportar')).productos,beforeB.productos,
    'read-only checksum may not change notebook B');
  // Identical inventory independent of array order must have the same checksums.
  const copy=JSON.parse(JSON.stringify(base));
  copy.productos.reverse();
  assert.equal((await b.w.request('/api/respaldo/importar','POST',copy)).ok,true);
  const equal=await b.w.OCSync.huellaInventario();
  assert.equal(ha.existencias,equal.existencias);
  assert.equal(ha.movimientos,equal.movimientos);
});

test('P0 historical untagged inventory checksum refuses a verified verdict',async()=>{
  const a=await peer();
  const backup=await a.w.request('/api/respaldo/exportar');
  backup.productos=[{...backup.productos[0],id:'p0-legacy-unverified',
    nombre:'Synthetic legacy',barcode:'SYN-P0-LEGACY',
    stockActual:5,stockBase:5,stockPN:{},stockTs:1}];
  delete backup.productos[0].stockEpochId;
  backup.ventas=[];backup.movimientos=[];
  assert.equal((await a.w.request('/api/respaldo/importar','POST',backup)).ok,true);
  const digest=await a.w.OCSync.huellaInventario();
  assert.equal(digest.ok,true);
  assert.equal(digest.comparable,false,'a legacy epoch cannot provide complete physical proof');
  assert.equal(digest.certificado,false,'no standalone hash is a peer certification');
  assert.equal(digest.sinEpoca,1);
});

test('P0 stock fingerprint refuses PN arithmetic inconsistent with the displayed quantity',async()=>{
  const a=await peer();
  const backup=await a.w.request('/api/respaldo/exportar');
  backup.productos=[{...backup.productos[0],id:'p0-bad-ledger-proof',
    nombre:'Synthetic invalid PN',barcode:'SYN-BAD-PN',
    stockActual:5,stockBase:5,stockPN:{actor:{add:2,sub:0}},
    stockEpochId:'SYN-CONSISTENCY-EPOCH',stockTs:1}];
  backup.ventas=[];backup.movimientos=[];
  assert.equal((await a.w.request('/api/respaldo/importar','POST',backup)).ok,true);
  const prior=await a.w.request('/api/respaldo/exportar');
  const result=await a.w.OCSync.huellaInventario();
  assert.equal(result.ok,false,'cannot certify 5 if ledger computes 7');
  assert.equal(result.comparable,false);
  assert.equal(result.certificado,false);
  assert.equal(result.invalidos,1);
  assert.equal(result.existencias,undefined,'no clean digest of contradictory stock');
  assert.deepEqual((await a.w.request('/api/respaldo/exportar')).productos,prior.productos);
});
test('P0 legitimate physical deficit retains a consistent read-only digest',async()=>{
  const a=await peer();
  const backup=await a.w.request('/api/respaldo/exportar');
  backup.productos=[{...backup.productos[0],id:'p0-deficit-ledger-proof',
    nombre:'Synthetic deficit',barcode:'SYN-DEFICIT-PN',
    stockActual:0,stockDeficit:1,stockBase:1,stockPN:{actor:{add:0,sub:2}},
    stockEpochId:'SYN-DEFICIT-EPOCH',stockTs:1}];
  backup.ventas=[];backup.movimientos=[];
  assert.equal((await a.w.request('/api/respaldo/importar','POST',backup)).ok,true);
  const result=await a.w.OCSync.huellaInventario();
  assert.equal(result.ok,true);
  assert.equal(result.comparable,true);
  assert.equal(result.certificado,false);
  assert.equal(result.existencias.length,64);
});

test('P0 watchdog does not trigger repair when peer heartbeat and local metadata fingerprints are equal',()=>{
  const w=browser();
  // Do not run watchdog timers/IndexedDB in this isolated VM.
  w.document.readyState='loading';
  w.localStorage.setItem('f123_micelio_vistos',JSON.stringify({
    'peer-equal':{huella:'#ABCD',rol:'empleado',visto:Date.now()}
  }));
  w.OCSync={huella:()=>({corta:'#ABCD',completa:'ABCD'})};
  w.OCAuth={rolActual:()=> 'dueno'};
  w.OCSyncControl={deviceIdActual:()=> 'local-owner'};
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../docs/sync-watchdog.js'),'utf8'),w);
  const a=w.OCSyncWatchdog.verificarConsistencia();
  const b=w.OCSyncWatchdog.verificarConsistencia();
  assert.deepEqual(Array.from(a.divergentes),[]);
  assert.deepEqual(Array.from(b.divergentes),[],
    'same fingerprint must not be reported divergent on second poll');
  assert.equal(b.accion,null,'same fingerprint must never trigger automatic resync');
  assert.equal(w.OCSyncWatchdog.estado().divergencias['peer-equal'],0);
});

test('P0 watchdog must not repeatedly resync for a peer offline longer than a day',()=>{
  const w=browser();w.document.readyState='loading';
  w.localStorage.setItem('f123_micelio_vistos',JSON.stringify({
    'peer-offline':{huella:'#OLD1',rol:'empleado',visto:Date.now()-24*60*60*1000}
  }));
  w.OCSync={huella:()=>({corta:'#NOW1'})};
  w.OCAuth={rolActual:()=> 'dueno'};
  w.OCSyncControl={deviceIdActual:()=> 'local-owner'};
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../docs/sync-watchdog.js'),'utf8'),w);
  w.OCSyncWatchdog.verificarConsistencia();
  const result=w.OCSyncWatchdog.verificarConsistencia();
  assert.deepEqual(Array.from(result.divergentes),[],
    'silent historical device cannot force continuous resync of the active one');
  assert.equal(result.accion,null);
});
test('P0 watchdog still detects a freshly seen genuinely different catalog',()=>{
  const w=browser();w.document.readyState='loading';
  w.localStorage.setItem('f123_micelio_vistos',JSON.stringify({
    'peer-active':{huella:'#DIFF',rol:'empleado',visto:Date.now()}
  }));
  w.OCSync={huella:()=>({corta:'#LOCAL'})};
  w.OCAuth={rolActual:()=> 'dueno'};
  w.OCSyncControl={deviceIdActual:()=> 'local-owner'};
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../docs/sync-watchdog.js'),'utf8'),w);
  const first=w.OCSyncWatchdog.verificarConsistencia();
  const second=w.OCSyncWatchdog.verificarConsistencia();
  assert.equal(first.accion,null,'one divergent heartbeat cannot trigger resync');
  assert.deepEqual(Array.from(second.divergentes),['peer-active']);
  assert.equal(second.accion,'resincronizar','a recently seen real difference still triggers repair');
});

test('P0 snapshot transport preserves multibyte product names crossing 200 KiB UTF-8 boundary',()=>{
  const w=browser();w.document.readyState='loading';
  Object.assign(w,{TextEncoder,TextDecoder});
  const sent=[];
  let snapshot;
  w.OCSync={estadoParaCheckpoint:()=>snapshot};
  w.OCSyncControl={enviarMensaje:(type,payload)=>{if(type==='__snapshot_trozo__')sent.push(payload);}};
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../docs/sync-watchdog.js'),'utf8'),w);
  const limit=200*1024;
  let found=false;
  // Find a reproducible product name where the UTF-8 byte boundary falls in
  // the middle of a real four-byte Unicode character, without depending on
  // timestamps or ID lengths of a specific CI runner.
  for(let n=limit-240;n<limit+80;n++){
    snapshot={productos:[{id:'synthetic-boundary',nombre:'X'.repeat(n)+'🌿 Cuenca café'}],huella:'SYN'};
    const serialized=JSON.stringify(w.OCSyncWatchdog.armarSnapshot());
    const pos=serialized.indexOf('🌿');
    const before=new TextEncoder().encode(serialized.slice(0,pos)).byteLength;
    if(before%limit>=limit-3){found=true;break;}
  }
  assert.ok(found,'test constructed a boundary inside the emoji');
  w.OCSyncWatchdog.responderSnapshot({deviceId:'synthetic-device'});
  assert.ok(sent.length>=2,'snapshot must actually cross the chunk boundary');
  assert.ok(sent.every(x=>new TextEncoder().encode(x.trozo).length<=limit),
    'no transport fragment may exceed the bounded byte limit');
  const full=sent.sort((a,b)=>a.idx-b.idx).map(x=>x.trozo).join('');
  const restored=JSON.parse(full);
  assert.equal(restored.data.productos[0].nombre,snapshot.productos[0].nombre,
    'fragmentation may not replace accents or emojis with Unicode replacement chars');
});

test('P0 team panel does not claim inventory equality from a metadata heartbeat',()=>{
  const w=browser(),panel={innerHTML:''};
  w.document.readyState='loading';
  w.document.getElementById=id=>id==='oc-micelio-panel'?panel:null;
  w.OCMicelio={
    equipo:()=>[{id:'pc',soyYo:true,estado:'rezagado',rol:'dueno',
      apodo:'Synthetic PC',cuando:'1 hour ago',huella:'#META'}],
    umbrales:()=>({rezagado:5,ciegas:120}),
    etiquetas:{rezagado:{color:'#ccc',tinta:'#111',texto:'Behind'}},
    yo:()=>({id:'pc',apodo:'Synthetic PC'}),
    miHuella:()=> '#META',
    desalineados:()=>[]
  };
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../docs/micelio-ui.js'),'utf8'),w);
  assert.ok(w.OCMicelioUI&&w.OCMicelioUI.pintarPanel,'real team UI is loaded');
  w.OCMicelioUI.pintarPanel();
  assert.match(panel.innerHTML,/Inventory equality is not verified/,
    'a behind device cannot be presented as synchronized inventory');
  assert.match(panel.innerHTML,/Catalog fingerprint \(not stock\)/,
    'the metadata checksum must not be described as a stock checksum');
  assert.doesNotMatch(panel.innerHTML,/Every device on your team is talking to the others/);
});
