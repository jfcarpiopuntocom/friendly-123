'use strict';
// H3 RED-first: exercise *real* sync-yjs photo seed code (no relay/network).
// New hash enumeration must preserve EVERY content-addressed photo, including
// orphan evidence and Yjs-only bytes, with no bulk hash->dataURL map.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {webcrypto}=require('node:crypto');
const code=fs.readFileSync(path.join(__dirname,'../docs/sync-yjs.js'),'utf8');
const from=code.indexOf('  var _fotosSembradas =');
const end=code.indexOf('  /* SEMBRAR VENTAS',from);
assert.ok(from>0&&end>from,'exact real photo seed block must remain identifiable');
const snippet=code.slice(from,end);
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(pred,ms=2200){
 const until=Date.now()+ms;
 while(!pred()&&Date.now()<until)await sleep(10);
 assert.ok(pred(),'expected complete photo seed without silently dropping a hash');
}
test('H3 RED: all catalog, orphan, and Yjs-only photos seed without bulk-read and with at most one blob read in flight',async()=>{
 const ctx={crypto:webcrypto,TextEncoder,Uint8Array,ArrayBuffer,console};
 vm.createContext(ctx);
 vm.runInContext(fs.readFileSync(path.join(__dirname,'../docs/vendor/yjs-bundle.min.js'),'utf8'),ctx);
 const Y=ctx.Y,doc=new Y.Doc(),map=doc.getMap('blobs');
 const hCat='synthetic-photo-product',hOrphan='synthetic-photo-orphan',hOnly='synthetic-photo-yjs-only';
 const values=new Map([[hCat,'data:image/png;base64,AQID'],[hOrphan,'data:image/png;base64,BAUG']]);
 const yVal='data:image/png;base64,BwgJ';map.set(hOnly,yVal);
 const writes=[],ws={relayLayer:'synthetic-photos-relay'};
 let inFlight=0,maxInflight=0,bulkCalls=0;
 ctx.API={fotosDoc:doc,fotosMap:map,fotosCanal:{ws,
  enviarUpdate:update=>writes.push(Buffer.from(update))}};
 ctx.window={Y,OCSync:{
   catalogoPropio:()=>({productos:[{fotoHash:hCat}],ubicaciones:[],gastos:[]}),
   hashearFotosProductos:async()=>0,hashearFotosPerchas:async()=>0
 },OCFotos:{
   hashesGuardados:async()=>[hOrphan,hCat],
   leerTodosPorHash:async()=>{bulkCalls++;throw Error('H3 PROHIBITS memory-hungry bulk photos');},
   leerPorHash:async hash=>{
     inFlight++;maxInflight=Math.max(maxInflight,inFlight);
     try{await sleep(12);return values.get(hash)||null}
     finally{inFlight--}
   }
 }};
 doc.on('update',(u,origin)=>{if(origin==='seed')writes.push(Buffer.from(u))});
 vm.runInContext(snippet,ctx);
 vm.runInContext('sembrarFotosAlRelay();',ctx);
 await until(()=>[hCat,hOrphan,hOnly].every(h=>ctx._fotosSembradas[h]?.[ws.relayLayer]));
 for(const [key,content] of [...values,[hOnly,yVal]]) assert.equal(map.get(key),content,'same bytes in Yjs for '+key);
 assert.equal(writes.length,3,'exactly one initial durable update per blob');
 assert.equal(bulkCalls,0,'normal seed must not materialize whole photo library');
 assert.equal(maxInflight,1,'sequential per-hash seed keeps transient photo reads bounded');
 vm.runInContext('sembrarFotosAlRelay();',ctx);
 await sleep(90);
 assert.equal(writes.length,3,'same relay layer must not duplicate already seeded blobs');
 ws.relayLayer='synthetic-photos-alternate-layer';
 vm.runInContext('sembrarFotosAlRelay();',ctx);
 await until(()=>[hCat,hOrphan,hOnly].every(h=>ctx._fotosSembradas[h]?.[ws.relayLayer]));
 assert.equal(writes.length,6,'other durable relay layer must receive all three bytes unchanged');
 doc.destroy();
});
