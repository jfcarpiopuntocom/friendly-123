'use strict';
// v766 (v0.7.66): the roomless Yjs journal f123_yjs_ops_pendientes_v1_<licence>
// is pruned ONLY after each op is read back from the ops Y.Doc's IndexedDB
// (real y-indexeddb from the shipped bundle over fake-indexeddb). Synthetic data only.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {indexedDB,IDBKeyRange}=require('fake-indexeddb');
const src=fs.readFileSync(path.join(__dirname,'../docs/sync-realtime.js'),'utf8');
const bundle=fs.readFileSync(path.join(__dirname,'../docs/vendor/yjs-bundle.min.js'),'utf8');
const ja=src.indexOf('  const COLA_YJS_SIN_SALA = '),jb=src.indexOf('  // --- Puente con mock-backend.js:',ja);
const ea=src.indexOf('  window.OCSyncEmit = function (tipo, payload) {'),eb=src.indexOf('  function encolar(op)',ea);
assert.ok(ja>0&&jb>ja&&ea>jb&&eb>ea,'real journal + OCSyncEmit blocks');
const code=src.slice(ja,jb)+'\n'+src.slice(ea,eb).replace(/  \/\* NO PERDER EN SILENCIO[\s\S]*$/,'');
const KEY='f123_yjs_ops_pendientes_v1_';
let dbSeq=0;
const newDb=()=>'f123-yjs-ops-synthetic-'+process.pid+'-'+(++dbSeq);

async function waitFor(check,ms=3000){
  const end=Date.now()+ms;
  while(!check()&&Date.now()<end)await new Promise(r=>setTimeout(r,5));
  return check();
}
const settle=()=>new Promise(r=>setTimeout(r,60));

// One browser tab: shipped Yjs bundle + real IndexeddbPersistence + the shipped journal code.
async function device({storage,licencia,dbName,persist=true}){
  const listeners={},clock={t:1e12},lic={v:licencia};let n=0;
  const ctx={indexedDB,IDBKeyRange,console,setTimeout,clearTimeout,queueMicrotask,crypto:require('node:crypto').webcrypto};
  ctx.window=ctx;vm.createContext(ctx);vm.runInContext(bundle,ctx);
  // Only the journal code reads this clock (the bundle captured the real Date at load).
  ctx.Date=class extends Date{static now(){return clock.t}};
  const parses={n:0};
  // Count parses with the context's OWN JSON: main-realm objects would not encode as Yjs ContentAny.
  const J=vm.runInContext('JSON',ctx);ctx.JSON={stringify:J.stringify,parse:(s)=>{parses.n++;return J.parse(s)}};
  Object.assign(ctx,{
    localStorage:{getItem:k=>storage.has(k)?storage.get(k):null,setItem:(k,v)=>{storage.set(k,String(v))}},
    addEventListener:(t,fn)=>{(listeners[t]=listeners[t]||[]).push(fn)},
    dispatchEvent:e=>{(listeners[e.type]||[]).forEach(fn=>fn(e));return true},
    CustomEvent:class{constructor(type,o){this.type=type;this.detail=o&&o.detail}},
    setInterval:()=>0,leerSala:()=>null,codigoCuadernoActivo:()=>lic.v,normalizarCodigo:x=>String(x||''),
    uuidCorto:()=>'op-'+licencia+'-'+dbName.slice(-6)+'-'+(++n),deviceId:()=> 'phone',siguienteLamport:()=>n,
    OCCurrentUser:{nombre:'owner'}
  });
  const Y=ctx.Y,opsDoc=new Y.Doc(),opsMap=opsDoc.getMap('eventos');
  const opsIdb=persist?new ctx.IndexeddbPersistence(dbName,opsDoc):null;
  if(opsIdb)await opsIdb.whenSynced;
  ctx.OCYjs={estado:'activo',codigoCuaderno:licencia,opsMap,opsIdb,opsDoc};
  // publicarOpLocal (docs/sync-yjs.js): same opId, set once.
  ctx.addEventListener('oc-op-local',ev=>{const op=ev.detail;if(op&&op.opId&&!opsMap.get(op.opId))opsMap.set(op.opId,op)});
  vm.runInContext(code+'\nthis.drain=drenarPendientesYjs;this.read=leerPendientesYjs;',ctx);
  return {ctx,clock,lic,parses,opsDoc,opsMap,opsIdb,Y,
    emit:(tipo,payload)=>ctx.window.OCSyncEmit(tipo,payload),
    drain:()=>{clock.t+=20000;ctx.drain()},
    journal:()=>JSON.parse(storage.get(KEY+licencia)||'[]'),
    // Simulates y-indexeddb writes that never reach disk (abort / quota): RAM only.
    cutDisk:()=>opsDoc.off('update',opsIdb._storeUpdate),
    close:async()=>{if(opsIdb)await opsIdb.destroy()}};
}
async function idsOnDisk(dbName,ctxY){
  const d=new ctxY.Y.Doc(),p=new ctxY.IndexeddbPersistence(dbName,d);await p.whenSynced;
  const ids=[...d.getMap('eventos').keys()];await p.destroy();return ids;
}

test('(a) journal does not grow without bound once each op is read back from IndexedDB',async()=>{
  const storage=new Map(),dbName=newDb(),dev=await device({storage,licencia:'A',dbName});
  const emitted=[];
  for(let i=0;i<40;i++){
    assert.equal(dev.emit('ajuste',{productoId:'p'+i,delta:-1}),true);
    emitted.push(dev.journal().slice(-1)[0]&&dev.journal().slice(-1)[0].opId);
    dev.drain();await settle();
    assert.ok(dev.journal().length<=2,'journal bounded while selling, got '+dev.journal().length);
  }
  assert.ok(await waitFor(()=>{dev.drain();return dev.journal().length===0}),'confirmed ops pruned, left '+dev.journal().length);
  const disk=await idsOnDisk(dbName,dev.ctx);
  assert.equal(dev.opsMap.size,40);
  assert.equal(disk.length,40,'every movement is durable in the ops Y.Doc IndexedDB');
  await dev.close();
});

test('(b) without a durability proof nothing is pruned (RAM-only, no IDB, corrupt journal)',async()=>{
  // b1: y-indexeddb write never reaches disk: opsMap has it, IndexedDB does not.
  const storage=new Map(),dbName=newDb(),dev=await device({storage,licencia:'A',dbName});
  dev.cutDisk();
  for(let i=0;i<5;i++){assert.equal(dev.emit('venta',{i}),true);dev.drain();await settle();}
  for(let i=0;i<3;i++){dev.drain();await settle();}
  assert.equal(dev.opsMap.size,5,'ops are in RAM');
  assert.equal(dev.journal().length,5,'RAM is not a durable ACK');
  await dev.close();
  // b2: persistence absent.
  const s2=new Map(),d2=await device({storage:s2,licencia:'A',dbName:newDb(),persist:false});
  for(let i=0;i<3;i++){d2.emit('venta',{i});d2.drain();await settle();}
  assert.equal(JSON.parse(s2.get(KEY+'A')).length,3);
  // b3: corrupt journal is neither treated as empty nor rewritten.
  const s3=new Map([[KEY+'A','{corrupt']]),d3=await device({storage:s3,licencia:'A',dbName:newDb()});
  assert.equal(d3.emit('venta',{x:1}),false);
  d3.drain();await settle();
  assert.equal(s3.get(KEY+'A'),'{corrupt');
  await d3.close();
});

test('(c) reload mid-way keeps unconfirmed ops and replays them; licence switch during readback prunes nothing',async()=>{
  const storage=new Map(),dbName=newDb(),dev=await device({storage,licencia:'A',dbName});
  assert.equal(dev.emit('venta',{n:1}),true);
  assert.ok(await waitFor(()=>{dev.drain();return dev.journal().length===0}),'durable op1 pruned');
  dev.cutDisk();
  assert.equal(dev.emit('venta',{n:2}),true);
  const op2=dev.journal()[0].opId;
  dev.drain();await settle();
  assert.deepEqual(dev.journal().map(o=>o.opId),[op2],'unconfirmed op2 kept');
  await dev.close(); // tab dies: op2 only ever reached RAM
  const again=await device({storage,licencia:'A',dbName});
  assert.equal(again.opsMap.get(op2),undefined,'reloaded Y.Doc lacks op2');
  assert.ok(await waitFor(()=>{again.drain();return again.journal().length===0}),'op2 replayed and then pruned');
  assert.ok(again.opsMap.get(op2),'op2 replayed with the SAME opId');
  assert.ok((await idsOnDisk(dbName,again.ctx)).includes(op2));
  assert.equal(again.opsMap.size,2,'no duplicate');
  // Licence switch while the IndexedDB readback is in flight.
  again.clock.t+=20000; // past the readback cadence, so emit's own drain really starts one
  assert.equal(again.emit('venta',{n:3}),true); // emit drains and starts the readback
  again.lic.v='B';
  await settle();await settle();
  assert.equal(again.journal().length,1,'proof read under licence A is void after a switch');
  await again.close();
});

test('(d) another licence journal is never touched',async()=>{
  const storage=new Map(),dbName=newDb(),dev=await device({storage,licencia:'A',dbName});
  assert.equal(dev.emit('venta',{n:1}),true);
  const id=dev.journal()[0].opId;
  // Same opId under licence B and a foreign-provenance entry inside A's journal.
  const foreign={opId:id,_salaOrigen:'B',tipo:'venta',payload:{}};
  const rawB=JSON.stringify([foreign]);storage.set(KEY+'B',rawB);
  storage.set(KEY+'A',JSON.stringify(dev.journal().concat([foreign])));
  assert.ok(await waitFor(()=>{dev.drain();return dev.journal().length===1}));
  assert.equal(dev.journal()[0]._salaOrigen,'B','foreign entry stays');
  assert.equal(storage.get(KEY+'B'),rawB,'licence B journal byte-identical');
  await dev.close();
});

test('drain does not re-parse an unchanged journal, yet still replays a new op from another tab',async()=>{
  const storage=new Map(),dbName=newDb(),dev=await device({storage,licencia:'A',dbName});
  dev.cutDisk();
  dev.emit('venta',{n:1});await settle();
  const before=dev.parses.n;
  for(let i=0;i<10;i++)dev.drain();
  await settle();
  assert.equal(dev.parses.n,before,'unchanged journal: zero JSON.parse');
  const other={opId:'from-other-tab',_salaOrigen:'A',tipo:'venta',payload:{}};
  storage.set(KEY+'A',JSON.stringify(dev.journal().concat([other])));
  dev.drain();
  assert.ok(dev.opsMap.get('from-other-tab'),'changed journal is parsed and replayed');
  assert.equal(dev.parses.n,before+1);
  await dev.close();
});
