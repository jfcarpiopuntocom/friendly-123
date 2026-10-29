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


const ID='scn';
async function setup(a,b,fx){
  const f=await a.w.request('/api/respaldo/exportar');
  f.ventas=[];f.movimientos=[];
  for(const [p,over] of [[a,fx.a],[b,fx.b||fx.a]]){
    const g=JSON.parse(JSON.stringify(f));
    g.productos=[{...f.productos[0],id:ID,nombre:'Synthetic scn',barcode:'SCN',stockTs:1,rev:{c:1,d:'fx'},...over}];
    for(const k of Object.keys(over)) if(over[k]===undefined) delete g.productos[0][k];
    await p.w.request('/api/respaldo/importar','POST',g);
    p.w.OCYjs._store.sembrar();
  }
  await a.flush();await b.flush();
}
const get=async p=>{const x=(await p.w.request('/api/respaldo/exportar')).productos.find(q=>q.id===ID);return x;};
const fin=async p=>{const x=await get(p);return x.stockActual+'|b'+x.stockBase+'|'+JSON.stringify(Object.values(x.stockPN||{}).map(v=>v.add+'/'+v.sub))+'|ep'+(x.stockEpochId||'-');};
const adj=(p,d)=>p.w.request('/api/productos/'+ID+'/ajustar','POST',{delta:d,motivo:'scn'});
async function exchange(a,b,rounds=1){
  for(let i=0;i<rounds;i++){
    const aS=a.w.Y.encodeStateAsUpdate(a.w.OCYjs.doc),bS=b.w.Y.encodeStateAsUpdate(b.w.OCYjs.doc);
    b.w.Y.applyUpdate(b.w.OCYjs.doc,aS,'red');a.w.Y.applyUpdate(a.w.OCYjs.doc,bS,'red');
    a.w.OCYjs._store.aplicar();b.w.OCYjs._store.aplicar();await a.flush();await b.flush();
  }
}

const relay=p=>{p.w.OCLatencia={ahoraRelay:()=>Date.now()};};
const final=async p=>(await get(p)).stockActual;
// RED (P0 v610 forensic, synthetic): the same product with the same stockBase=4, one device tagged with a
// stockEpochId and the other untagged, each adjusting while apart. After full bidirectional exchange both
// must read 8 (4 +5 -1). Today A stays 9 and B stays 3 forever (docs/mock-backend.js epochConflict branch,
// docs/sync-yjs.js sinPruebaEpoca / _epochPreferred): fail-closed gate with no resolution path.
test('RED epoch-tagged vs untagged peer, same base, converge after exchange',async()=>{
  const a=await peer(),b=await peer();
  await setup(a,b,{a:{stockActual:4,stockBase:4,stockPN:{},stockEpochId:'E1'},b:{stockActual:4,stockBase:4,stockPN:{}}});
  await adj(a,5);await adj(b,-1);await exchange(a,b,4);
  assert.deepEqual([await final(a),await final(b)],[8,8]);
});
// RED: base fork where the loser's stockTs is >5 min in the future of the shared relay clock. Neither side
// ever adopts the other and later +1 on A never reaches B (docs/mock-backend.js _ganaEpocaStockRemota:3337 and
// docs/sync-yjs.js futuroMio/futuroDoc ~2279). Old behaviour (v517), present in v607.
test('RED base fork with future stockTs on one peer converges',async()=>{
  const now=Date.now(),a=await peer(),b=await peer();
  await setup(a,b,{a:{stockActual:9,stockBase:4,stockPN:{devA:{add:5,sub:0}},stockTs:now},
    b:{stockActual:6,stockBase:8,stockPN:{devB:{add:0,sub:2}},stockTs:now+3600e3}});
  relay(a);relay(b);await exchange(a,b,4);
  assert.equal(await final(a),await final(b));
});
