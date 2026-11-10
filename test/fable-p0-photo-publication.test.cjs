'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),{createHash}=require('node:crypto');
const src=fs.readFileSync(path.join(__dirname,'../docs/sync-yjs.js'),'utf8');
const start=src.indexOf('  function publicarFotosLocales() {');
const end=src.indexOf('  // ===================================================================',start);
assert.ok(start>0&&end>start,'must execute real local-photo publisher, not an imitation');
const code=src.slice(start,end);
const hash=d=>createHash('sha256').update(Buffer.from(d.split(',')[1],'base64')).digest('hex');
const settle=()=>new Promise(resolve=>setImmediate(resolve));
function fixture({entries,photos}) {
 const writes=[],map=new Map();
 const oldSet=map.set.bind(map);
 map.set=(h,d)=>{writes.push([h,d]);return oldSet(h,d);};
 const ctx={API:{fotosMap:map},window:{
   OCFotos:{leerPorHash:async h=>photos[h]||null,hashDeDataUrl:async data=>hash(data)},
   OCSync:{catalogoPropio:()=>({productos:entries.map(fotoHash=>({fotoHash})),ubicaciones:[],gastos:[]})}
 },Promise,console};
 vm.createContext(ctx);vm.runInContext(code+'\nthis.publish=publicarFotosLocales;',ctx);
 return {ctx,map,writes};
}
test('Fable P0-1 RED: legacy hash with mismatched bytes MUST NOT be published to Yjs',async()=>{
 const actual='data:image/png;base64,AQIDBA==',wrongHash=hash('data:image/png;base64,CAkKCw==');
 const f=fixture({entries:[wrongHash],photos:{[wrongHash]:actual}});
 f.ctx.publish();await settle();await settle();
 assert.equal(f.map.get(wrongHash),undefined,'corrupt legacy key must never enter replicated Yjs map');
 assert.equal(f.writes.length,0,'do not publish any immutable hash/bytes pair for mislabeled legacy photo');
});
test('Fable P0-1: correct photo hash still publishes exactly once',async()=>{
 const photo='data:image/png;base64,AQIDBA==',goodHash=hash(photo);
 const f=fixture({entries:[goodHash,goodHash],photos:{[goodHash]:photo}});
 f.ctx.publish();await settle();await settle();
 assert.equal(f.map.get(goodHash),photo,'valid photo remains synchronizable');
 assert.equal(f.writes.length,1,'idempotent when multiple products reference the same photo');
});
