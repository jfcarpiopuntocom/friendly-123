const {test}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const {webcrypto,createHash}=require('node:crypto');
const photoHash = d => createHash('sha256').update(Buffer.from(d.split(',')[1],'base64')).digest('hex');
const src=fs.readFileSync(path.join(__dirname,'../docs/sync-yjs.js'),'utf8');
const seed=src.slice(src.indexOf('  var _fotosSembradas ='),src.indexOf('  // OCFotos local -> Yjs(fotos).'));
const tick=()=>new Promise(r=>setTimeout(r,5));
for(const digestDelay of [0,75])test('photo seed stays byte-identical across reloads and retains orphan evidence (digest delay '+digestDelay+'ms)',async()=>{
 const crypto={getRandomValues:array=>webcrypto.getRandomValues(array),subtle:{digest:async(...args)=>{
  if(digestDelay)await new Promise(r=>setTimeout(r,digestDelay));
  return webcrypto.subtle.digest(...args);
 }}};
 const ctx={crypto,TextEncoder,Uint8Array,ArrayBuffer,console,atob,setTimeout,clearTimeout};vm.createContext(ctx);
 vm.runInContext(fs.readFileSync(path.join(__dirname,'../docs/vendor/yjs-bundle.min.js'),'utf8'),ctx);
 const Y=ctx.Y, doc=new Y.Doc(), outgoing=[];
 const referenced='data:image/png;base64,AQID',orphan='data:image/png;base64,BAUG';
 const referencedHash=photoHash(referenced),blobs={
   [referencedHash]:referenced,[photoHash(orphan)]:orphan
 };
 ctx.API={fotosDoc:doc,fotosCanal:{}};
 ctx.window={Y,OCFotos:{leerTodosPorHash:async()=>blobs,leerPorHash:async h=>blobs[h],
   hashDeDataUrl:async data=>photoHash(data)},
  OCSync:{catalogoPropio:()=>({productos:[{fotoHash:referencedHash}]})}};
 doc.on('update',u=>outgoing.push(u));
 const run=async()=>{
  vm.runInContext(seed+'\nsembrarFotosAlRelay();',ctx);
  // Hashing finishes independently; wait for every per-run seed, not an elapsed guess.
  const complete=()=>Object.keys(blobs).every(hash=>ctx._fotosSembradas[hash]);
  const deadline=Date.now()+2000;
  while(!complete()&&Date.now()<deadline)await tick();
  assert.ok(complete(),'every referenced and orphan photo seed finishes before checking its bytes');
 };
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
