'use strict';
// H3 RED-first: exercise *real* sync-yjs photo seed code (no relay/network).
// New hash enumeration must preserve EVERY content-addressed photo, including
// orphan evidence and Yjs-only bytes, with no bulk hash->dataURL map.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {webcrypto,createHash}=require('node:crypto');
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
 const catVal='data:image/png;base64,AQID',orphanVal='data:image/png;base64,BAUG',yVal='data:image/png;base64,BwgJ';
 const hCat=hashOfPhoto(catVal),hOrphan=hashOfPhoto(orphanVal),hOnly=hashOfPhoto(yVal);
 const values=new Map([[hCat,catVal],[hOrphan,orphanVal]]);
 map.set(hOnly,yVal);
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
   hashDeDataUrl:async d=>hashOfPhoto(d),leerPorHash:async hash=>{
     inFlight++;maxInflight=Math.max(maxInflight,inFlight);
     try{await sleep(12);return values.get(hash)||null}
     finally{inFlight--}
   }
 }};
 doc.on('update',(u,origin)=>{if(origin==='seed')writes.push(Buffer.from(u))});
 ctx.setTimeout=setTimeout;ctx.clearTimeout=clearTimeout;
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


test('H3 RED: overlapping reconnects do not multiply in-flight photo reads or durable sends',async()=>{
 const ctx={crypto:webcrypto,TextEncoder,Uint8Array,ArrayBuffer,console};
 vm.createContext(ctx);vm.runInContext(fs.readFileSync(path.join(__dirname,'../docs/vendor/yjs-bundle.min.js'),'utf8'),ctx);
 const doc=new ctx.Y.Doc(),map=doc.getMap('blobs'),ws={relayLayer:'same-relay'},sends=[];
 const photos=['data:image/png;base64,AA==','data:image/png;base64,AQ=='];
 const hashes=photos.map(hashOfPhoto),blob=Object.fromEntries(hashes.map((h,i)=>[h,photos[i]]));
 let active=0,maxActive=0;
 ctx.API={fotosDoc:doc,fotosMap:map,fotosCanal:{ws,enviarUpdate:u=>sends.push(Buffer.from(u))}};
 ctx.window={Y:ctx.Y,OCSync:{catalogoPropio:()=>({productos:hashes.map(fotoHash=>({fotoHash}))})},
   OCFotos:{hashesGuardados:async()=>hashes,hashDeDataUrl:async d=>hashOfPhoto(d),leerPorHash:async hash=>{
    active++;maxActive=Math.max(maxActive,active);
    try{await sleep(45);return blob[hash]}finally{active--}
   }}};
 doc.on('update',(u,origin)=>{if(origin==='seed')sends.push(Buffer.from(u))});
 ctx.setTimeout=setTimeout;ctx.clearTimeout=clearTimeout;
 vm.runInContext(snippet,ctx);
 for(let i=0;i<4;i++)vm.runInContext('sembrarFotosAlRelay();',ctx);
 await until(()=>hashes.every(h=>ctx._fotosSembradas[h]?.[ws.relayLayer]));
 await sleep(200); // catch any duplicate sends still queued from older overlapping passes
 assert.equal(maxActive,1,'all reconnect callers must share one in-flight seed pass');
 assert.equal(sends.length,2,'each hash must publish once despite repeated reconnect triggers');
 assert.equal(map.get(hashes[0]),blob[hashes[0]]);
 assert.equal(map.get(hashes[1]),blob[hashes[1]]);
 doc.destroy();
});

test('H3 RED: relay switches during awaited photo read cannot mark previous relay as ACKed',async()=>{
 const ctx={crypto:webcrypto,TextEncoder,Uint8Array,ArrayBuffer,console};
 vm.createContext(ctx);vm.runInContext(fs.readFileSync(path.join(__dirname,'../docs/vendor/yjs-bundle.min.js'),'utf8'),ctx);
 const doc=new ctx.Y.Doc(),map=doc.getMap('blobs'),photo='data:image/png;base64,Ag==',hash=hashOfPhoto(photo);
 const ws={relayLayer:'relay-A'},sends=[];
 let release,started;
 const firstRead=new Promise(r=>{started=r});
 const held=new Promise(r=>{release=r});
 let first=true;
 ctx.API={fotosDoc:doc,fotosMap:map,fotosCanal:{ws,enviarUpdate:u=>sends.push({layer:ws.relayLayer,bytes:Buffer.from(u)})}};
 ctx.window={Y:ctx.Y,OCSync:{catalogoPropio:()=>({productos:[{fotoHash:hash}]})},
   OCFotos:{hashesGuardados:async()=>[hash],hashDeDataUrl:async d=>hashOfPhoto(d),leerPorHash:async()=>{
    if(first){first=false;started();await held;}
    return photo;
   }}};
 doc.on('update',(u,origin)=>{if(origin==='seed')sends.push({layer:ws.relayLayer,bytes:Buffer.from(u)})});
 ctx.setTimeout=setTimeout;ctx.clearTimeout=clearTimeout;
 vm.runInContext(snippet,ctx);
 vm.runInContext('sembrarFotosAlRelay();',ctx);
 await firstRead; // old relay A is now awaiting its first photo read
 ws.relayLayer='relay-B';
 vm.runInContext('sembrarFotosAlRelay();',ctx); // must queue a fresh B pass
 release();
 await until(()=>!!ctx._fotosSembradas[hash]?.['relay-B'],5000);
 assert.ok(!ctx._fotosSembradas[hash]?.['relay-A'],
   'no false ACK of relay A: its socket switched before photo was emitted');
 assert.deepEqual(sends.map(s=>s.layer),['relay-B'],'only current B relay received the first photo');
 ws.relayLayer='relay-A';
 vm.runInContext('sembrarFotosAlRelay();',ctx);
 await until(()=>!!ctx._fotosSembradas[hash]?.['relay-A']);
 assert.deepEqual(sends.map(s=>s.layer),['relay-B','relay-A'],
   'returning to A must still send its missing photo (unchanged deterministic bytes)');
 assert.equal(map.get(hash),photo);
 doc.destroy();
});
test('H3 RED: catalog read throws but orphan and Yjs-only photos must still seed',async()=>{
 const ctx={crypto:webcrypto,TextEncoder,Uint8Array,ArrayBuffer,console};
 vm.createContext(ctx);vm.runInContext(fs.readFileSync(path.join(__dirname,'../docs/vendor/yjs-bundle.min.js'),'utf8'),ctx);
 const doc=new ctx.Y.Doc(),map=doc.getMap('blobs'),ws={relayLayer:'recovery-layer'},sends=[];
 const legacyPhoto='data:image/png;base64,AA==',yPhoto='data:image/png;base64,AQ==';
 const legacy=hashOfPhoto(legacyPhoto),yOnly=hashOfPhoto(yPhoto);
 map.set(yOnly,yPhoto);
 ctx.API={fotosDoc:doc,fotosMap:map,fotosCanal:{ws,enviarUpdate:u=>sends.push(Buffer.from(u))}};
 ctx.window={Y:ctx.Y,OCSync:{catalogoPropio:()=>{throw Error('transient catalog unavailable');},
   hashearFotosProductos:async()=>0,hashearFotosPerchas:async()=>0},
  OCFotos:{hashesGuardados:async()=>[legacy],hashDeDataUrl:async d=>hashOfPhoto(d),leerPorHash:async h=>h===legacy?legacyPhoto:null}};
 doc.on('update',(u,origin)=>{if(origin==='seed')sends.push(Buffer.from(u))});
 ctx.setTimeout=setTimeout;ctx.clearTimeout=clearTimeout;
 vm.runInContext(snippet,ctx);vm.runInContext('sembrarFotosAlRelay();',ctx);
 await until(()=>[legacy,yOnly].every(h=>ctx._fotosSembradas[h]?.[ws.relayLayer]));
 assert.equal(sends.length,2,'both recoverable photo sources seed without a catalog');
 assert.equal(map.get(legacy),legacyPhoto);
 assert.equal(map.get(yOnly),yPhoto);
 doc.destroy();
});


const hashOfPhoto=photo=>createHash('sha256').update(Buffer.from(photo.split(',')[1],'base64')).digest('hex');
async function photoFixture({photo,keys,read,enumerate,slowTimers=false}) {
 const ctx={crypto:webcrypto,TextEncoder,Uint8Array,ArrayBuffer,console,
   setTimeout:(fn,ms)=>setTimeout(fn,slowTimers?Math.min(ms,70):ms),clearTimeout};
 vm.createContext(ctx);
 vm.runInContext(fs.readFileSync(path.join(__dirname,'../docs/vendor/yjs-bundle.min.js'),'utf8'),ctx);
 const doc=new ctx.Y.Doc(),map=doc.getMap('blobs'),ws={relayLayer:'fable-qa-relay'},sends=[];
 ctx.API={fotosDoc:doc,fotosMap:map,fotosCanal:{ws,enviarUpdate:u=>sends.push(Buffer.from(u))}};
 ctx.window={Y:ctx.Y,OCSync:{
   catalogoPropio:()=>({productos:(keys.catalog||[]).map(fotoHash=>({fotoHash})),ubicaciones:[],gastos:[]}),
   hashearFotosProductos:async()=>0,hashearFotosPerchas:async()=>0
 },OCFotos:{
   hashesGuardados:enumerate|| (async()=>keys.legacy||[]),
   leerPorHash:read|| (async()=>photo),
   hashDeDataUrl:async d=>hashOfPhoto(d)
 }};
 doc.on('update',(u,origin)=>{if(origin==='seed')sends.push(Buffer.from(u))});
 vm.runInContext(snippet,ctx);
 return {ctx,doc,map,ws,sends};
}
test('Fable G1 RED: a never-resolving IDB enumeration cannot hold photo seed lock forever',async()=>{
 const photo='data:image/png;base64,AwQF',hash=hashOfPhoto(photo);
 const {ctx,doc,ws}=await photoFixture({photo,keys:{catalog:[hash]},enumerate:()=>new Promise(()=>{}),slowTimers:true});
 vm.runInContext('sembrarFotosAlRelay();',ctx);
 await sleep(15);
 vm.runInContext('sembrarFotosAlRelay();',ctx);
 await until(()=>!!ctx._fotosSembradas[hash]?.[ws.relayLayer],750);
 assert.equal(ctx._fotosSembrando,false,'hung enumeration releases the single-flight guard');
 doc.destroy();
});
test('Fable G2 RED: wrongly labelled legacy hash NEVER reaches the Yjs blobs map',async()=>{
 const correctPhoto='data:image/png;base64,AQIDBA==';
 const wrongHash=hashOfPhoto('data:image/png;base64,CAkK'),rightHash=hashOfPhoto(correctPhoto);
 assert.notEqual(wrongHash,rightHash);
 const {ctx,doc,map,ws,sends}=await photoFixture({photo:correctPhoto,keys:{catalog:[],legacy:[wrongHash]}});
 vm.runInContext('sembrarFotosAlRelay();',ctx);
 await sleep(160);
 assert.equal(map.get(wrongHash),undefined,'do not replicate malformed hash->bytes under an immutable wrong key');
 assert.equal(ctx._fotosSembradas[wrongHash]?.[ws.relayLayer],undefined,'no false seed/ACK');
 assert.equal(sends.length,0,'bad bytes must not be sent');
 doc.destroy();
});
test('Fable G2 positive: a real 64-hex SHA-256 photo still reaches the target relay',async()=>{
 const photo='data:image/png;base64,BQYH',hash=hashOfPhoto(photo);
 const {ctx,doc,map,ws}=await photoFixture({photo,keys:{catalog:[],legacy:[hash]}});
 vm.runInContext('sembrarFotosAlRelay();',ctx);
 await until(()=>!!ctx._fotosSembradas[hash]?.[ws.relayLayer]);
 assert.equal(map.get(hash),photo);
 doc.destroy();
});

// Fable P1-2: a Safari IndexedDB transaction can remain unsettled after opening.
// The photo relay must release its seed single-flight after a bounded wait.
for (const blocked of ['hashearFotosProductos','hashearFotosPerchas']) {
 test('Fable P1-2 RED: stalled '+blocked+' cannot freeze all photo relay seeding',async()=>{
  const photo='data:image/png;base64,CgsM',hash=hashOfPhoto(photo);
  const {ctx,doc,ws}=await photoFixture({photo,keys:{catalog:[hash]},slowTimers:true});
  ctx.window.OCSync[blocked]=()=>new Promise(()=>{});
  vm.runInContext('sembrarFotosAlRelay();',ctx);
  try {
   await until(()=>!!ctx._fotosSembradas[hash]?.[ws.relayLayer],650);
   assert.equal(ctx._fotosSembrando,false,'one stalled pre-hash must not keep seed locked');
  } finally { doc.destroy(); }
 });
}
