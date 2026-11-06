"use strict";
const {test}=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),vm=require("node:vm"),path=require("node:path");
const src=fs.readFileSync(path.join(__dirname,"../docs/sync-yjs.js"),"utf8");
function harness({pending=true,clean=true,budget=1}={}){
 const start=src.indexOf("    function clavePendientes() {",src.indexOf("function crearCanal("));
 const end=src.indexOf("    function reprogramar() {",start);
 assert.ok(start>0&&end>start,"real HEAD and pull path present");
 const sent=[],ws={readyState:1,send:msg=>sent.push(JSON.parse(msg))};
 const ctx={ws,Promise,Number,Math,JSON,Object,Map,Array,Uint8Array,
  doc:{store:pending?{pendingStructs:{missing:new Map([[7,9]])}}:{}},partesEntrantes:{},
  canal:{ws,recuperando:true},_pullCursorReady:Promise.resolve(),
  _pullCursor:{rev:3,seq:120},_appliedPullCursor:{rev:3,seq:120},
  _ultimoCursorLimpio:clean?{rev:3,seq:80}:{rev:-1,seq:0},
  _replayUsed:budget,_replayKey:null,_tReplay:null,
  _soloMemoria:false,PULL_PAGE_SIZE:64,nombre:"catalogo",API:{_store:{aplicar(){}}},
  setTimeout:()=>17,clearTimeout:()=>{},log(){},Y:{encodeStateVector:()=>new Uint8Array([1])}
 };
 vm.createContext(ctx);vm.runInContext(src.slice(start,end),ctx);
 return {ctx,sent,ws};
}
async function head(a){
 const state={enCurso:false,fallos:0,usarHead:true};
 await a.ctx.pedirPagina(a.ws,state);
 await a.ctx.procesarHead(a.ws,state,{rev:3,seq:120});
 return state;
}
test("SYNC3 RED: identical HEAD and causal debt pull missing parents from last clean cut",async()=>{
 const a=harness();await head(a);
 assert.deepEqual(a.sent.map(x=>x.k),["head","pull"]);
 assert.deepEqual([a.sent[1].rev,a.sent[1].seq],[3,80]);
 assert.deepEqual([a.ctx._pullCursor.rev,a.ctx._pullCursor.seq],[3,120],"never rewind durable cursor");
});
test("SYNC3: identical HEAD and no causal debt downloads zero frames",async()=>{
 const a=harness({pending:false});await head(a);
 assert.deepEqual(a.sent.map(x=>x.k),["head"]);
});
test("SYNC3 RED: cold join without a local clean cut probes remote checkpoint inside replay budget",async()=>{
 const a=harness({clean:false,budget:1});await head(a);
 assert.deepEqual(a.sent.map(x=>x.k),["head","pull"],"must not deadlock a cold join with Yjs causal gaps");
 assert.deepEqual([a.sent[1].rev,a.sent[1].seq],[-1,0],"start bounded checkpoint-first replay, not a permanent cursor rollback");
 assert.deepEqual([a.ctx._pullCursor.rev,a.ctx._pullCursor.seq],[3,120],"never rewrite proven durable cursor");
});
test("SYNC3: no clean cut and no granted budget cannot flood history",async()=>{
 const a=harness({clean:false,budget:0});await head(a);
 assert.deepEqual(a.sent.map(x=>x.k),["head"]);
});
test("SYNC3: no retry budget cannot flood histories",async()=>{
 const a=harness({budget:0});await head(a);
 assert.deepEqual(a.sent.map(x=>x.k),["head"]);
});

test("SYNC3 RED: causal replay advances an ephemeral page cursor without committing a rollback",async()=>{
 const a=harness();const state=await head(a);
 const start=src.indexOf("      ws.onmessage = function (ev) {",src.indexOf("function crearCanal("));
 const end=src.indexOf("      _directReceive = function (buf) {",start);
 assert.ok(start>0&&end>start,"real pull-page handler exists");
 a.ctx.pullEstado=state;a.ctx._colaRecepcion=Promise.resolve();
 a.ctx.API.clave={};a.ctx.guardarPullCursor=async()=>{};
 vm.runInContext(src.slice(start,end),a.ctx);
 a.ws.onmessage({data:JSON.stringify({k:"pull-page",rev:3,seq:100,more:true})});
 await a.ctx._colaRecepcion;
 assert.deepEqual(a.sent.map(x=>x.k),["head","pull","pull"],"pagination follows the missing causal interval");
 assert.deepEqual([a.sent[2].rev,a.sent[2].seq],[3,100],"second page starts where first ended, never from durable 120");
 assert.equal(a.ctx._pullCursor.seq,120,"no durable cursor rollback during replay");
});

test("SYNC3 RED: a causal replay pauses after four pages and can resume at its next page",async()=>{
 const a=harness();const state=await head(a);
 const start=src.indexOf("      ws.onmessage = function (ev) {",src.indexOf("function crearCanal("));
 const end=src.indexOf("      _directReceive = function (buf) {",start);
 a.ctx.pullEstado=state;a.ctx._colaRecepcion=Promise.resolve();
 a.ctx.API.clave={};a.ctx.guardarPullCursor=async()=>{};
 vm.runInContext(src.slice(start,end),a.ctx);
 for(const seq of [90,100,110,115]){
   a.ws.onmessage({data:JSON.stringify({k:"pull-page",rev:3,seq,more:true,n:1})});
   await a.ctx._colaRecepcion;
 }
 assert.equal(a.sent.filter(x=>x.k==="pull").length,4,"only four encrypted pages within one recovery window");
 assert.equal(state.enCurso,false,"pause without disconnecting or declaring recovery");
 assert.deepEqual([state.rescateCausalDesde.rev,state.rescateCausalDesde.seq],[3,115],"remember the uncommitted recovery position");
 a.ctx._replayUsed=1; // the scheduler's next backoff tick authorizes a new bounded window
 await a.ctx.pedirPagina(a.ws,state);
 await a.ctx.procesarHead(a.ws,state,{rev:3,seq:120});
 assert.equal(a.sent.at(-1).k,"pull");
 assert.deepEqual([a.sent.at(-1).rev,a.sent.at(-1).seq],[3,115],"next scheduled window resumes without re-downloading the same pages");
 assert.equal(a.ctx._pullCursor.seq,120,"durable cursor remains at original proof");
});

test("SYNC3 RED: a newer relay HEAD abandons any stale causal backfill cursor",async()=>{
 const a=harness();const state=await head(a);
 assert.deepEqual([state.rescateCausalDesde.rev,state.rescateCausalDesde.seq],[3,80]);
 state.esperandoHead=true; // an independent new HEAD after the old causal window
 await a.ctx.procesarHead(a.ws,state,{rev:4,seq:1});
 const cmd=a.sent.at(-1);
 assert.equal(cmd.k,"pull");
 assert.deepEqual([cmd.rev,cmd.seq],[3,120],"new relay work must continue from confirmed durable cut");
 assert.equal(state.rescateCausalDesde,null,"obsolete causal cursor cannot drag a changed revision back");
});

test("SYNC3 RED: duplicate encrypted pages cannot renew the causal replay quota",async()=>{
 const a=harness();a.ctx._replayUsed=2;
 a.ctx._replayKey=a.ctx.clavePendientes();
 const state=await head(a);
 const start=src.indexOf("      ws.onmessage = function (ev) {",src.indexOf("function crearCanal("));
 const end=src.indexOf("      _directReceive = function (buf) {",start);
 a.ctx.pullEstado=state;a.ctx._colaRecepcion=Promise.resolve();
 a.ctx.API.clave={};a.ctx.guardarPullCursor=async()=>{};
 vm.runInContext(src.slice(start,end),a.ctx);
 for(const seq of [90,100,110,115]){
   // Four apparently nonempty pages, none changes Yjs, so no causal progress.
   a.ws.onmessage({data:JSON.stringify({k:"pull-page",rev:3,seq,more:true,n:1})});
   await a.ctx._colaRecepcion;
 }
 assert.equal(a.ctx._replayUsed,2,"duplicate pages must not refresh the existing budget");
 assert.equal(a.ctx._pullCursor.seq,120,"no durable rollback permitted");
});

test("SYNC3: useful Yjs vector progress may extend a paced causal recovery window",async()=>{
 const a=harness();a.ctx._replayUsed=2;
 a.ctx._replayKey=a.ctx.clavePendientes();
 let vector=1;a.ctx.Y.encodeStateVector=()=>new Uint8Array([vector]);
 const state=await head(a);
 const start=src.indexOf("      ws.onmessage = function (ev) {",src.indexOf("function crearCanal("));
 const end=src.indexOf("      _directReceive = function (buf) {",start);
 a.ctx.pullEstado=state;a.ctx._colaRecepcion=Promise.resolve();
 a.ctx.API.clave={};a.ctx.guardarPullCursor=async()=>{};
 vm.runInContext(src.slice(start,end),a.ctx);
 for(const seq of [90,100,110,115]){
   if(seq===110)vector=2; // applied state genuinely advances before final page
   a.ws.onmessage({data:JSON.stringify({k:"pull-page",rev:3,seq,more:true,n:1})});
   await a.ctx._colaRecepcion;
 }
 assert.equal(a.ctx._replayUsed,1,"actual Yjs vector progress may renew one paced retry");
 assert.equal(a.ctx._pullCursor.seq,120,"still no durable cursor rollback");
});

test("SYNC3 RED: finite forward causal scan cannot strand before its HEAD at five paced windows",async()=>{
 const a=harness(), state=await head(a);
 // Five backoffs were consumed with no Yjs vector change: the causal
 // parent can still be later in a finite, encrypted server prefix.
 a.ctx._replayUsed=5;
 a.ctx._replayKey=a.ctx.clavePendientes();
 const start=src.indexOf("      ws.onmessage = function (ev) {",src.indexOf("function crearCanal("));
 const end=src.indexOf("      _directReceive = function (buf) {",start);
 a.ctx.pullEstado=state;a.ctx._colaRecepcion=Promise.resolve();
 a.ctx.API.clave={};a.ctx.guardarPullCursor=async()=>{};
 vm.runInNewContext(src.slice(start,end),a.ctx);
 for(const seq of [90,100,110,115]){
   a.ws.onmessage({data:JSON.stringify({k:"pull-page",rev:3,seq,more:true,n:1})});
   await a.ctx._colaRecepcion;
 }
 assert.equal(a.sent.filter(x=>x.k==="pull").length,4,"four pages remains the per-window cap");
 assert.equal(a.ctx._pullCursor.seq,120,"never rewind durable cursor");
 assert.equal(a.ctx._replayUsed,5,"do not falsely invent Yjs vector progress");
 assert.equal(a.ctx._tReplay,17,"a bounded paced continuation is due while encrypted cursor climbs toward HEAD");
});

test("SYNC3 RED: Firebase staged timestamp sibling pages with same cursor do not stall",async()=>{
 const a=harness();a.ws.relayLayer="f123_relay_cupo_fb_v1";
 const state=await head(a);
 const start=src.indexOf("      ws.onmessage = function (ev) {",src.indexOf("function crearCanal("));
 const end=src.indexOf("      _directReceive = function (buf) {",start);
 a.ctx.pullEstado=state;a.ctx._colaRecepcion=Promise.resolve();
 a.ctx.API.clave={};a.ctx.guardarPullCursor=async()=>{};
 vm.runInContext(src.slice(start,end),a.ctx);
 // Firebase _tie holds up to 256 encrypted siblings; it MUST repeat seq 80
 // while its in-memory staged index advances. This is not a stale reply.
 a.ws.onmessage({data:JSON.stringify({k:"pull-page",rev:3,seq:80,more:true,n:12})});
 await a.ctx._colaRecepcion;
 assert.deepEqual(a.sent.map(x=>x.k),["head","pull","pull"],
   "a bounded staged page must request the next group slice without rewinding the durable cursor");
 assert.deepEqual([a.sent.at(-1).rev,a.sent.at(-1).seq],[3,80]);
 assert.equal(a.ctx._pullCursor.seq,120);
});
