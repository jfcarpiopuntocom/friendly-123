"use strict";
const {test}=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const vm=require("node:vm");
const path=require("node:path");
const src=fs.readFileSync(path.join(__dirname,"../docs/sync-yjs.js"),"utf8");
function fixture(badFrames=0,failCursor=false) {
 const ini=src.indexOf("      ws.onmessage = function (ev) {");
 const fin=src.indexOf("      ws.onclose = function () {",ini);
 assert.ok(ini>0&&fin>ini);
 let applied=0,cursorWrites=0,logged=0;
 const ws={readyState:1,closed:[],close:function(code,reason){this.closed.push([code,reason]);this.readyState=3;}};
 const pullEstado={enCurso:true,fallos:0};
 const ctx={
  ws,API:{clave:{},_store:{aplicar(){}}},canal:{ws,recuperando:true},
  pullEstado,_colaRecepcion:Promise.resolve(),_directReceive:null,
  manejar:async()=>{applied++;if(applied<=badFrames)throw Error("synthetic invalid encrypted frame");return true;},
  guardarPullCursor:async()=>{cursorWrites++;if(failCursor)throw Error("synthetic persistence fail");},
  pedirPagina:async()=>{},confirmarDurable:()=>{},_relayPeerCount:0,
  partesEntrantes:{},doc:{store:{}},_tReplay:null,_replayDelay:30000,_tAplica:null,
  _currentPullState:pullEstado,window:{},log:()=>logged++,nombre:"catalogo",
  Blob:class{},ArrayBuffer,Promise,JSON,Date,Math,Object,Number,clearTimeout:()=>{},setTimeout:()=>0,
  _durableQueue:Promise.resolve()
 };
 vm.createContext(ctx);
 vm.runInContext(src.slice(ini,fin)+"\nthis.checkQueue=()=>_colaRecepcion;",ctx);
 return {ctx,ws,pullEstado,counts:()=>({applied,cursorWrites,logged})};
}
test("P0 corrupt frame must NOT poison receive queue; later valid encrypted frames still process",async()=>{
 const x=fixture(1);
 x.ws.onmessage({data:new ArrayBuffer(1),relaySource:"pull"});
 x.ws.onmessage({data:new ArrayBuffer(1),relaySource:"pull"});
 await x.ctx.checkQueue();
 assert.equal(x.counts().applied,2,"second frame must be decoded after one exception");
 assert.equal(x.pullEstado.fallos,1,"first unreadable page must be counted");
 x.ws.onmessage({data:JSON.stringify({k:"pull-page",rev:1,seq:2,more:false})});
 await x.ctx.checkQueue();
 assert.equal(x.counts().cursorWrites,0,"failed page must not advance durable cursor");
 assert.equal(x.ws.closed[0][0],1013,"must reconnect and replay from applied cursor");
});
test("P0 fully valid pages ACK their cursor and apply data without waiting forever",async()=>{
 const x=fixture(0);
 x.ws.onmessage({data:new ArrayBuffer(1),relaySource:"pull"});
 await x.ctx.checkQueue();
 x.ws.onmessage({data:JSON.stringify({k:"pull-page",rev:1,seq:1,more:false})});
 await x.ctx.checkQueue();
 assert.equal(x.counts().applied,1);
 assert.equal(x.counts().cursorWrites,1);
 assert.equal(x.pullEstado.fallos,0);
 assert.equal(x.ws.closed.length,0);
 assert.equal(x.ctx.canal.recuperando,false);
});
test("P0 cursor persistence exception must not poison later incoming frames",async()=>{
 const x=fixture(0,true);
 x.ws.onmessage({data:new ArrayBuffer(1),relaySource:"pull"});
 x.ws.onmessage({data:JSON.stringify({k:"pull-page",rev:1,seq:1,more:false})});
 await x.ctx.checkQueue();
 assert.equal(x.ws.closed.length,1);
 x.ws.onmessage({data:new ArrayBuffer(1),relaySource:"live"});
 await x.ctx.checkQueue();
 assert.equal(x.counts().applied,2,"queue remains drainable after cursor failure");
});
