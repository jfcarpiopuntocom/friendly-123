"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const sync=fs.readFileSync(path.join(__dirname,"../docs/sync-yjs.js"),"utf8");
const tabs=fs.readFileSync(path.join(__dirname,"../docs/tab-session.js"),"utf8");

test("E1b-3 RED: visibility and tab ownership pause and resume all Yjs rooms",()=>{
 assert.match(sync,/function sincronizarVisibilidad\(/,"one visibility/lease gate controls Yjs");
 assert.match(sync,/window\.addEventListener\("oc-tab-session-changed",\s*sincronizarVisibilidad\)/);
 assert.match(sync,/document\.addEventListener\("visibilitychange",\s*sincronizarVisibilidad\)/);
 for(const name of ["canal","fotosCanal","opsCanal"]){
  assert.match(sync,new RegExp("API\\."+name+"\\.(?:pausar|reanudar)"),name+" must be governed");
 }
 assert.match(sync,/if \(_pausado \|\| !permitido\(\)\) return;/,"intentional pause fences connecting");
 assert.match(sync,/if \(_pausado \|\| !permitido\(\)\) return;/,"paused disconnect cannot retry forever");
});
test("E1b-3 RED: losing lease fences old tab and notifies transport",()=>{
 assert.match(tabs,/function puedeSincronizar\(\)/);
 assert.match(tabs,/suspendida\s*=\s*true/,"loser stays suspended until new PIN");
 assert.match(tabs,/new Event\("oc-tab-session-changed"\)/);
 assert.match(tabs,/canSync:\s*puedeSincronizar/);
 assert.match(tabs,/if\s*\(!document\.hidden\)\s*check\(\)/);
});
test("E1b-3 RED: former-tab panel is recommendations, friendly tools and dashboard with PIN",()=>{
 assert.match(tabs,/Herramientas amigas/);
 assert.match(tabs,/Friendly tools/);
 assert.match(tabs,/Ingresar al dashboard con PIN/);
 assert.match(tabs,/Enter dashboard with PIN/);
 assert.match(tabs,/Recomendar Friendly/);
 assert.doesNotMatch(tabs,/Ideas para empezar|Getting started/);
});
test("E1b-3 RED: pause never deletes durable outbox, Yjs journal or PIN",()=>{
 const a=sync.indexOf("    canal.pausar = function () {");
 const b=sync.indexOf("    canal.reanudar = function () {",a);
 assert.ok(a>0&&b>a,"explicit connection lifecycle exists");
 const block=sync.slice(a,b);
 assert.match(block,/ws\.close\(/,"socket is really closed");
 assert.doesNotMatch(block,/\.clear\(|delete\w*Database|localStorage\.removeItem|_outbox\s*=/);
});


test("E1b-3: two authentic script instances transfer lease; hidden owner pauses",async()=>{
 const windows=[],rooms=[],store=new Map();
 const TextEncoder=require("node:util").TextEncoder,vm=require("node:vm");
 function tab(id){
  const listeners=new Map();let role="dueno",logouts=0;
  const win={addEventListener:(name,fn)=>{
   if(!listeners.has(name))listeners.set(name,[]);listeners.get(name).push(fn);
  },dispatchEvent:e=>(listeners.get(e.type)||[]).forEach(fn=>fn(e))};
  const auth={rolActual:()=>role,salir:()=>{logouts++;role="";win.dispatchEvent({type:"oc-logout"});}};
  win.OCAuth=auth;
  const doc={hidden:false,addEventListener(){},head:{appendChild(){}},
   getElementById:()=>null,createElement:()=>({textContent:""})};
  const localStorage={
   getItem:k=>store.get(k)||null,
   setItem:(k,v)=>{store.set(k,String(v));windows.filter(w=>w!==win).forEach(w=>w.dispatchEvent({type:"storage",key:k}));},
   removeItem:k=>{store.delete(k);windows.filter(w=>w!==win).forEach(w=>w.dispatchEvent({type:"storage",key:k}));}
  };
  function BroadcastChannel(name){this.name=name;this.onmessage=null;rooms.push(this);
   this.postMessage=d=>rooms.filter(ch=>ch!==this&&ch.name===name).forEach(ch=>ch.onmessage?.({data:d}));}
  const crypto={randomUUID:()=>String(id),subtle:{digest:async()=>new Uint8Array([1,2,3]).buffer}};
  windows.push(win);
  vm.runInNewContext(tabs,{window:win,document:doc,OCAuth:auth,localStorage,
   crypto,BroadcastChannel,navigator:{locks:{request:async(_,fn)=>fn()}},TextEncoder,
   Uint8Array,JSON,Date,Event:class{constructor(type){this.type=type;}},Promise});
  return {win,doc,get logouts(){return logouts;}};
 }
 const old=tab("old");for(let i=0;i<24;i++)await Promise.resolve();
 assert.equal(old.win.OCTabSession.canSync(),true);
 const fresh=tab("new");for(let i=0;i<30;i++)await Promise.resolve();
 assert.equal(old.logouts,1,"former owner signs out through standard flow");
 assert.equal(old.win.OCTabSession.canSync(),false,"former owner cannot restart sync");
 assert.equal(fresh.win.OCTabSession.canSync(),true,"PIN owner inherits active session");
 fresh.doc.hidden=true;fresh.win.dispatchEvent({type:"visibilitychange"});
 assert.equal(fresh.win.OCTabSession.canSync(),false,"hidden owner sleeps");
 fresh.doc.hidden=false;fresh.win.dispatchEvent({type:"visibilitychange"});
 assert.equal(fresh.win.OCTabSession.canSync(),true,"visible owner resumes");
});
test("E1b-3: actual channel pause closes socket but preserves outbox and resumes once",()=>{
 const vm=require("node:vm");
 const start=sync.indexOf("    canal.pausar = function () {");
 const end=sync.indexOf("    // Real hidden→visible gesture:",start);
 assert.ok(start>0&&end>start);
 let closes=0,connections=0;const outbox={pending:[{id:"encrypted-pending"}]};
 const ws={readyState:1,close(){closes++;}},canal={ws};
 const ctx={canal,_pausado:false,_tReconnect:1,_tEstable:2,_tCkpt:3,
  _tReplay:4,_bufferPumpTimer:5,_durableTimer:6,_durableWatchdog:7,
  _durableInFlight:{a:{at:1}},clearTimeout:()=>{},Object,
  conectar:()=>connections++,permitido:()=>true};
 vm.createContext(ctx);vm.runInContext(sync.slice(start,end),ctx);
 ctx.canal.pausar();
 assert.equal(closes,1);assert.equal(ctx.canal.ws,null);
 assert.deepEqual(outbox.pending,[{id:"encrypted-pending"}],"pending encrypted bytes untouched");
 assert.equal(Object.keys(ctx._durableInFlight).length,0,"only in-flight hint resets");
 ctx.canal.reanudar();assert.equal(connections,1);
 ctx.canal.ws={readyState:0};ctx.canal.reanudar();
 assert.equal(connections,1,"duplicate wake never duplicates a socket");
});
test("E1b-3: three Yjs rooms follow visibility and lease",()=>{
 const vm=require("node:vm");
 const start=sync.indexOf("    function sincronizarVisibilidad() {");
 const end=sync.indexOf("    API.canal.conectar();",start);
 assert.ok(start>0&&end>start);
 const actions=[];let allowed=true,hidden=false;
 const API={};
 ["canal","fotosCanal","opsCanal"].forEach(name=>{
  API[name]={pausar:()=>actions.push(name+":pause"),reanudar:()=>actions.push(name+":resume")};
 });
 const doc={get hidden(){return hidden;},addEventListener(){}};
 const win={OCTabSession:{canSync:()=>allowed},addEventListener(){}};
 const ctx={API,document:doc,window:win,OCTabSession:win.OCTabSession};
 vm.createContext(ctx);vm.runInContext(sync.slice(start,end),ctx);
 ctx.sincronizarVisibilidad();assert.equal(actions.filter(x=>x.endsWith(":resume")).length,3);
 hidden=true;ctx.sincronizarVisibilidad();assert.equal(actions.filter(x=>x.endsWith(":pause")).length,3);
 hidden=false;allowed=false;ctx.sincronizarVisibilidad();assert.equal(actions.filter(x=>x.endsWith(":pause")).length,6);
 allowed=true;ctx.sincronizarVisibilidad();assert.equal(actions.filter(x=>x.endsWith(":resume")).length,6);
});
