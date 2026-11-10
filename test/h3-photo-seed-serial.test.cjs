'use strict';
const { test }=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {webcrypto}=require('node:crypto');
const file=fs.readFileSync(path.resolve(__dirname,'../docs/sync-yjs.js'),'utf8');
const begin=file.indexOf('  var _fotosSembradas =');
const end=file.indexOf('  // OCFotos local -> Yjs(fotos).',begin);
assert.ok(begin>0 && end>begin,'extract real photo seed implementation');
const seed=file.slice(begin,end);
const tick=()=>new Promise(r=>setTimeout(r,10));

test('H3 RED: all referenced, orphan and legacy photo bytes seed sequentially with no bulk read',async()=>{
  const ctx={crypto:webcrypto,TextEncoder,Uint8Array,ArrayBuffer,console};
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.resolve(__dirname,'../docs/vendor/yjs-bundle.min.js'),'utf8'),ctx);
  const Y=ctx.Y,doc=new Y.Doc(),bytes={
    'referenced-h3':'data:image/png;base64,AQID',
    'orphan-h3':'data:image/png;base64,BAUG',
    'legacy-h3':'data:image/png;base64,BwgJ'
  };
  let active=0,maxActive=0,bulkReads=0;
  const reads=[];
  ctx.API={fotosDoc:doc,fotosMap:doc.getMap('blobs'),
    fotosCanal:{ws:{relayLayer:'f123_relay_cupo_v1'},enviarUpdate:()=>{}}};
  ctx.window={
    Y,
    OCFotos:{
      hashesGuardados:async()=>Object.keys(bytes),
      leerPorHash:async h=>{
        active++;maxActive=Math.max(maxActive,active);
        reads.push(h);
        await tick();
        active--;
        return bytes[h]||null;
      },
      leerTodosPorHash:async()=>{bulkReads++;throw Error('bulk image library load is forbidden in H3');}
    },
    OCSync:{catalogoPropio:()=>({productos:[{fotoHash:'referenced-h3'}]})}
  };
  vm.runInContext(seed,ctx);
  vm.runInContext('sembrarFotosAlRelay();',ctx);
  const deadline=Date.now()+1500;
  while(ctx.API.fotosMap.size<3&&Date.now()<deadline)await tick();
  assert.equal(bulkReads,0,'H3 must not enumerate all photo data URLs');
  assert.equal(ctx.API.fotosMap.size,3,'no orphan or legacy photos may disappear');
  for(const [hash,data] of Object.entries(bytes))assert.equal(ctx.API.fotosMap.get(hash),data);
  assert.equal(maxActive,1,'photo content reads must be sequential, not unbounded fanout');
  assert.deepEqual(reads,Object.keys(bytes),'every referenced/orphan/legacy hash read exactly once');
  doc.destroy();
});
