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
const end=src.indexOf("    function pedirPagina(sock, estado) {",begin);
assert.ok(begin>0&&end>begin,"cursor boundary exists in the published implementation");
const actual=src.slice(begin,end);

function fixture({pending=true,fragments=false,failBarrier=false,failWrite=false,prior=null,tamperReadback=false,syncedHeld=false,failRestore=false}={}){
 const values=new Map();
 if(prior)values.set("cursor",prior);
 let resumeHydration;
 const events=[],ctx={
   Y:{
     encodeStateVector:()=>new Uint8Array([0]),
     encodeStateAsUpdate:(doc)=>new Uint8Array(doc.store.pendingStructs?[61,62,63]:[0]),
     applyUpdate:(doc,bytes,origin)=>{events.push("restore:"+origin);if(failRestore)throw Error("synthetic Yjs update rejected");doc.store.pendingStructs={bytes:[...bytes]};}
   },
   doc:{store:pending?{pendingStructs:{missingParent:true}}:{}},
   partesEntrantes:fragments?{"chunk":{received:1,total:2}}:{},
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
   setTimeout(fn){return setImmediate(fn);},clearTimeout(){},
 };
 vm.createContext(ctx);
 vm.runInContext(actual,ctx);
 return {ctx,events,values,async ready(){await ctx._pullCursorReady;},save:c=>ctx.guardarPullCursor(c),releaseHydration:()=>resumeHydration?.()};
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
