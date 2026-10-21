const {test}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const {webcrypto}=require('node:crypto');
const src=fs.readFileSync(path.join(__dirname,'../docs/sync-yjs.js'),'utf8');
const seed=src.slice(src.indexOf('  var _fotosSembradas ='),src.indexOf('  // OCFotos local -> Yjs(fotos).'));
const tick=()=>new Promise(r=>setTimeout(r,15));
test('photo seed stays byte-identical across reloads and retains orphan evidence',async()=>{
 const ctx={crypto:webcrypto,TextEncoder,Uint8Array,ArrayBuffer,console};vm.createContext(ctx);
 vm.runInContext(fs.readFileSync(path.join(__dirname,'../docs/vendor/yjs-bundle.min.js'),'utf8'),ctx);
 const Y=ctx.Y, doc=new Y.Doc(), outgoing=[];
 const blobs={'synthetic-photo':'data:image/png;base64,AQID','synthetic-orphan':'data:image/png;base64,BAUG'};
 ctx.API={fotosDoc:doc,fotosCanal:{}};
 ctx.window={Y,OCFotos:{leerTodosPorHash:async()=>blobs,leerPorHash:async h=>blobs[h]},
  OCSync:{catalogoPropio:()=>({productos:[{fotoHash:'synthetic-photo'}]})}};
 doc.on('update',u=>outgoing.push(u));
 const run=async()=>{vm.runInContext(seed+'\nsembrarFotosAlRelay();',ctx);await tick();await tick();};
 await run();assert.equal(outgoing.length,2);const initialBytes=Y.encodeStateAsUpdate(doc).length;
 await run();assert.equal(outgoing.length,2,'reload must not create fresh Yjs photo operations');
 assert.equal(Y.encodeStateAsUpdate(doc).length,initialBytes);
 const second=new Y.Doc();ctx.API.fotosDoc=second;const secondUpdates=[];second.on('update',u=>secondUpdates.push(u));
 await run();assert.equal(secondUpdates.length,2);
 // SHA-256 digests for different hashes finish independently: their arrival order
 // is not part of the Yjs photo protocol. Require exact bytes for every update,
 // regardless of the order in which distinct photos finish hashing.
 const sortedBytes = updates => updates.map(u => Buffer.from(u))
   .sort((a,b) => Buffer.compare(a,b));
 assert.deepEqual(sortedBytes(secondUpdates),sortedBytes(outgoing),
   'another device must seed the exact same bytes for each immutable photo');
 for (const [hash,bytes] of Object.entries(blobs)) {
   assert.equal(second.getMap('blobs').get(hash),bytes,
     'referenced and orphan photos must both survive with identical content');
 }
 assert.equal(secondUpdates.length,new Set(secondUpdates.map(u=>Buffer.from(u).toString('hex'))).size,
   'no duplicate photo update is emitted in the second device');
 doc.destroy();second.destroy();
});
