"use strict";
const {test}=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const vm=require("node:vm");
const path=require("node:path");

// Source-level boundary test: extracts the REAL cursor loader/save functions.
// No network, browser client license, or customer's Yjs database is accessed.
const src=fs.readFileSync(path.join(__dirname,"../docs/sync-yjs.js"),"utf8");
const begin=src.indexOf("    var _cursorContainsPending = false",src.indexOf("function crearCanal("));
const end=src.indexOf("    function reprogramar() {",begin);
assert.ok(begin>0&&end>begin,"cursor boundary exists in the published implementation");
const actual=src.slice(begin,end);

function fixture({pending=true,fragments=false,failBarrier=false,failWrite=false,prior=null,tamperReadback=false,syncedHeld=false,failRestore=false,dbOpenFails=false}={}){
 const values=new Map();
 if(prior)values.set("cursor",prior);
 let resumeHydration, watchdog, headTimeout;
 const events=[],ctx={
   Y:{
     encodeStateVector:()=>new Uint8Array([0]),
     encodeStateAsUpdate:(doc)=>new Uint8Array(doc.store.pendingStructs?[61,62,63]:[0]),
     applyUpdate:(doc,bytes,origin)=>{events.push("restore:"+origin);if(failRestore)throw Error("synthetic Yjs update rejected");doc.store.pendingStructs={bytes:[...bytes]};}
   },
   doc:{store:pending?{pendingStructs:{missingParent:true}}:{}},
   partesEntrantes:fragments?{"chunk":{received:1,total:2}}:{},
   _tReplay:null,_replayKey:null,_replayUsed:0,
   canal:{ws:null},PULL_PAGE_SIZE:64,
   _pullCursorKey:"cursor",_pullCursor:{rev:-1,seq:0},_appliedPullCursor:{rev:-1,seq:0},_pullCursorReady:Promise.resolve(),
   persistencia:{
     db:{objectStoreNames:{contains:name=>name==="updates"},transaction(){
       events.push("barrier-start");
       const tx={oncomplete:null,onerror:null,onabort:null};
       setImmediate(()=>{if(failBarrier){events.push("barrier-failed");tx.onabort?.()}else{events.push("barrier-ok");tx.oncomplete?.()}});
       return tx;
     }},
     whenSynced:syncedHeld?new Promise(resolve=>{resumeHydration=resolve;}):Promise.resolve(),
     get:async key=>{events.push("get");const v=values.get(key);if(tamperReadback&&v?.pendingSnapshot&&events.includes("set")) return {...v,pendingSnapshot:new Uint8Array(v.pendingSnapshot).fill(19)};return v;},
     set:async(key,value)=>{events.push("set");if(failWrite)throw Error("synthetic quota");values.set(key,value);}
   },
   Promise,Uint8Array,ArrayBuffer,Number,Math,Object,Date,JSON,console,
   setTimeout(fn,ms){if(ms===25000){watchdog=fn;return 999;}if(ms===1800){headTimeout=fn;return 1800;}return setImmediate(fn);},
   clearTimeout(id){if(id===999)watchdog=null;}, 
 };
 if(dbOpenFails){
   ctx.persistencia.db=null;
   ctx.persistencia._db=Promise.reject(Error("synthetic IndexedDB.open failure"));
   ctx.persistencia.whenSynced=new Promise(()=>{});
 }
 vm.createContext(ctx);
 vm.runInContext(actual,ctx);
 return {ctx,events,values,async ready(){await ctx._pullCursorReady;},save:c=>ctx.guardarPullCursor(c),releaseHydration:()=>resumeHydration?.(),fireWatchdog:()=>watchdog?.(),fireHeadTimeout:()=>headTimeout?.()};
}
test("fragmented ciphertext cannot approve a cursor, even with Yjs pending snapshot",async()=>{
 const a=fixture({fragments:true});await a.ready();await a.save({rev:0,seq:4,more:false});
 assert.equal(a.ctx._pullCursor.seq,4,"RAM can page forward");
 assert.equal(a.ctx._appliedPullCursor.rev,-1,"first verified cut stays unchanged");
 assert.equal(a.values.size,0,"no durable skip past unassembled frame");
});
test("pending Yjs snapshot plus cursor commit only after Yjs IDB journal barrier",async()=>{
 const a=fixture();await a.ready();
 await a.save({rev:0,seq:50,more:false});
 const stored=a.values.get("cursor");
 assert.ok(stored&&stored.pendingSnapshot,"Yjs pending bytes must accompany the durable cursor");
 assert.equal(stored.seq,50);
 assert.equal(a.ctx._appliedPullCursor.seq,50);
 const i=a.events.indexOf("barrier-ok"),j=a.events.indexOf("set"),k=a.events.lastIndexOf("get");
 assert.ok(i>=0&&i<j&&j<k,"journal barrier, atomic envelope, readback order");
 const reboot=fixture({pending:false,prior:stored});await reboot.ready();
 assert.equal(reboot.ctx._pullCursor.seq,50,"restarted actor uses the proven cut");
 assert.ok(reboot.ctx.doc.store.pendingStructs,"pending bytes reloaded before pull");
 assert.ok(reboot.events.includes("restore:red"),"restoration must not rebroadcast the update");
});
test("IDB barrier failure cannot advance durable cursor",async()=>{
 const a=fixture({failBarrier:true});await a.ready();await a.save({rev:0,seq:50,more:false});
 assert.equal(a.values.size,0);assert.equal(a.ctx._appliedPullCursor.rev,-1);
});
test("IDB custom-write failure cannot advance durable cursor",async()=>{
 const a=fixture({failWrite:true});await a.ready();await a.save({rev:0,seq:50,more:false});
 assert.equal(a.values.size,0);assert.equal(a.ctx._appliedPullCursor.rev,-1);
});
test("fully recovered Y.Doc can retire its pending proof after journal barrier",async()=>{
 const a=fixture();await a.ready();await a.save({rev:0,seq:50,more:false});
 a.ctx.doc.store.pendingStructs=null;
 await a.save({rev:0,seq:51,more:false});
 assert.equal(a.values.get("cursor").pendingSnapshot,undefined);
 assert.equal(a.ctx._appliedPullCursor.seq,51);
});
test("legacy cursor with no snapshot remains readable",async()=>{
 const a=fixture({pending:false,prior:{rev:3,seq:77}});await a.ready();
 assert.equal(a.ctx._pullCursor.seq,77);assert.equal(a.ctx._appliedPullCursor.seq,77);
});

test("vendored Yjs preserves causal orphan and deleted-set with delta-only pending proof",()=>{
 const Yvm={console,crypto:require("node:crypto").webcrypto,TextEncoder,TextDecoder,Uint8Array,ArrayBuffer,Map,Set,Promise,setTimeout,clearTimeout};
 Yvm.globalThis=Yvm;
 vm.createContext(Yvm);
 vm.runInContext(fs.readFileSync(path.join(__dirname,"../docs/vendor/yjs-bundle.min.js"),"utf8"),Yvm);
 const Y=Yvm.Y;
 assert.ok(Y && Y.Doc && Y.encodeStateAsUpdate,"real vendored Yjs APIs are present");
 const original=new Y.Doc({gc:false}),updates=[];
 original.on("update",u=>updates.push(u));
 const text=original.getText("synthetic");
 text.insert(0,"A"); text.insert(1,"B"); text.delete(0,1);
 assert.equal(updates.length,3,"three causal Yjs transactions were encoded");
 const missingParent=new Y.Doc({gc:false});
 Y.applyUpdate(missingParent,updates[1]); Y.applyUpdate(missingParent,updates[2]);
 assert.ok(missingParent.store.pendingStructs,"a missing parent leaves pending structures");
 assert.ok(missingParent.store.pendingDs,"deletion still requires its parent");
 const delta=Y.encodeStateAsUpdate(missingParent,Y.encodeStateVector(missingParent));
 assert.ok(delta.length>0,"diff contains the unresolved causal bytes");
 let reboot=new Y.Doc({gc:false});
 Y.applyUpdate(reboot,delta);
 assert.ok(reboot.store.pendingStructs,"orphan survives first restart");
 assert.ok(reboot.store.pendingDs,"deleted-set survives first restart");
 const second=Y.encodeStateAsUpdate(reboot,Y.encodeStateVector(reboot));
 reboot=new Y.Doc({gc:false});
 Y.applyUpdate(reboot,second);
 assert.ok(reboot.store.pendingStructs,"orphan survives second restart");
 Y.applyUpdate(reboot,updates[0]);
 assert.equal(reboot.getText("synthetic").toString(),original.getText("synthetic").toString());
 assert.deepEqual(Buffer.from(Y.encodeStateVector(reboot)),Buffer.from(Y.encodeStateVector(original)));
 assert.deepEqual(Buffer.from(Y.encodeStateAsUpdate(reboot)),Buffer.from(Y.encodeStateAsUpdate(original)));
});

test("50 pages then three restarts never re-download already proven pages",async()=>{
 let stored=null,prev=0,totalProofWrites=0;
 for(let restart=0;restart<3;restart++){
   const f=fixture({pending:restart===0,prior:stored});
   await f.ready();
   assert.equal(f.ctx._pullCursor.seq,prev,"restart begins at the verified cursor, not the first row");
   for(let n=1;n<=50;n++) await f.save({rev:0,seq:prev+n,more:n!==50});
   stored=f.values.get("cursor");
   assert.equal(stored.seq,prev+50,"the final page seals the durable pending proof");
   const writes=f.events.filter(e=>e==="set").length;
   assert.ok(writes<=4,"snapshot cost bounded to 16-page batches, not per page");
   totalProofWrites+=writes;
   prev+=50;
 }
 assert.ok(totalProofWrites<=12);
});
test("tampered same-length IDB readback must not confirm a potentially different pending snapshot",async()=>{
 const f=fixture({tamperReadback:true});await f.ready();
 await f.save({rev:0,seq:50,more:false});
 assert.equal(f.ctx._appliedPullCursor.rev,-1,"byte identity must be verified, not only length");
});
test("an invalid persisted pending proof falls back to full replay instead of skipping history",async()=>{
 const f=fixture({pending:false,prior:{rev:1,seq:900,pendingSnapshot:[]}});
 await f.ready();
 assert.equal(f.ctx._appliedPullCursor.rev,-1);
 assert.equal(f.ctx._pullCursor.seq,0);
});

test("corrupted pending proof falls back to a proven clean 8200 instead of zero",async()=>{
 const f=fixture({pending:false,prior:{rev:0,seq:8700,pendingSnapshot:[],cursorLimpio:{rev:0,seq:8200}}});
 await f.ready();
 assert.equal(f.ctx._pullCursor.seq,8200);
 assert.equal(f.ctx._appliedPullCursor.seq,8200);
});
test("oversized pending proof falls back to last clean cut",async()=>{
 const f=fixture({pending:false,prior:{rev:0,seq:8700,pendingSnapshot:new Uint8Array(2*1024*1024+1),cursorLimpio:{rev:0,seq:8200}}});
 await f.ready();
 assert.equal(f.ctx._pullCursor.seq,8200);
});
test("a rejected Yjs proof falls back to the previous clean cut",async()=>{
 const f=fixture({pending:false,failRestore:true,prior:{rev:0,seq:8700,pendingSnapshot:new Uint8Array([61,62]),cursorLimpio:{rev:0,seq:8200}}});
 await f.ready();
 assert.equal(f.ctx._pullCursor.seq,8200);
 assert.equal(f.ctx._appliedPullCursor.seq,8200);
});
test("slow IndexedDB hydration blocks cursor restore instead of triggering replay",async()=>{
 const f=fixture({pending:false,syncedHeld:true,prior:{rev:0,seq:8700,pendingSnapshot:new Uint8Array([61,62]),cursorLimpio:{rev:0,seq:8200}}});
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(f.ctx._pullCursor.rev,-1);
 assert.equal(f.events.includes("get"),false,"cannot trust custom cursor before Yjs journal is loaded");
 f.releaseHydration();
 await f.ready();
 assert.equal(f.ctx._pullCursor.seq,8700,"hydrate and resume at pending proven cursor");
});
test("unresolved recovery carries last clean cut through later pending proofs",async()=>{
 const f=fixture({pending:false,prior:{rev:0,seq:8200}});
 await f.ready();
 f.ctx.doc.store.pendingStructs={missingParent:true};
 await f.save({rev:0,seq:8216,more:false});
 assert.deepEqual({...f.values.get("cursor").cursorLimpio},{rev:0,seq:8200});
 await f.save({rev:0,seq:8232,more:false});
 assert.deepEqual({...f.values.get("cursor").cursorLimpio},{rev:0,seq:8200});
 assert.equal(f.values.get("cursor").seq,8232);
});
test("clean recovery after pending proof advances the clean fallback cut",async()=>{
 const f=fixture({pending:false,prior:{rev:0,seq:8200}});
 await f.ready();
 f.ctx.doc.store.pendingStructs={missingParent:true};
 await f.save({rev:0,seq:8216,more:false});
 f.ctx.doc.store.pendingStructs=null;
 await f.save({rev:0,seq:8232,more:false});
 assert.deepEqual({...f.values.get("cursor").cursorLimpio},{rev:0,seq:8232});
 assert.equal(f.values.get("cursor").pendingSnapshot,undefined);
});
test("an impossible future clean cut is ignored on reload",async()=>{
 const f=fixture({pending:false,prior:{rev:0,seq:8700,pendingSnapshot:[],cursorLimpio:{rev:0,seq:9100}}});
 await f.ready();
 assert.equal(f.ctx._pullCursor.rev,-1,"never invent a clean history checkpoint");
});

test("actual onopen hello and pull both wait for completed journal hydration",async()=>{
 const first=src.indexOf("        _colaRecepcion = _colaRecepcion.then(function () { return _pullCursorReady; }).then(function () {",src.indexOf("ws.onopen = function ()"));
 const end=src.indexOf("        /* Sincroniza el reloj",first);
 assert.ok(first>0&&end>first,"the real open-time recovery path was found");
 const events=[];let release;
 const ws={readyState:1};
 const ctx={
  ws,canal:{ws},_colaRecepcion:Promise.resolve(),
  _pullCursorReady:new Promise(resolve=>{release=resolve;}),
  Y:{encodeStateVector:()=>new Uint8Array([8])},doc:{},
  enviar:(tag)=>events.push("hello:"+tag),pedirPagina:async()=>events.push("pull"),
  pullEstado:{},Promise
 };
 vm.createContext(ctx);
 vm.runInContext(src.slice(first,end),ctx);
 await new Promise(resolve=>setImmediate(resolve));
 assert.deepEqual(events,[],"a partially hydrated device must not advertise an empty state vector");
 release();await ctx._colaRecepcion;
 assert.deepEqual(events,["hello:1","pull"],"hello is sent only after hydration and before pull");
});
test("the real reconnect photo seeding callback waits for Yjs hydration",async()=>{
 const first=src.indexOf("        if (seedFn) setTimeout(function () {",src.indexOf("ws.onopen = function ()"));
 const end=src.indexOf("\n      };",first);
 assert.ok(first>0&&end>first,"the real photo-seed callback was found");
 let release,timer;const events=[];
 const ws={readyState:1};
 const ctx={ws,canal:{ws},_soloMemoria:false,seedFn:()=>events.push("seed"),
  _pullCursorReady:new Promise(resolve=>{release=resolve;}),
  setTimeout:(fn)=>{timer=fn;},Promise};
 vm.createContext(ctx);vm.runInContext(src.slice(first,end),ctx);
 assert.equal(typeof timer,"function");
 timer();await new Promise(resolve=>setImmediate(resolve));
 assert.deepEqual(events,[],"no photo seeding before local journal finishes loading");
 release();await new Promise(resolve=>setImmediate(resolve));
 assert.deepEqual(events,["seed"]);
});

for(const tag of [1,2]){
 test("a remote Yjs state-vector request ("+tag+") waits for local journal hydration",async()=>{
  const first=src.indexOf("      function manejar(buf, source) {");
  const end=src.indexOf("      ws.onmessage = function (ev) {",first);
  assert.ok(first>0&&end>first,"actual Yjs message handling code is available");
  let release;const seen=[];
  const ctx={
   API:{clave:{}},doc:{},Y:{encodeStateVector:()=>new Uint8Array([2]),
    encodeStateAsUpdate:()=>new Uint8Array([0])},
   _pullCursorReady:new Promise(resolve=>{release=resolve;}),
   descifrarBin:async()=>new Uint8Array([tag,5]),
   enviar:(type)=>seen.push(type),Promise,Uint8Array,TextDecoder,
   partesEntrantes:{},partesEnVivo:{}
  };
  vm.createContext(ctx);vm.runInContext(src.slice(first,end),ctx);
  const handling=ctx.manejar(new ArrayBuffer(1),"live");
  await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(seen,[],"never respond with partial state while IDB remains loading");
  release();assert.equal(await handling,true);
  assert.deepEqual(seen,tag===1?[0,2]:[0]);
 });
}
test("a bad encrypted update is rejected, not presented as an applied Yjs frame",async()=>{
 const first=src.indexOf("      function manejar(buf, source) {");
 const end=src.indexOf("      ws.onmessage = function (ev) {",first);
 assert.ok(first>0&&end>first);
 const ctx={API:{clave:{}},descifrarBin:async()=>{throw Error("synthetic bad AES-GCM");},Promise};
 vm.createContext(ctx);vm.runInContext(src.slice(first,end),ctx);
 assert.equal(await ctx.manejar(new ArrayBuffer(1),"history"),false);
});

test("E1 acceptance: actual pager sends only 50 NEW page requests across each of three restarts",async()=>{
 // Synthetic server adds exactly 50 encrypted history pages between restarts.
 // The unresolved Yjs parent survives in the signed cursor proof, but no prior
 // page should be pulled again after reboot. No network or Supabase data used.
 let stored=null,priorSeq=0;
 for(let reboot=0;reboot<3;reboot++){
  const f=fixture({pending:reboot===0,prior:stored});
  await f.ready();
  assert.equal(f.ctx._pullCursor.seq,priorSeq);
  assert.ok(f.ctx.doc.store.pendingStructs,"causal parent stays unresolved");
  const sent=[],sock={readyState:1,send(json){sent.push(JSON.parse(json));}};
  f.ctx.canal.ws=sock;
  for(let page=1;page<=50;page++){
   await f.ctx.pedirPagina(sock,{enCurso:false,fallos:0});
   assert.equal(sent.at(-1).seq,priorSeq+page-1,
     "pager sends an incremental cursor, not the beginning of old history");
   await f.save({rev:0,seq:priorSeq+page,more:page!==50});
  }
  assert.equal(sent.length,50,"E1 budget: at most one pull for each NEW page");
  assert.ok(sent.every((c,i)=>c.k==="pull"&&c.seq===priorSeq+i));
  stored=f.values.get("cursor");
  assert.equal(stored.seq,priorSeq+50);
  priorSeq+=50;
 }
 assert.equal(priorSeq,150);
});

test("E1 RED: hung IDB must report pending without pull; later hydration resumes",async()=>{
 const f=fixture({pending:false,syncedHeld:true,prior:{rev:0,seq:8300}});
 const sent=[],sock={readyState:1,send:json=>sent.push(JSON.parse(json))};
 f.ctx.canal.ws=sock;
 const pull=f.ctx.pedirPagina(sock,{enCurso:false,fallos:0});
 await new Promise(resolve=>setImmediate(resolve));
 f.fireWatchdog();
 assert.equal(f.ctx.canal.recuperacionLocal,"pendiente","must not silently hang");
 assert.equal(sent.length,0,"do not pull while local journal is unavailable");
 f.releaseHydration();await f.ready();await pull;
 assert.equal(f.ctx.canal.recuperacionLocal,"listo","clear warning after local hydration");
 assert.equal(sent.length,1);
 assert.equal(sent[0].seq,8300);
});
test("E1 RED: reuse existing sync indicator for paused local journal",()=>{
 const ui=fs.readFileSync(path.join(__dirname,"../docs/avanzado-extra.js"),"utf8");
 assert.match(ui,/d\.recuperacionLocalPendiente/);
});

test("E1: existing indicator visibly warns while stalled and restores prior display",()=>{
 const source=fs.readFileSync(path.join(__dirname,"../docs/avanzado-extra.js"),"utf8");
 const from=source.indexOf("var _pintarSyncMin = function () {");
 const to=source.indexOf("\n        };",from);
 assert.ok(from>0&&to>from,"the actual existing status painter is found");
 const el={textContent:"",style:{display:"none",color:""},dataset:{}};
 let paused=true;
 const ctx={
  document:{documentElement:{lang:"es"},getElementById:()=>el},
  window:{OCYjs:{_diag:()=>({recuperacionLocalPendiente:paused,ws:{catalogo:1},n:{productos:3,ubicaciones:2},fotos:1})},
    _ocRelojNota:""},
  console
 };
 vm.createContext(ctx);vm.runInContext(source.slice(from,to+11),ctx);
 ctx._pintarSyncMin();
 assert.equal(el.style.display,"","existing indicator becomes visible on stall");
 assert.match(el.textContent,/recuperaci[oó]n local pendiente/);
 paused=false;ctx._pintarSyncMin();
 assert.equal(el.style.display,"none","original hidden state is restored on recovery");
 assert.match(el.textContent,/Sync: connected/);
});

test("E1 RED: confirmed IndexedDB open failure enables safe RAM replay, never cursor storage",async()=>{
 const f=fixture({pending:false,dbOpenFails:true,prior:{rev:0,seq:8300}});
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(f.ctx.canal.recuperacionLocal,"sin-almacenamiento");
 await f.ready();
 const sent=[],sock={readyState:1,send:json=>sent.push(JSON.parse(json))};
 f.ctx.canal.ws=sock;
 await f.ctx.pedirPagina(sock,{enCurso:false,fallos:0});
 assert.equal(sent[0].rev,-1,"cannot reuse a cursor without a loaded local Yjs journal");
 assert.equal(sent[0].seq,0);
 await f.save({rev:0,seq:42,more:false});
 assert.equal(f.events.filter(e=>e==="set").length,0,"memory mode must never write cursor");
 const ckpt=src.slice(src.indexOf("function hacerCkpt()"),src.indexOf("function conectar()",src.indexOf("function hacerCkpt()")));
 assert.match(ckpt,/if\s*\(_soloMemoria\)\s*return;/,"memory mode must not publish checkpoints");
});

test("E1b-1 RED: head probe precedes encrypted download on initial sync",async()=>{
 const f=fixture({pending:false,prior:{rev:2,seq:8300}});await f.ready();
 const sent=[],sock={readyState:1,send:json=>sent.push(JSON.parse(json))};
 f.ctx.canal.ws=sock;
 await f.ctx.pedirPagina(sock,{enCurso:false,fallos:0,usarHead:true});
 assert.equal(sent.length,1);
 assert.equal(sent[0].k,"head","only a lightweight latest-revision query goes to relay");
 assert.equal(sent.filter(v=>v.k==="pull").length,0,"no encrypted pages before server comparison");
});
test("E1b-1 RED: transport recognizes and replies to read-only head probe",()=>{
 const transport=fs.readFileSync(path.join(__dirname,"../supabase-relay/transport.mjs"),"utf8");
 assert.match(transport,/command\.k === 'head'/,"the real transport must carry a read-only head result");
});

test("E1b-1 RED: ten unchanged minutes download zero encrypted pages",async()=>{
 const f=fixture({pending:false,prior:{rev:3,seq:9000}});await f.ready();
 const sent=[],sock={readyState:1,send:j=>sent.push(JSON.parse(j))};
 f.ctx.canal.ws=sock;
 for(let minute=0;minute<10;minute++){
  const state={enCurso:false,fallos:0,usarHead:true};
  await f.ctx.pedirPagina(sock,state);
  await f.ctx.procesarHead(sock,state,{rev:3,seq:9000});
 }
 assert.equal(sent.filter(x=>x.k==="pull").length,0);
 assert.equal(sent.filter(x=>x.k==="head").length,10);
});
test("E1b-1 RED: changed revision and legacy failure both use safe original pull",async()=>{
 const f=fixture({pending:false,prior:{rev:3,seq:9000}});await f.ready();
 const sent=[],sock={readyState:1,send:j=>sent.push(JSON.parse(j))};
 f.ctx.canal.ws=sock;
 for(const result of [{rev:4,seq:9000},{unsupported:true}]){
  const state={enCurso:false,fallos:0,usarHead:true};
  await f.ctx.pedirPagina(sock,state);
  await f.ctx.procesarHead(sock,state,result);
 }
 assert.deepEqual(sent.map(x=>x.k),["head","pull","head","pull"]);
 assert.ok(sent.filter(x=>x.k==="pull").every(x=>x.rev===3&&x.seq===9000));
});
test("E1b-1 RED: continued pagination never repeats the head query",async()=>{
 const f=fixture({pending:false,prior:{rev:3,seq:9000}});await f.ready();
 const sent=[],sock={readyState:1,send:j=>sent.push(JSON.parse(j))};
 f.ctx.canal.ws=sock;
 await f.ctx.pedirPagina(sock,{enCurso:true,fallos:0,usarHead:true},true);
 assert.deepEqual(sent.map(x=>x.k),["pull"]);
});

for(const unsupported of [false,true]){
 test("E1b-1: real relay head "+(unsupported?"legacy fallback":"metadata only"),async()=>{
  const {createRelayTransport}=await import("../supabase-relay/transport.mjs");
  const commands=[];
  const channel={on(){return this;},subscribe(cb){queueMicrotask(()=>cb("SUBSCRIBED"));return this;},
   track:async()=> "ok",presenceState:()=>({}),send:async()=> "ok"};
  const client={
   rpc:async(name,p)=>{
    if(name==="f123_relay_has_topic")return {data:true,error:null};
    commands.push(p.p_action);
    if(p.p_action==="head")return unsupported?
      {data:null,error:new Error("synthetic legacy SQL")}:
      {data:{v:2,rev:4,seq:12345},error:null};
    return {data:{frames:[],v:2,rev:4,seq:12345,more:false,n:0},error:null};
   },
   channel:()=>channel,removeChannel:async()=>{},realtime:{disconnect(){}}
  };
  const relay=createRelayTransport({client});
  const socket=relay.connect("synthetic-e1b");
  await new Promise(resolve=>socket.addEventListener("open",resolve,{once:true}));
  const messages=[];socket.addEventListener("message",e=>messages.push(e.data));
  socket.send(JSON.stringify({k:"head",v:2}));await socket.settled();
  const head=messages.filter(x=>typeof x==="string").map(x=>JSON.parse(x)).find(x=>x.k==="head-result");
  assert.ok(head,"server head or unsupported response must be delivered");
  if(!unsupported){assert.equal(head.rev,4);assert.equal(head.seq,12345);assert.equal(head.unsupported,undefined);}
  else {assert.equal(head.unsupported,true);assert.equal(socket.readyState,1);}
  assert.deepEqual(commands,["head"],"HEAD must not turn into an encrypted pull");
  await relay.dispose();
 });
}
test("E1b-1 SQL probe retains active-room lock and exposes no ciphertext",()=>{
 const sql=fs.readFileSync(path.join(__dirname,"../supabase-relay/migrations/20261022000100_readonly_head.sql"),"utf8");
 assert.match(sql,/WHERE room_hash=h AND transport_active FOR UPDATE/);
 assert.match(sql,/WHEN 'head' THEN/);
 assert.match(sql,/coalesce\(max\(seq\),0\)/);
 const portion=sql.split("WHEN 'head' THEN")[1].split("WHEN 'op' THEN")[0];
 assert.doesNotMatch(portion,/cipher|frames|base64/);
});

test("E1b-1: a silent old server falls back to encrypted pull after head timeout",async()=>{
 const f=fixture({pending:false,prior:{rev:2,seq:2048}});await f.ready();
 const sent=[],sock={readyState:1,send:j=>sent.push(JSON.parse(j))};
 f.ctx.canal.ws=sock;
 const state={enCurso:false,fallos:0,usarHead:true};
 await f.ctx.pedirPagina(sock,state);
 assert.deepEqual(sent.map(x=>x.k),["head"]);
 f.fireHeadTimeout();
 await new Promise(resolve=>setImmediate(resolve));
 assert.deepEqual(sent.map(x=>x.k),["head","pull"]);
 assert.equal(sent[1].rev,2);assert.equal(sent[1].seq,2048);
 await f.ctx.procesarHead(sock,state,{rev:2,seq:2048}); // late reply
 assert.deepEqual(sent.map(x=>x.k),["head","pull"],"late response cannot cancel a real pull");
});


test("E1b-2 RED: five causal timers then zero; reconnect cannot reset the budget",()=>{
 const start=src.indexOf("    function clavePendientes() {",src.indexOf("function crearCanal("));
 const end=src.indexOf("    function pedirPagina(sock, estado, sinHead) {",start);
 assert.ok(start>0&&end>start,"the actual E1b-2 causal scheduler exists");
 const timers=new Map(),requests=[];let nextId=0;
 const ws={readyState:1},doc={store:{pendingStructs:{missing:new Map([[7,9]])},pendingDs:null}};
 const ctx={doc,canal:{ws},partesEntrantes:{},_tReplay:null,_replayKey:null,_replayUsed:0,
   _currentPullState:{enCurso:false,usarHead:true},Y:{encodeStateVector:()=>new Uint8Array([1])},
   setTimeout(fn,ms){const id=++nextId;timers.set(id,{fn,ms});return id;},
   clearTimeout(id){timers.delete(id);},pedirPagina(){requests.push("head");},
   log(){},Map,Array,JSON,Object,Math,Uint8Array};
 vm.createContext(ctx);vm.runInContext(src.slice(start,end),ctx);
 const estado=ctx._currentPullState;
 ctx.programarRelectura(ws,estado);
 const delays=[];
 for(let i=0;i<5;i++){
   assert.equal(timers.size,1);
   const [id,timer]=[...timers][0];delays.push(timer.ms);timers.delete(id);timer.fn();
   ctx.programarRelectura(ws,estado); // HEAD equal: same dependency, same budget
 }
 assert.deepEqual(delays,[30000,60000,120000,240000,300000]);
 assert.equal(requests.length,5);assert.equal(timers.size,0,"no sixth timer remains");
 ctx.programarRelectura(ws,estado);assert.equal(timers.size,0);
 ctx.canal.ws=null;ctx.canal.ws=ws;ctx.programarRelectura(ws,estado);
 assert.equal(timers.size,0,"socket recreation preserves exhausted budget");
 doc.store.pendingStructs.missing.set(7,8);
 ctx.programarRelectura(ws,estado);
 assert.equal(timers.size,1,"new missing dependency key renews exactly one timer");
 assert.equal(ctx._replayUsed,0);
});
test("E1b-2 RED: identical LIVE frame cannot wake sleep, genuine Yjs update can",()=>{
 const start=src.indexOf("    function clavePendientes() {",src.indexOf("function crearCanal("));
 const end=src.indexOf("    function pedirPagina(sock, estado, sinHead) {",start);
 assert.ok(start>0&&end>start);
 const requests=[],ws={readyState:1},doc={store:{pendingStructs:{missing:new Map([[7,9]])}}};
 let vector=1;
 const ctx={doc,canal:{ws},partesEntrantes:{},_tReplay:null,_replayKey:null,_replayUsed:5,
   _currentPullState:{enCurso:false,usarHead:true},Y:{encodeStateVector:()=>new Uint8Array([vector])},
   setTimeout(){throw Error("no timer on live frame");},clearTimeout(){},pedirPagina(){requests.push("head");},
   log(){},Map,Array,JSON,Object,Math,Uint8Array};
 vm.createContext(ctx);vm.runInContext(src.slice(start,end),ctx);
 const previous=new Uint8Array([vector]),key=ctx.clavePendientes();
 ctx.despertarConCambio(previous,key);
 assert.equal(ctx._replayUsed,5);assert.equal(requests.length,0,"duplicate stays dormant");
 vector=2;ctx.despertarConCambio(previous,key);
 assert.equal(ctx._replayUsed,0);assert.equal(requests.length,1,"one HEAD for applied data");
});
test("E1b-2 RED: visible gesture only triggers HEAD, unchanged revision never pulls",async()=>{
 assert.match(src,/visibilitychange/,"visible gesture is wired");
 const f=fixture({pending:false,prior:{rev:3,seq:9000}});await f.ready();
 const sent=[],sock={readyState:1,send:j=>sent.push(JSON.parse(j))};
 f.ctx.canal.ws=sock;
 const state={enCurso:false,fallos:0,usarHead:true};
 await f.ctx.pedirPagina(sock,state);
 await f.ctx.procesarHead(sock,state,{rev:3,seq:9000});
 assert.deepEqual(sent.map(x=>x.k),["head"]);
});
