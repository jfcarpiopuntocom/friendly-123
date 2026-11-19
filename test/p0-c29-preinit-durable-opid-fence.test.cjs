'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {IDBFactory}=require('fake-indexeddb');
const {pathToFileURL}=require('node:url');
const SOURCE=fs.readFileSync(path.join(__dirname,'../docs/sync-yjs.js'),'utf8');
const NS='b'.repeat(64);
const OP='op_c29_committed_00001';

// Run real function bytes from the product (not a rewritten simulator).
function getFunction(anchor) {
  const p=SOURCE.indexOf(anchor);
  assert.ok(p>=0,'function missing from real docs/sync-yjs.js: '+anchor);
  const open=SOURCE.indexOf('{',p+anchor.length);
  assert.ok(open>p,'opening function brace absent');
  let depth=0;
  for(let i=open;i<SOURCE.length;i++){
    if(SOURCE[i]==='{')depth++;
    else if(SOURCE[i]==='}'&&--depth===0)return SOURCE.slice(p,i+1);
  }
  throw Error('function boundary incomplete');
}
const SOURCE_PUBLICAR=getFunction('function publicarOpLocal(op)');
function evaluatePublish(API){
  const context=vm.createContext({API,Promise});
  vm.runInContext(SOURCE_PUBLICAR,context);
  return context.publicarOpLocal;
}
function evaluateGuard(API){
  const assigned=getFunction('API.puedeDespacharOpEnLegado = function (opId)');
  vm.runInNewContext(assigned, {API,Promise});
  return API.puedeDespacharOpEnLegado;
}
function tick(){return new Promise(r=>setImmediate(r));}
function command(opId){return {
  license:'F123-SYNT-C29GUARD',opId,kind:'sale.record',
  productId:'sku_1',quantity:1,amountCents:1800
};}
function pending(opId){return {
  opId,command:command(opId),sameDoLocked:true,
  state:'pending',attempts:0,createdAt:1700000000000,updatedAt:1700000000000
};}
async function realStore(){
  const {createTypedOpsIdbStore}=await import(pathToFileURL(path.join(__dirname,'../src/port2-typed-ops-idb-store.mjs')).href);
  const indexedDB=new IDBFactory();
  return createTypedOpsIdbStore({indexedDB,namespace:NS});
}

test('C29 RED: exact publicarOpLocal must not bypass durable marker while QA pilot exists and C25 coordinator is not instantiated',async()=>{
  const API={
    opsMap:new Map(),coordinadorCorte20:null,
    __port2DurableFenceAvailable:true,
    puedeDespacharOpEnLegado:async()=>false
  };
  const publicar=evaluatePublish(API);
  publicar({opId:OP,tipo:'venta'});
  await tick();
  assert.equal(API.opsMap.has(OP),false,'uninitialized coordinator must NOT expose settled C21b opId to 1.0');
});

test('C29 cold Safari: the real API guard must load C21b settled_ops from actual IndexedDB and allow unrelated untouched legacy opId',async()=>{
  const store=await realStore();
  await store.save(pending(OP));
  await store.markCommitted(OP);
  assert.deepEqual(await store.loadAll(),[]);
  assert.deepEqual(await store.loadCommittedOpIds(),[OP]);
  const API={
    opsMap:new Map(),coordinadorCorte20:null,
    __port2DurableFenceAvailable:true,
    crearAlmacenDurableOpsTipadas:async()=>store
  };
  evaluateGuard(API);
  const publicar=evaluatePublish(API);
  publicar({opId:OP,tipo:'venta'});
  await new Promise(r=>setTimeout(r,40));
  assert.equal(API.opsMap.has(OP),false,'durable tombstone survives second Safari restart WITHOUT coordinator');
  const next='op_c29_legacy_fresh_02';
  publicar({opId:next,tipo:'venta'});
  await new Promise(r=>setTimeout(r,40));
  assert.equal(API.opsMap.has(next),true,'untouched legacy operation must remain available');
});

test('C29 fail-closed: unreadable committed marker/pending IDB blocks legacy op and never translates error into an ACK',async()=>{
  const API={
    opsMap:new Map(),coordinadorCorte20:null,
    __port2DurableFenceAvailable:true,
    crearAlmacenDurableOpsTipadas:async()=>({
      loadAll:async()=>[],
      loadCommittedOpIds:async()=>{throw Error('Safari IndexedDB blocked');}
    })
  };
  evaluateGuard(API);
  const publicar=evaluatePublish(API);
  publicar({opId:'op_c29_offline_0001',tipo:'venta'});
  await tick();await tick();
  assert.equal(API.opsMap.size,0);
  assert.equal(await API.puedeDespacharOpEnLegado('op_c29_offline_0001'),false);
});

test('C29 legacy invariant: no pilot means unchanged immediate local publish; initialized coordinator remains authoritative',async()=>{
  const API={
    opsMap:new Map(),coordinadorCorte20:null,
    __port2DurableFenceAvailable:false
  };
  const publicar=evaluatePublish(API);
  publicar({opId:'op_c29_old_legacy_01',tipo:'venta'});
  assert.equal(API.opsMap.has('op_c29_old_legacy_01'),true,
    'QA OFF must not turn local-first legacy into async or silently drop sales');
  API.__port2DurableFenceAvailable=true;
  API.coordinadorCorte20={canDispatchOnLegacy:async()=>false};
  API.puedeDespacharOpEnLegado=()=>API.coordinadorCorte20.canDispatchOnLegacy();
  publicar({opId:'op_c29_locked_0001',tipo:'venta'});
  await tick();
  assert.equal(API.opsMap.has('op_c29_locked_0001'),false);
});
