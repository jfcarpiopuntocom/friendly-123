// P0: a conflicting pair of EXPLICIT physical epochs with stale product
// metadata must never abort the entire Yjs catalog transaction.
// Uses the real browser fixture, real Yjs and the production sembrar() code.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {webcrypto}=require('node:crypto');
const {setTimeout:delay}=require('node:timers/promises');
const {browser}=require('./helpers/browser.cjs');

async function peer(){
  const w=browser();delete w.JSON;
  Object.assign(w,{crypto:webcrypto,TextEncoder,TextDecoder,
    WebSocket:class{constructor(){throw Error('no network in test')}},
    BroadcastChannel:class{constructor(){throw Error('no cross-device bus in test')}}});
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../docs/vendor/yjs-bundle.min.js'),'utf8'),w);
  w.IndexeddbPersistence=class{once(){}};
  w.localStorage.setItem('f123_owned',JSON.stringify({licenseCode:'SYNTHETIC-ISOLATED-FIXTURE'}));
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../docs/sync-yjs.js'),'utf8'),w);
  for(let i=0;i<150&&w.OCYjs.estado!=='activo';i++)await delay(10);
  assert.equal(w.OCYjs.estado,'activo','real Yjs notebook initialized');
  return w;
}

test('two competing explicit epochs with stale local metadata preserve all independent catalog publications',async()=>{
  const w=await peer(),a=w.OCYjs;
  const local={id:'epoch-collision',nombre:'Real stock must not be guessed',
    stockActual:7,stockBase:10,stockPN:{deviceA:{add:0,sub:3}},
    stockEpochId:'epoch-A',stockTs:5000,rev:{c:1,d:'deviceA'},
    stockEvidencias:{historicA:{base:21,epoch:'epoch-historic-A',pn:{x:{add:0,sub:1}},ts:30}}};
  const remote={...local,stockActual:6,stockBase:8,
    stockPN:{deviceB:{add:0,sub:2}},stockEpochId:'epoch-B',
    stockTs:9000,rev:{c:2,d:'deviceB'},
    stockEvidencias:{historicB:{base:23,epoch:'epoch-historic-B',pn:{y:{add:0,sub:2}},ts:40}}};
  const independent={id:'independent-product',nombre:'Must still publish',
    stockActual:4,rev:{c:3,d:'deviceA'}};
  // Yjs rejects plain objects from a different VM realm. Materialize in
  // the browser realm exactly as its own JSON restore pipeline does.
  a.mapas.productos.set(local.id,vm.runInContext('JSON.parse('+JSON.stringify(JSON.stringify(remote))+')',w));
  const original=w.OCSync.catalogoPropio;
  w.OCSync.catalogoPropio=()=>({...original.call(w.OCSync),
    productos:[local,independent]});
  try {
    a._store.sembrar();
    assert.ok(a.mapas.productos.has(independent.id),
      'P0: a rejected physical-epoch fork must not abort all subsequent products');
    const after=a.mapas.productos.get(local.id);
    assert.ok(after.stockEvidencias,
      'both competing physical epochs must retain evidence for later real-device reconciliation');
    assert.ok(Object.values(after.stockEvidencias).some(x=>x.epoch==='epoch-A'));
    assert.ok(Object.values(after.stockEvidencias).some(x=>x.epoch==='epoch-B'));
    assert.ok(Object.values(after.stockEvidencias).some(x=>x.epoch==='epoch-historic-A'),
      'previously captured history from the losing local side must remain');
    assert.ok(Object.values(after.stockEvidencias).some(x=>x.epoch==='epoch-historic-B'),
      'previously captured history from the published side must remain');
    assert.equal(after.stockConciliacionPendiente,true,
      'an unresolved physical epoch fork must not be shown as final stock');
  }finally{w.OCSync.catalogoPropio=original}
});

test('a brand-new product without prev publishes unchanged and needs no fabricated reconciliation',async()=>{
  const w=await peer(),a=w.OCYjs;
  const first={id:'fresh-p0-product',nombre:'Brand new product',stockActual:4,
    stockBase:4,stockPN:{},stockEpochId:'fresh-epoch',rev:{c:1,d:'phone'}};
  const previous=w.OCSync.catalogoPropio;
  w.OCSync.catalogoPropio=()=>({...previous.call(w.OCSync),productos:[first]});
  try {
    a._store.sembrar();
    assert.equal(a.mapas.productos.get(first.id).stockActual,4);
    assert.notEqual(a.mapas.productos.get(first.id).stockConciliacionPendiente,true);
  }finally{w.OCSync.catalogoPropio=previous}
});
test('read model never certifies stock or valuation from a pending physical-epoch conflict',()=>{
  const R=require('../docs/core/business-read-model.js');
  const p={stockActual:7,costo:5,stockConciliacionPendiente:true};
  assert.deepEqual(R.stock(p),{known:false,units:null});
  assert.deepEqual(R.inventory([p]),{units:null,valueCents:null,unknownStock:1,unknownCost:0});
  assert.deepEqual(R.stock({stockActual:7,costo:5}),{known:true,units:7});
});
test('backend preserves physical-epoch warning through backup, remote merge and inventory card',async()=>{
  const w=browser();
  const snap=await w.request('/api/respaldo/exportar');
  const p=snap.productos.find(x=>Number(x.stockActual)>=1);
  assert.ok(p);
  p.stockActual=7;p.stockBase=7;p.stockEpochId='physical-A';p.stockPN={};
  const id=p.id;
  snap.productos=[p];
  await w.request('/api/respaldo/importar','POST',snap);
  const remote=w.OCSync.catalogoPropio(),item=remote.productos.find(x=>x.id===id);
  item.stockActual=6;item.stockBase=6;item.stockEpochId='physical-B';item.stockPN={};
  w.OCSync.aplicarCatalogo(remote,null);
  const after=(await w.request('/api/respaldo/exportar')).productos.find(x=>x.id===id);
  assert.equal(after.stockConciliacionPendiente,true);
  assert.equal(after.stockActual,7,'do not impose either count on a disputed shelf');
  const cards=await w.request('/api/productos');
  const array=Array.isArray(cards)?cards:cards.productos||cards.data;
  assert.ok(Array.isArray(array),'actual inventory API returns products');
  const view=array.find(x=>x.id===id);
  assert.equal(view.stockConciliacionPendiente,true);
  assert.match(view.mensaje,/pendientes de conciliación/i);
});
