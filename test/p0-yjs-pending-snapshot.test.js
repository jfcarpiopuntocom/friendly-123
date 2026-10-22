"use strict";
const {test}=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const vm=require("node:vm");
const path=require("node:path");

// Source-level boundary test: extracts the REAL cursor loader/save functions.
// No network, browser client license, or customer's Yjs database is accessed.
const src=fs.readFileSync(path.join(__dirname,"../docs/sync-yjs.js"),"utf8");
const begin=src.indexOf('    if (persistencia && typeof persistencia.get === "function") {',src.indexOf("function crearCanal("));
const end=src.indexOf("    function pedirPagina(sock, estado) {",begin);
assert.ok(begin>0&&end>begin,"cursor boundary exists in the published implementation");
const actual=src.slice(begin,end);

function fixture({pending=true,fragments=false,failBarrier=false,failWrite=false,prior=null}={}){
 const values=new Map();
 if(prior)values.set("cursor",prior);
 const events=[],ctx={
   Y:{
     encodeStateVector:()=>new Uint8Array([0]),
     encodeStateAsUpdate:(doc)=>new Uint8Array(doc.store.pendingStructs?[61,62,63]:[0]),
     applyUpdate:(doc,bytes,origin)=>{events.push("restore:"+origin);doc.store.pendingStructs={bytes:[...bytes]};}
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
     whenSynced:Promise.resolve(),
     get:async key=>{events.push("get");return values.get(key);},
     set:async(key,value)=>{events.push("set");if(failWrite)throw Error("synthetic quota");values.set(key,value);}
   },
   Promise,Uint8Array,ArrayBuffer,Number,Math,Object,Date,JSON,console,
   setTimeout(fn){return setImmediate(fn);},clearTimeout(){},
 };
 vm.createContext(ctx);
 vm.runInContext(actual,ctx);
 return {ctx,events,values,async ready(){await ctx._pullCursorReady;},save:c=>ctx.guardarPullCursor(c)};
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
