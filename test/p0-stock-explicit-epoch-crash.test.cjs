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
    stockEpochId:'epoch-A',stockTs:5000,rev:{c:1,d:'deviceA'}};
  const remote={...local,stockActual:6,stockBase:8,
    stockPN:{deviceB:{add:0,sub:2}},stockEpochId:'epoch-B',
    stockTs:9000,rev:{c:2,d:'deviceB'}};
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
  }finally{w.OCSync.catalogoPropio=original}
});
