"use strict";
const {test}=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const vm=require("node:vm");
const path=require("node:path");
const src=fs.readFileSync(path.join(__dirname,"../docs/sync-yjs.js"),"utf8");

function cursorFixture(pending=false,fragments={}) {
  const block=(start,end)=>{
    const a=src.indexOf(start),b=src.indexOf(end,a);
    assert.ok(a>=0&&b>a,`production function anchors found: ${start}`);
    return src.slice(a,b);
  };
  const barrier=block("    function barreraYjsConfirmada() {","    function guardarPruebaCausal(");
  const proof=block("    function guardarPruebaCausal(cursor, pendientes) {","    function cursorValido(");
  const pull=block("    function guardarPullCursor(cursor) {","    function clavePendientes()");
  const saved=[],persistencia={
    db:{objectStoreNames:{contains:name=>name==="updates"},transaction(names,mode){
      assert.deepEqual(names,["updates"]); assert.equal(mode,"readonly");
      const tx={}; queueMicrotask(()=>tx.oncomplete&&tx.oncomplete()); return tx;
    }},
    set:async(key,value)=>saved.push([key,JSON.parse(JSON.stringify(value))]),
    get:async()=>saved[saved.length-1]?.[1]
  };
  const make=new Function("persistencia",`
    let _appliedPullCursor={rev:2,seq:10},_pullCursor={rev:2,seq:10};
    let _soloMemoria=false,_pendingProofPages=0,_cursorContainsPending=false;
    let _ultimoCursorLimpio={rev:2,seq:10};
    const MAX_PENDING_PROOF_BYTES=1024,_pullCursorKey="fixture-cursor";
    const doc={store:${pending?"{pendingStructs:{}}":"null"}};
    const partesEntrantes=arguments[1]||{};
    const Y={encodeStateVector:()=>new Uint8Array(0),encodeStateAsUpdate:()=>new Uint8Array(0)};
    ${barrier}${proof}${pull}
    return {saveCursor:guardarPullCursor,doc,
      get _pullCursor(){return _pullCursor},get _appliedPullCursor(){return _appliedPullCursor}};
  `);
  const ctx=make(persistencia,fragments);
  return {ctx,saved};
}
test("P0 Yjs pending causal parent keeps cursor in RAM but NEVER persists it",async()=>{
  const {ctx,saved}=cursorFixture(true);
  await ctx.saveCursor({rev:3,seq:50});
  assert.equal(ctx._pullCursor.seq,50,"RAM pagination may proceed");
  assert.equal(ctx._appliedPullCursor.seq,10,"durable proven cut unchanged");
  assert.equal(saved.length,0,"no ACK of un-applied pages");
});
test("P0 a later complete Yjs page may advance and persist proved cursor",async()=>{
  const {ctx,saved}=cursorFixture(true);
  await ctx.saveCursor({rev:3,seq:50});
  ctx.doc.store.pendingStructs=null;
  await ctx.saveCursor({rev:3,seq:60});
  assert.equal(ctx._appliedPullCursor.seq,60);
  assert.equal(saved.length,1);
  assert.equal(saved[0][1].seq,60);
});
test("P0 incomplete transport fragments also prevent checkpointing cursor",async()=>{
  const {ctx,saved}=cursorFixture(false,{unfinished:true});
  await ctx.saveCursor({rev:3,seq:40});
  assert.equal(ctx._appliedPullCursor.seq,10);
  assert.equal(saved.length,0);
});

function replayFixture(pending=true) {
  const a=src.indexOf("      ws.onmessage = function (ev) {");
  const b=src.indexOf("      _directReceive = function (buf) {",a);
  assert.ok(a>0&&b>a);
  const timers=[],replay=[],ws={readyState:1,onmessage:null,close(){this.readyState=3;}};
  const pullEstado={enCurso:true,fallos:0,headLegacy:true},ctx={
    ws,API:{clave:{},_store:{aplicar:()=>{ctx.applied=(ctx.applied||0)+1;}}},
    canal:{ws,recuperando:true},
    doc:{store:pending?{pendingStructs:{}}:{}},pullEstado,
    _colaRecepcion:Promise.resolve(),_pullCursor:{rev:5,seq:50},
    _appliedPullCursor:{rev:2,seq:10},
    _replayDelay:30000,_tReplay:null,_replayKey:null,_replayUsed:0,partesEntrantes:{},_relayPeerCount:0,
    manejar:async()=>true,guardarPullCursor:async()=>{},
    pedirPagina:(sock,state)=>{state.enCurso=true;replay.push({...ctx._pullCursor});return Promise.resolve();},
    confirmarDurable:()=>{},nombre:"catalogo",window:{},log:()=>{},
    clearTimeout:()=>{},setTimeout:(fn,delay)=>{timers.push({fn,delay});return timers.length;},
    Promise,JSON,Object,Number,Math,Date,ArrayBuffer,Blob:class{},
    deudaPendiente:()=>!!ctx.doc.store.pendingStructs,
    clavePendientes:()=>JSON.stringify([!!ctx.doc.store.pendingStructs]),
  };
  vm.createContext(ctx);
  const ra=src.indexOf("    function programarRelectura(sock, estado) {");
  const rb=src.indexOf("    // Only useful, applied bytes",ra);
  assert.ok(ra>0&&rb>ra);
  vm.runInContext(src.slice(ra,rb)+"\n"+src.slice(a,b)+"\nthis.getQueue=()=>_colaRecepcion;",ctx);
  return {ctx,timers,replay,ws,pullEstado};
}
test("P0 end of stream with orphan structs schedules backoff and replays from PROVEN cursor",async()=>{
 const f=replayFixture(true);
 f.ws.onmessage({data:JSON.stringify({k:"pull-page",rev:5,seq:50,more:false})});
 await f.ctx.getQueue();
 assert.equal(f.ctx.canal.recuperando,true,"never mark credentials/catalog as synced");
 assert.equal(f.timers.length,1,"schedule incremental retry not infinite immediate loop");
 assert.equal(f.timers[0].delay,30000);
 f.timers[0].fn();
 assert.deepEqual(f.replay,[{rev:5,seq:50}], "live connection polls newer rows, durable cut stays uncommitted");
 assert.equal(f.pullEstado.enCurso,true);
});
test("P0 fully resolved Yjs history completes recovery without repetitive replay",async()=>{
 const f=replayFixture(false);
 f.ws.onmessage({data:JSON.stringify({k:"pull-page",rev:5,seq:50,more:false})});
 await f.ctx.getQueue();
 assert.equal(f.ctx.canal.recuperando,false);
 assert.equal(f.timers.length,0);
 assert.equal(f.ctx.applied,1);
});
