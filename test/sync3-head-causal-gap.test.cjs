"use strict";
const {test}=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),vm=require("node:vm"),path=require("node:path");
const src=fs.readFileSync(path.join(__dirname,"../docs/sync-yjs.js"),"utf8");
function harness({pending=true,clean=true,budget=1}={}){
 const start=src.indexOf("    function clavePendientes() {",src.indexOf("function crearCanal("));
 const end=src.indexOf("    function reprogramar() {",start);
 assert.ok(start>0&&end>start,"real HEAD and pull path present");
 const sent=[],ws={readyState:1,send:msg=>sent.push(JSON.parse(msg))};
 const ctx={Promise,Number,Math,JSON,Object,Map,Array,Uint8Array,
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
test("SYNC3: no verified clean cut cannot flood full history",async()=>{
 const a=harness({clean:false});await head(a);
 assert.deepEqual(a.sent.map(x=>x.k),["head"]);
});
test("SYNC3: no retry budget cannot flood histories",async()=>{
 const a=harness({budget:0});await head(a);
 assert.deepEqual(a.sent.map(x=>x.k),["head"]);
});
