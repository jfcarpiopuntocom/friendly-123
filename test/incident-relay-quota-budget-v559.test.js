"use strict";
const {test}=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");
const {createRelayTransport}=require("../supabase-relay/transport.mjs");
const {createRelayGateway}=require("../supabase-relay/gateway.mjs");

const ROOM="a".repeat(40),ORIGIN="wss://friendly123-sync-relay.jfcarpio.workers.dev/sala/";
const enc=new TextEncoder(),tick=()=>new Promise(resolve=>setImmediate(resolve));
function fakeClock(){let now=0,next=1;const jobs=new Map();return{
 setTimeout(fn,delay){const id=next++;jobs.set(id,{at:now+delay,fn});return id;},
 clearTimeout(id){jobs.delete(id);},async advance(ms){const end=now+ms;for(;;){let due=null;
  for(const [id,j] of jobs)if(j.at<=end&&(!due||j.at<due.job.at))due={id,job:j};
  if(!due)break;jobs.delete(due.id);now=due.job.at;due.job.fn();await tick();}now=end;await tick();},
 pending(){return jobs.size;}};}

function backend(){
 const rows=[],metrics={rpc:[],rpcResponseBytes:0,frameBytes:0};
 const client={async rpc(name,params){let data;
  if(name==="f123_relay_route")data={mode:"supabase"};
  else if(name==="f123_relay_has_topic")data=true;
  else if(name==="f123_relay_command"){
   const m=params.p_message;
   if(params.p_action==="op")rows.push({seq:rows.length+1,c:m.c});
   if(params.p_action==="pull"){
    const old=Number(m.seq)||0,page=rows.filter(r=>r.seq>old).slice(0,Number(m.limit)||250);
    data={frames:page.map(r=>r.c),rev:0,seq:rows.length,n:page.length,more:false};
    metrics.frameBytes+=page.reduce((n,r)=>n+Buffer.from(r.c,"base64").length,0);
   }else data={ok:true,conflict:false};
  }else throw Error("Unexpected RPC "+name);
  const requestBytes=enc.encode(JSON.stringify(params)).byteLength;
  const responseBytes=enc.encode(JSON.stringify({data,error:null})).byteLength;
  metrics.rpc.push({name,action:params.p_action||null,requestBytes,responseBytes,seq:params.p_message?.seq});
  metrics.rpcResponseBytes+=responseBytes;return{data,error:null};
 }};
 client.channel=topic=>({topic,on(){return this;},subscribe(fn){queueMicrotask(()=>fn("SUBSCRIBED"));return this;},
  async track(){return"ok";},presenceState(){return{};},async send(){return"ok";}});
 client.removeChannel=async()=>{};client.realtime={disconnect(){}};
 return{client,metrics,rows};
}
function device(db){const transport=createRelayTransport({client:db.client});const gateway=createRelayGateway({
 resolveRoute:room=>db.client.rpc("f123_relay_route",{p_room:room}).then(r=>r.data),native:room=>transport.connect(room)});return{transport,gateway};}
function opened(ws){return new Promise((resolve,reject)=>{ws.addEventListener("open",resolve,{once:true});ws.addEventListener("close",e=>reject(Error("closed "+e.code)),{once:true});});}
async function settle(){for(let i=0;i<30;i++)await tick();}

test("two idle devices stay quiet; one stored delta uses one write and one incremental pull",async()=>{
 const db=backend(),a=device(db),b=device(db),wa=a.gateway.connect(ORIGIN+ROOM),wb=b.gateway.connect(ORIGIN+ROOM);
 wa.binaryType=wb.binaryType="arraybuffer";
 await Promise.all([opened(wa),opened(wb)]);
 assert.equal(db.metrics.rpc.filter(x=>x.name==="f123_relay_route").length,2);
 assert.equal(db.metrics.rpc.filter(x=>x.name==="f123_relay_has_topic").length,2);
 const startupCalls=db.metrics.rpc.length,clock=fakeClock();await clock.advance(60000);
 assert.equal(db.metrics.rpc.length,startupCalls,"an idle connected channel adds no polling RPCs");
 const update=Buffer.alloc(96,7).toString("base64");
 wa.send(JSON.stringify({k:"op",ack:1,id:"synthetic-delta",lam:1,c:update}));await settle();
 const delivered=[];wb.addEventListener("message",e=>{if(e.data instanceof ArrayBuffer)delivered.push(Buffer.from(e.data));});
 wb.send(JSON.stringify({k:"pull",v:2,rev:0,seq:0,limit:250}));await settle();
 const commands=db.metrics.rpc.filter(x=>x.name==="f123_relay_command");
 assert.deepEqual(commands.map(x=>x.action),["op","pull"]);
 assert.equal(db.rows.length,1);assert.equal(db.metrics.frameBytes,96);
 assert.deepEqual(delivered.map(x=>[x.length,x[0]]),[[96,7]],"the new opaque delta reaches the peer once");
 assert.equal(db.metrics.rpcResponseBytes,db.metrics.rpc.reduce((n,x)=>n+x.responseBytes,0));
 wa.close();wb.close();await Promise.all([a.transport.dispose(),b.transport.dispose()]);
});

test("unresolved history stays incremental across same-lifetime reconnect; a fresh process replays its uncommitted page",async()=>{
 const db=backend(),d=device(db),writer=d.gateway.connect(ORIGIN+ROOM);await opened(writer);
 const body=Buffer.alloc(64*1024,11).toString("base64");
 writer.send(JSON.stringify({k:"op",ack:1,id:"synthetic-history",lam:1,c:body}));await settle();

 const source=fs.readFileSync(path.join(__dirname,"../docs/sync-yjs.js"),"utf8");
 const start=source.indexOf("      ws.onmessage = function (ev) {"),end=source.indexOf("      ws.onerror = function () {",start);
 const openStart=source.indexOf("        _colaRecepcion = _colaRecepcion.then(function () { return _pullCursorReady; }).then(function () {"),openEnd=source.indexOf("        /* Sincroniza el reloj",openStart);
 const replayStart=source.indexOf("    function programarRelectura(sock, estado) {"),replayEnd=source.indexOf("    // Only useful, applied bytes",replayStart);
 assert.ok(replayStart>=0&&replayEnd>replayStart,"uses actual E1b2 five-attempt retry");
 assert.ok(start>=0&&end>start,"uses the candidate's receive and replay handler");
 assert.ok(openStart>=0&&openEnd>openStart,"uses the candidate's actual onopen recovery queue");
 const clock=fakeClock(),ctx={
  API:{clave:{},_store:null},canal:{ws:null,recuperando:true},pullEstado:{enCurso:false,fallos:0},
  _colaRecepcion:Promise.resolve(),_pullCursor:{rev:0,seq:0},_appliedPullCursor:{rev:0,seq:0},_pullCursorReady:Promise.resolve(),
  _soloMemoria:false,_cursorContainsPending:false,_ultimoCursorLimpio:{rev:-1,seq:0},
  _replayDelay:30000,_tReplay:null,_replayKey:null,_replayUsed:0,partesEntrantes:{},_relayPeerCount:0,
  doc:{store:{pendingStructs:{missingParent:true}}},manejar:async()=>{ctx.partesEntrantes.fragment={received:1,total:2};return true;},confirmarDurable(){},
  guardarPullCursor:async c=>{ctx._pullCursor={rev:c.rev,seq:c.seq};if(!ctx.doc.store.pendingStructs&&!Object.keys(ctx.partesEntrantes).length)ctx._appliedPullCursor={rev:c.rev,seq:c.seq};},
  pedirPagina:(sock,state)=>{state.enCurso=true;sock.send(JSON.stringify({k:"pull",v:2,rev:ctx._pullCursor.rev,seq:ctx._pullCursor.seq,limit:250}));},
  nombre:"catalogo",window:{},log(){},clearTimeout:id=>clock.clearTimeout(id),_tEstable:null,
  _bufferPumpTimer:null,_durableWatchdog:null,_durableInFlight:Object.create(null),_currentPullState:null,
  _pausado:false,permitido:()=>true,
  deudaPendiente:()=>!!ctx.doc.store.pendingStructs || Object.keys(ctx.partesEntrantes).length>0,
  clavePendientes:()=>JSON.stringify([!!ctx.doc.store.pendingStructs,Object.keys(ctx.partesEntrantes).sort()]),
  setTimeout:(fn,delay)=>clock.setTimeout(fn,delay),reprogramar(){},
  Promise,JSON,Object,Number,Math,Date,ArrayBuffer,Blob};
 vm.createContext(ctx);
 vm.runInContext(source.slice(replayStart,replayEnd),ctx);
 function bindActor(actor){return{
  attach(ws,state){actor.ws=ws;actor.canal.ws=ws;actor.pullEstado=state;actor._currentPullState=state;
   vm.runInContext(source.slice(start,end)+"\nthis.queue=()=>_colaRecepcion;",actor);},
  async openAndDrain(ws,state){actor.ws=ws;actor.canal.ws=ws;actor.pullEstado=state;actor._currentPullState=state;
   vm.runInContext("this.onOpen=function(){var ws=this.ws;var pullEstado=this.pullEstado;"+source.slice(openStart,openEnd)+"};this.onOpen();",actor);
   await settle();await actor.queue();await settle();}
 };}
 const live=bindActor(ctx);

 let ws=d.gateway.connect(ORIGIN+ROOM);ws.binaryType="arraybuffer";await opened(ws);live.attach(ws,ctx.pullEstado);await live.openAndDrain(ws,ctx.pullEstado);
 assert.equal(db.metrics.frameBytes,64*1024,"first pull returns one 64 KiB synthetic page");
 assert.equal(ctx._appliedPullCursor.seq,0,"causal orphan keeps durable cursor at the proven cut");
 assert.equal(Object.keys(ctx.partesEntrantes).length,1,"an incomplete update assembly remains in this Y.Doc lifetime");
 assert.equal(clock.pending(),1);
 await clock.advance(30000);await settle();await ctx.queue();await settle();
 assert.equal(db.metrics.rpc.filter(x=>x.name==="f123_relay_command"&&x.action==="pull").length,2);
 assert.equal(db.metrics.frameBytes,64*1024,"same-connection retry uses RAM high-water and fetches no old page bytes");
 assert.deepEqual(db.metrics.rpc.filter(x=>x.name==="f123_relay_command"&&x.action==="pull").map(x=>x.seq),[0,1]);
 assert.equal(clock.pending(),1);

 ws.close();await settle();
 ws=d.gateway.connect(ORIGIN+ROOM);ws.binaryType="arraybuffer";await opened(ws);
 const reconnectState={enCurso:false,fallos:0};live.attach(ws,reconnectState);await live.openAndDrain(ws,reconnectState);
 assert.equal(ctx._pullCursor.seq,1);assert.equal(ctx._appliedPullCursor.seq,0);
 assert.equal(Object.keys(ctx.partesEntrantes).length,1,"reconnect keeps partial fragment assembly for the same live doc");
 assert.equal(db.metrics.frameBytes,64*1024,"same-lifetime onopen resumes from RAM high-water without downloading the old page");
 const pulls=db.metrics.rpc.filter(x=>x.name==="f123_relay_command"&&x.action==="pull");
 assert.equal(pulls.length,3);assert.deepEqual(pulls.map(x=>x.seq),[0,1,1]);

 // A new process has no RAM high-water or fragment assembly; run the actual
 // persisted-cursor loader, which can restore only the last proven cut (seq 0).
 const fresh={...ctx,API:{clave:{},_store:null},canal:{ws:null,recuperando:true},pullEstado:{enCurso:false,fallos:0},
  _colaRecepcion:Promise.resolve(),_pullCursor:{rev:-1,seq:0},_appliedPullCursor:{rev:-1,seq:0},_pullCursorKey:"fixture",
  _pullCursorReady:Promise.resolve(),_replayDelay:30000,_tReplay:null,_replayKey:null,_replayUsed:0,partesEntrantes:Object.create(null),
  doc:{store:{}},persistencia:{whenSynced:Promise.resolve(),get:async()=>({rev:0,seq:0}),
   db:{objectStoreNames:{contains:k=>k==="updates"},transaction(){const tx={};queueMicrotask(()=>tx.oncomplete?.());return tx;}}},_tEstable:null,_bufferPumpTimer:null,
  _durableWatchdog:null,_durableInFlight:Object.create(null)};
 fresh.guardarPullCursor=async c=>{fresh._pullCursor={rev:c.rev,seq:c.seq};if(!Object.keys(fresh.partesEntrantes).length&&!fresh.doc.store.pendingStructs)fresh._appliedPullCursor={rev:c.rev,seq:c.seq};};
 fresh.pedirPagina=(sock,state)=>{state.enCurso=true;sock.send(JSON.stringify({k:"pull",v:2,rev:fresh._pullCursor.rev,seq:fresh._pullCursor.seq,limit:250}));};
 fresh.manejar=async()=>true;
 fresh.deudaPendiente=()=>!!fresh.doc.store.pendingStructs||Object.keys(fresh.partesEntrantes).length>0;
 fresh.clavePendientes=()=>JSON.stringify([!!fresh.doc.store.pendingStructs,Object.keys(fresh.partesEntrantes).sort()]);
 vm.createContext(fresh);vm.runInContext(source.slice(replayStart,replayEnd),fresh);
 const initStart=source.indexOf("    if (persistencia && typeof persistencia.get === \"function\") {"),
  initEnd=source.indexOf("    function guardarPullCursor(cursor) {",initStart);
 assert.ok(initStart>=0&&initEnd>initStart);
 const cursorHelpersStart=source.indexOf("    function cursorValido(v) {");
 assert.ok(cursorHelpersStart>=0&&cursorHelpersStart<initStart,"use production cursor validation helpers");
 vm.runInContext(source.slice(cursorHelpersStart,initEnd),fresh);await fresh._pullCursorReady;
 assert.deepEqual({...fresh._pullCursor},{rev:0,seq:0});
 const newProcess=d.gateway.connect(ORIGIN+ROOM);newProcess.binaryType="arraybuffer";await opened(newProcess);
 const freshState={enCurso:false,fallos:0},freshActor=bindActor(fresh);freshActor.attach(newProcess,freshState);
 await freshActor.openAndDrain(newProcess,freshState);
 assert.equal(db.metrics.frameBytes,2*64*1024,"fresh process replays from durable seq 0 to recover the uncommitted page");
 const allPulls=db.metrics.rpc.filter(x=>x.name==="f123_relay_command"&&x.action==="pull");
 assert.deepEqual(allPulls.map(x=>x.seq),[0,1,1,0]);
 assert.ok(db.metrics.rpcResponseBytes>2*64*1024,"base64 JSON response bytes also exceed raw frame bytes");
 newProcess.close();ws.close();writer.close();await d.transport.dispose();
});
