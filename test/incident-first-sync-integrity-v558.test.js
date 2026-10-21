"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
const doc = (p) => fs.readFileSync(path.join(__dirname, "../docs", p), "utf8");

// An isolated bug reproducer using the ACTUAL source function with synthetic,
// invented shop states. No customer data, PINs or network traffic.
function checkpointFunction() {
  const s = doc("sync-realtime.js");
  const a = s.indexOf("  async function subirCheckpoint(forzar) {");
  const b = s.indexOf("\n  function pullDelRelay()", a);
  assert.ok(a > 0 && b > a, "checkpoint production function found exactly");
  return s.slice(a, b).replace("async function subirCheckpoint(forzar)", "async function testCheckpoint(forzar)") +
    "\nreturn testCheckpoint;";
}
async function simulateCheckpoint(snap, yjs) {
  const sent = [], events = [];
  const ws = {readyState: 1, send: (frame) => sent.push(JSON.parse(frame))};
  const context = {
    ws, WebSocket: {OPEN: 1}, claveActual: {}, salaIdActual: "synthetic-room",
    window: {OCSync:{estadoParaCheckpoint:()=>snap}, OCYjs:yjs,
      dispatchEvent:e=>events.push(e.type)},
    CustomEvent:class {constructor(type,init){this.type=type;this.detail=init.detail;}},
    localStorage:{getItem:()=>null},
    _ultimaHuellaCkpt:"", _ckptEnVuelo:null, deviceId:()=> "synthetic-device",
    lamportActual:()=>1, _lamportAplicadoMax:1, uuidCorto:()=>"fixture",
    cifrar:async()=>new Uint8Array([1,2,3]).buffer,
    ab2b64:()=>"synthetic-ciphertext"
  };
  const fn = vm.runInNewContext(checkpointFunction(),context);
  await fn(true);
  return {sent,events};
}
const sample={ubicaciones:[{id:"shelf"}],productos:[{id:"p1",stockActual:7}],clientes:[],
  huella:{completa:"verified-synthetic-hash"},nombreNegocio:"Synthetic Shop"};
test("P0: purged/new licensed phone must not send empty authoritative checkpoint",async()=>{
  const r=await simulateCheckpoint({productos:[],ubicaciones:[],clientes:[],huella:{completa:"fallback"}},null);
  assert.equal(r.sent.length,0);
  assert.deepEqual(r.events,["oc-sync-checkpoint-protegido"]);
});
test("P0: a legitimate inventory must send encrypted checkpoint when fully ready",async()=>{
  const r=await simulateCheckpoint(sample,{doc:{store:{}},canal:{recuperando:false}});
  assert.equal(r.sent.length,1);
  assert.equal(r.sent[0].k,"ckpt");
  assert.equal(r.sent[0].c,"synthetic-ciphertext");
});
test("P0: incomplete Yjs causal history must not be compacted by older local state",async()=>{
  for(const yjs of [
    {doc:{store:{pendingStructs:{}}},canal:{recuperando:false}},
    {doc:{store:{pendingDs:{}}},canal:{recuperando:false}},
    {doc:{store:{}},canal:{recuperando:true}}
  ]) assert.equal((await simulateCheckpoint(sample,yjs)).sent.length,0);
});
test("P0: Yjs snapshot is forbidden until pull complete and dependencies resolved",()=>{
  const code=doc("sync-yjs.js");
  const a=code.indexOf("    function hacerCkpt() {");
  const b=code.indexOf("      var checkpointCursor =",a);
  assert.ok(a>0&&b>a);
  const prefix=code.slice(a,b).replace("function hacerCkpt()","function inspectCkpt()")+
    "\nreturn inspectCkpt;";
  function check(recuperando,enCurso,pending) {
    const c={permiteCkpt:true,API:{clave:{}},canal:{ws:{readyState:1},recuperando},
      _currentPullState:{enCurso},_appliedPullCursor:{rev:1},
      partesEntrantes:{},doc:{store:pending||{}},_outbox:{pending:[]}};
    const fn=vm.runInNewContext(prefix.replace("      var checkpointCursor =",""),c);
    return fn()===undefined;
  }
  // The guarded prefix returns undefined both on guard and normal flow;
  // use an appended sentinel to distinguish a rejected checkpoint.
  const probe=code.slice(a,b).replace("function hacerCkpt()","function inspectCkpt()")+
    "      return 'ALLOWED';\n    }\nreturn inspectCkpt;";
  function result(recovering,pull,pending) {
    const ctx={permiteCkpt:true,API:{clave:{}},canal:{ws:{readyState:1},recuperando:recovering},
      _currentPullState:{enCurso:pull},_appliedPullCursor:{rev:1},
      partesEntrantes:{},doc:{store:pending||{}}};
    return vm.runInNewContext(probe,ctx)();
  }
  assert.equal(result(true,false,{}),undefined);
  assert.equal(result(false,true,{}),undefined);
  assert.equal(result(false,false,{pendingStructs:{}}),undefined);
  assert.equal(result(false,false,{}),"ALLOWED");
});
test("P0: empty first-join catalog cannot seed factory metadata before recovery",()=>{
  const source=doc("sync-yjs.js");
  const a=source.indexOf("    function sembrar() {");
  const b=source.indexOf("      try {\n        API.doc.transact(",a);
  assert.ok(a>0&&b>a);
  const probe=source.slice(a,b).replace("function sembrar()","function inspectSeed()")+
    "      return 'ALLOWED';\n    }\nreturn inspectSeed;";
  function run(recovering,cat) {
    return vm.runInNewContext(probe,{_aplicando:false,API:{canal:{recuperando}},
      window:{OCSync:{catalogoPropio:()=>cat}}})();
  }
  assert.equal(run(true,{productos:[],ubicaciones:[],ventas:[],clientes:[],nombreNegocio:"old local name"}),undefined);
  assert.equal(run(true,{productos:[{id:"real"}],ubicaciones:[],ventas:[],clientes:[]}),"ALLOWED");
  assert.equal(run(false,{productos:[],ubicaciones:[],ventas:[],clientes:[]}),"ALLOWED");
});
