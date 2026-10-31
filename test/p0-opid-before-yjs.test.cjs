'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Execute exact production emitter with synthetic-only dependencies.
const src=fs.readFileSync(path.join(__dirname,'../docs/sync-realtime.js'),'utf8');
const first=src.indexOf('  window.OCSyncEmit = function (tipo, payload) {');
const last=src.indexOf('  /* NO PERDER EN SILENCIO',first);
assert.ok(first>=0&&last>first,'production source anchors');
const emitter=src.slice(first,last);
function fixture(canStore) {
  const trace=[];
  const code=[
    'let durable=false, saved=null, published=null;',
    'const window={OCCurrentUser:{nombre:"synthetic-only"},dispatchEvent(e){trace.push({step:"publish",durable});published=e.detail;}};',
    'const CustomEvent=function(type,options){this.detail=options.detail;};',
    'const leerSala=()=>({codigo:"SYNTHETIC-ROOM"});',
    'const normalizarCodigo=v=>String(v||"").trim().toUpperCase();',
    'const codigoCuadernoActivo=()=>"SYNTHETIC-ROOM";',
    'const uuidCorto=()=>"synthetic-operation-id";',
    'const deviceId=()=>"synthetic-device";',
    'const siguienteLamport=()=>1;',
    'const registrarEnLog=op=>trace.push({step:"log",id:op.opId});',
    'const encolar=op=>{trace.push({step:"enqueue",id:op.opId});if(canStore){durable=true;saved=op;}return canStore;};',
    'const WebSocket={OPEN:1},ws=null;',
    emitter,
    'return {ok:window.OCSyncEmit("venta",{productoId:"synthetic"}),saved,published};'
  ].join('\n');
  return {...new Function('canStore','trace',code)(canStore,trace),trace};
}
test('queue commit precedes exact Yjs event',()=>{
  const f=fixture(true);
  assert.equal(f.ok,true);
  assert.equal(f.trace[0].step,'enqueue');
  assert.equal(f.trace.find(x=>x.step==='publish').durable,true);
  assert.equal(f.saved.opId,'synthetic-operation-id');
  assert.deepEqual(f.saved,f.published);
});
test('failed queue still exposes Yjs fallback without fake success',()=>{
  const f=fixture(false);
  assert.equal(f.ok,false);
  assert.equal(f.published.opId,'synthetic-operation-id');
});
test('offline operation is enqueued only once',()=>{
  assert.equal(fixture(true).trace.filter(x=>x.step==='enqueue').length,1);
});

const proofStart=src.indexOf('  function opDeEsteCuaderno(op) {');
const proofEnd=src.indexOf('  // --- Cripto:',proofStart);
assert.ok(proofStart>=0&&proofEnd>proofStart,'real room provenance guard present');
const proof=src.slice(proofStart,proofEnd);
function isFromActive(op,active,joined,owned) {
  const code=[
    'const normalizarCodigo=v=>String(v||"").trim().toUpperCase();',
    'const codigoCuadernoActivo=()=>active;',
    'const localStorage={getItem:k=>k==="f123_tienda_activa"?joined:k==="f123_owned"?JSON.stringify({licenseCode:owned}):null};',
    proof,
    'return opDeEsteCuaderno(op);'
  ].join('\n');
  return new Function('op','active','joined','owned',code)(op,active,joined,owned);
}
test('legacy catchup and queue never select a different licensed notebook',()=>{
  const A='SYNTHETIC-A',B='SYNTHETIC-B';
  assert.equal(isFromActive({opId:'a',_salaOrigen:A},A,'',B),true);
  assert.equal(isFromActive({opId:'a',_salaOrigen:A},B,'',B),false);
  assert.equal(isFromActive({opId:'a'},A,'',A),true,'old own-store op remains recoverable');
  assert.equal(isFromActive({opId:'a'},B,'::'+B,A),false,'ambiguous old joined op held');
  assert.equal(isFromActive({opId:'a'},'', '',A),false);
  const emits=fixture(true);
  assert.equal(emits.saved._salaOrigen,'SYNTHETIC-ROOM');
  assert.deepEqual(emits.saved,emits.published,'same operation for Yjs, legacy and history');
});
