// D7 RED→GREEN on REAL friendly-123: independently certified Yjs freeze
// → immutable exact bytes R2 archive (not a Firebase provider or an upload).
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {build} from 'esbuild';
import {Miniflare} from 'miniflare';
import * as Y from 'yjs';
import {packFrozenR2Archive} from '../tools/frozen-r2-packager.mjs';
import {readTrustedFrozenSource} from '../src/trusted-frozen-source.mjs';
import {prepareFrozenImport} from '../src/certified-frozen-import.mjs';
const roomId='b'.repeat(32),head='forensic-head-20261119-cert-001';
const room=roomId+'-ops',key='synthetic-g7-server-only-secret-32bytes!';
const sha=b=>createHash('sha256').update(b).digest('hex');
function framesSha(frames){
 const sized=Buffer.allocUnsafe(frames.reduce((n,f)=>n+4+f.length,0));let off=0;
 for(const f of frames){sized.writeUInt32BE(f.length,off);off+=4;Buffer.from(f).copy(sized,off);off+=f.length;}
 return sha(sized);
}
function fixture(channel='ops'){
 const doc=new Y.Doc();doc.clientID=1818;
 const frames=[];doc.on('update',u=>frames.push(new Uint8Array(u)));
 if(channel==='ops'){
  for(let i=0;i<100;i++){
   const opId='historical-'+String(i).padStart(3,'0');
   doc.getMap('eventos').set(opId,{kind:'sale.record',opId,amountCents:i+1});
  }
 }else{
  doc.getMap('productos').set('sku1',{id:'sku1',nombre:'Book',precio:15,stockActual:3,costo:199});
  doc.getMap('ubicaciones').set('shelf1',{id:'shelf1',nombre:'Books',activa:true});
  doc.getMap('_meta').set('pinsRol',{owner:'HIGHLY_PRIVATE_PIN_999'});
  doc.getMap('hechos_financieros').set('money1',{bank:'VERY_PRIVATE_ACCOUNT'});
 }
 const state=Y.encodeStateAsUpdate(doc),vector=Y.encodeStateVector(doc),snap=frames.map(x=>new Uint8Array(x));
 doc.destroy();
 return {frames:snap,room:roomId+'-'+channel,channel,frozenHead:head,
  externalProof:{
   sourceHead:head,completeToHead:true,sourceFramesSha256:framesSha(snap),
   expectedStateSha256:sha(state),expectedVectorSha256:sha(vector),
   ...(channel==='ops'?{expectedOpIds:100}:{})
  }};
}
test('ops archive is byte-for-byte deterministic on replay and keeps every original Yjs frame',async()=>{
 const f=fixture(),original=f.frames.map(x=>Buffer.from(x).toString('hex'));
 const opts={...f,limits:{maxFramesPerPage:50}};
 const a=await packFrozenR2Archive(opts),b=await packFrozenR2Archive(opts);
 assert.equal(a.manifestSha256,b.manifestSha256);
 assert.deepEqual(a.objects,b.objects);
 assert.equal(a.manifest.pages.length,2);
 assert.equal(a.manifest.expectedOpIds,100);
 assert.equal(a.manifest.frozenHead,head);
 assert.deepEqual(f.frames.map(x=>Buffer.from(x).toString('hex')),original,'packer must not mutate raw evidence');
 const restored=a.objects.filter(x=>x.key.endsWith('.json')&&!x.key.endsWith('manifest.json'))
  .flatMap(x=>JSON.parse(x.body).frames.map(s=>Buffer.from(s,'base64').toString('hex')));
 assert.deepEqual(restored,original,'no rewrite of clientID or Yjs causal structs');
});
test('packed archive is consumed by REAL R2 Workerd source → existing reader and certified importer',{timeout:45000},async()=>{
 const f=fixture(),archive=await packFrozenR2Archive({...f,limits:{maxFramesPerPage:50}});
 const script=(await build({entryPoints:[path.join(import.meta.dirname,'../src/frozen-r2-source.mjs')],
  bundle:true,format:'esm',platform:'neutral',mainFields:['module','main'],
  conditions:['workerd','worker','browser'],external:['cloudflare:*'],write:false})).outputFiles[0].text;
 const mf=new Miniflare({modules:true,script,compatibilityDate:'2026-06-01',
  compatibilityFlags:['nodejs_compat'],r2Buckets:['F123_FROZEN_R2'],
  bindings:{F123_FROZEN_ROOM:roomId,F123_FROZEN_HEAD:head,
   F123_FROZEN_OPS_MANIFEST_SHA256:archive.manifestSha256,WS_SERVICE_KEY:key}});
 try{
  await mf.ready;
  const bucket=await mf.getR2Bucket('F123_FROZEN_R2');
  for(const item of archive.objects)await bucket.put(item.key,item.body);
  const env={WS_OPEN_EXISTING_QA:'1',WS_AUTHORITY_QA:'1',WS_SEPARATE_ROOMS_QA:'1',
   SALA_PILOTO:roomId,WS_SERVICE_KEY:key,
   WS_FROZEN_HISTORY_SOURCE:{fetch:async request=>mf.dispatchFetch(request.url,{
    method:request.method,headers:Object.fromEntries(request.headers),body:await request.text()
   })}};
  const recovered=await readTrustedFrozenSource({env,room,channel:'ops'});
  assert.equal(recovered.frames.length,100);
  const proof=await prepareFrozenImport(recovered);
  assert.equal(proof.sha256,f.externalProof.expectedStateSha256);
  assert.equal(proof.eventCount,100);
 }finally{await mf.dispose()}
});
test('private catalog input becomes ONLY deterministic detached public R2 frames; no PIN/cost/bank',async()=>{
 const f=fixture('cat');
 const a=await packFrozenR2Archive(f),b=await packFrozenR2Archive(f);
 assert.equal(a.manifestSha256,b.manifestSha256);
 assert.deepEqual(a.objects,b.objects);
 const all=a.objects.map(x=>x.body).join('\n');
 assert.equal(all.includes('HIGHLY_PRIVATE_PIN_999'),false);
 assert.equal(all.includes('VERY_PRIVATE_ACCOUNT'),false);
 assert.equal(all.includes('hechos_financieros'),false);
 assert.equal(all.includes('_meta'),false);
 assert.equal(all.includes('costo'),false);
 assert.equal(a.manifest.projectionVersion,'v1');
 assert.equal(a.manifest.expectedProjectedSha256,a.manifest.expectedStateSha256);
 const page=JSON.parse(a.objects.find(x=>x.key.endsWith('page-0001.json')).body);
 const d=new Y.Doc();
 for(const b64 of page.frames)Y.applyUpdate(d,new Uint8Array(Buffer.from(b64,'base64')));
 assert.deepEqual([...d.share.keys()].sort(),['productos','ubicaciones']);
 assert.equal(d.getMap('productos').get('sku1').precio,15);
 assert.equal(d.getMap('productos').get('sku1').costo,undefined);
 d.destroy();
});
test('source proof missing or mismatched HEAD/frames/state/hash/opId never generates archive',async()=>{
 const f=fixture();
 const bad=[
  p=>{delete p.sourceFramesSha256},
  p=>{p.sourceFramesSha256='e'.repeat(64)},
  p=>{p.expectedStateSha256='f'.repeat(64)},
  p=>{p.expectedVectorSha256='d'.repeat(64)},
  p=>{p.expectedOpIds=99},
  p=>{p.sourceHead='different-head'},
  p=>{p.completeToHead=false}
 ];
 for(const mutate of bad){
  const p={...f.externalProof};mutate(p);
  await assert.rejects(packFrozenR2Archive({...f,externalProof:p}),/certif|proof|head|sha|state|opId|complete|frame/i);
 }
});
test('missing causal Yjs parent refuses even when caller claims a complete HEAD',async()=>{
 const d=new Y.Doc(),frames=[];d.clientID=313;d.on('update',u=>frames.push(new Uint8Array(u)));
 d.getMap('eventos').set('first',{amountCents:1});
 d.getMap('eventos').set('second',{amountCents:2});
 const f=[frames[1]];const state=Y.encodeStateAsUpdate(d),vector=Y.encodeStateVector(d);d.destroy();
 await assert.rejects(packFrozenR2Archive({room,channel:'ops',frozenHead:head,frames:f,
  externalProof:{sourceHead:head,completeToHead:true,sourceFramesSha256:framesSha(f),
   expectedStateSha256:sha(state),expectedVectorSha256:sha(vector),expectedOpIds:2}}),/pending|ancestor|sha|source|proof|causal/i);
});
test('private collections in an ops-room Yjs source fail closed before R2 page creation',async()=>{
 const d=new Y.Doc();d.getMap('eventos').set('payment',{amountCents:100});
 d.getMap('_meta').set('pin','PIN_SHOULD_NOT_LEAK');
 const f=[Y.encodeStateAsUpdate(d)],state=sha(Y.encodeStateAsUpdate(d)),vector=sha(Y.encodeStateVector(d));d.destroy();
 await assert.rejects(packFrozenR2Archive({room,channel:'ops',frozenHead:head,frames:f,
  externalProof:{sourceHead:head,completeToHead:true,sourceFramesSha256:framesSha(f),
   expectedStateSha256:state,expectedVectorSha256:vector,expectedOpIds:1}}),/private|root|ops|catalog/i);
});
test('oversized untrusted wire refuses before Yjs apply, with no artifacts',async()=>{
 const raw=new Uint8Array(12*1024*1024+1);
 await assert.rejects(packFrozenR2Archive({room,channel:'ops',frozenHead:head,frames:[raw],
  externalProof:{sourceHead:head,completeToHead:true,sourceFramesSha256:sha(raw),
   expectedStateSha256:'f'.repeat(64),expectedVectorSha256:'a'.repeat(64),expectedOpIds:1}}),/size|wire|budget|bytes|limit/i);
});
test('per-page limits may be tightened but never enlarged to hide a too-large frame',async()=>{
 const f=fixture();
 await assert.rejects(packFrozenR2Archive({...f,limits:{maxFramesPerPage:4097}}),/limit|budget|unsafe/i);
 const a=await packFrozenR2Archive({...f,limits:{maxFramesPerPage:20}});
 assert.equal(a.manifest.pages.length,5);
});
