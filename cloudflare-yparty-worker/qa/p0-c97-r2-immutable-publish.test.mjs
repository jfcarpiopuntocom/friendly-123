// C97: real local R2 conditional put + frozen Workerd cold read; no production account writes.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {build} from 'esbuild';
import {Miniflare} from 'miniflare';
import {planForwardCurrentUnion} from '../src/current-state-union.mjs';
import {sealPresentUnionToR2} from '../tools/seal-present-union-r2.mjs';
import {publishPresentSealToR2} from '../tools/publish-present-seal-r2.mjs';
import {readTrustedFrozenSource} from '../src/trusted-frozen-source.mjs';
import {prepareFrozenImport} from '../src/certified-frozen-import.mjs';

const ROOM='c'.repeat(32), SCOPE='a'.repeat(64), HEAD='present-c97-20261120';
const sourceA='1'.repeat(64),sourceB='2'.repeat(64),stockKey='3'.repeat(64),stockValue='4'.repeat(64);
const serviceKey='synthetic-c97-server-only-key-12345678';
function makeUnion(amountCents=1500) {
 const view={domain:'stock',keyHash:stockKey,valueHash:stockValue};
 return planForwardCurrentUnion({observations:[
  {application:'friendly-123',businessScope:SCOPE,sourceId:sourceA,
   facts:[{opId:'sale-c97-1',payload:{kind:'sale.record',productId:'p1',quantity:2,amountCents}}],views:[view]},
  {application:'friendly-123',businessScope:SCOPE,sourceId:sourceB,
   facts:[],views:[view]}
 ]});
}
async function makeSeal(amountCents=1500) {
 const unionPlan=makeUnion(amountCents);
 return sealPresentUnionToR2({
  room:ROOM,frozenHead:HEAD,unionPlan,
  authenticatedSealProof:{issuer:'synthetic-owner-verified',verifiedSources:unionPlan.sourceCount,
   unionDigest:unionPlan.digest,businessScope:SCOPE},
  publicCatalogSnapshot:{productos:{p1:{id:'p1',nombre:'Arroz',precio:1.5,stockActual:4,sku:''}},
   ubicaciones:{s1:{id:'s1',nombre:'Mostrador',activa:true}}}
 });
}
async function workerd(seal) {
 const script=(await build({entryPoints:[path.join(import.meta.dirname,'../src/frozen-r2-source.mjs')],
  bundle:true,format:'esm',platform:'neutral',mainFields:['module','main'],
  conditions:['workerd','worker','browser'],external:['cloudflare:*'],write:false})).outputFiles[0].text;
 const mf=new Miniflare({modules:true,script,compatibilityDate:'2026-06-01',
  compatibilityFlags:['nodejs_compat'],r2Buckets:['F123_FROZEN_R2'],
  bindings:{F123_FROZEN_ROOM:ROOM,F123_FROZEN_HEAD:HEAD,
   F123_FROZEN_OPS_MANIFEST_SHA256:seal.ops.manifestSha256,
   F123_FROZEN_CAT_MANIFEST_SHA256:seal.cat.manifestSha256,
   WS_SERVICE_KEY:serviceKey}});
 await mf.ready;
 return {mf,bucket:await mf.getR2Bucket('F123_FROZEN_R2')};
}
function recorder(bucket,writeLog,failAt=0) {
 let requests=0;
 return {
  get:(...args)=>bucket.get(...args),
  put:(key,body,options)=>{
   requests++;writeLog.push({key,headers:options?.onlyIf});
   if(failAt && requests===failAt)throw Error('injected interrupted R2 publish');
   return bucket.put(key,body,options);
  }
 };
}
const manifestKey=seal=>seal.ops.objects.find(x=>x.key.endsWith('manifest.json')).key;
test('C97 RED: write-once pages-first BOTH channels; Workerd consumes exact SHA readback, retry identical',{timeout:45000},async()=>{
 const seal=await makeSeal(),{mf,bucket}=await workerd(seal),writes=[];
 try{
  assert.match(seal.summary.opsBaselineSha256,/^[a-f0-9]{64}$/, 'C95 must publish the real C14 baseline digest, not an undefined .sha256');
  const status=await publishPresentSealToR2({bucket:recorder(bucket,writes),seal});
  assert.equal(status.locallyVerified,true);
  assert.equal(status.pins.ops,seal.ops.manifestSha256);
  assert.equal(status.pins.cat,seal.cat.manifestSha256);
  assert.equal(writes.length,seal.ops.objects.length+seal.cat.objects.length);
  const pageIndices=writes.map((w,i)=>w.key.includes('/page-')?i:-1).filter(i=>i>=0);
  const manifestIndices=writes.map((w,i)=>w.key.endsWith('/manifest.json')?i:-1).filter(i=>i>=0);
  assert(Math.max(...pageIndices)<Math.min(...manifestIndices),'both channels must have ALL pages before either manifest');
  assert(writes.every(w=>w.headers instanceof Headers && w.headers.get('if-none-match')==='*'),
   'R2 writes must use atomic create-only condition, not read-then-unconditional-put');
  const env={WS_OPEN_EXISTING_QA:'1',WS_AUTHORITY_QA:'1',WS_SEPARATE_ROOMS_QA:'1',
   SALA_PILOTO:ROOM,WS_SERVICE_KEY:serviceKey,
   WS_FROZEN_HISTORY_SOURCE:{fetch:async req=>mf.dispatchFetch(req.url,{
    method:req.method,headers:Object.fromEntries(req.headers),body:await req.text()
   })}};
  for(const channel of ['ops','cat']){
   const imported=await prepareFrozenImport(await readTrustedFrozenSource({
    env,room:ROOM+'-'+channel,channel
   }));
   assert.equal(imported.sha256,seal[channel].manifest.expectedStateSha256);
   if(channel==='ops')assert.equal(imported.eventCount,1);
  }
  const again=await publishPresentSealToR2({bucket:recorder(bucket,[]),seal});
  assert.equal(again.locallyVerified,true);
  assert.equal(again.reused,seal.ops.objects.length+seal.cat.objects.length,
   'retry must observe exact same bytes; never overwrite');
 }finally{await mf.dispose()}
});
test('C97 RED: crash after one page never makes manifest visible; same archive resumes with no deletion',{timeout:45000},async()=>{
 const seal=await makeSeal(),{mf,bucket}=await workerd(seal);
 try{
  await assert.rejects(publishPresentSealToR2({bucket:recorder(bucket,[],2),seal}),
   /injected|interrupted/i);
  assert.equal(await bucket.get(manifestKey(seal)),null,'partial upload must not have a visible ops manifest');
  const catManifest=seal.cat.objects.find(x=>x.key.endsWith('manifest.json'));
  assert.equal(await bucket.get(catManifest.key),null);
  const result=await publishPresentSealToR2({bucket,seal});
  assert.equal(result.locallyVerified,true);
  assert(result.reused>=1,'existing first page must be verified then resumed');
 }finally{await mf.dispose()}
});
test('C97 RED: same key with DIFFERENT legitimate sealed facts refuses, keeps original archive exactly',{timeout:45000},async()=>{
 const seal=await makeSeal(1500),altered=await makeSeal(9999),{mf,bucket}=await workerd(seal);
 try{
  await publishPresentSealToR2({bucket,seal});
  const before=await (await bucket.get(manifestKey(seal))).text();
  await assert.rejects(publishPresentSealToR2({bucket,seal:altered}),
   /conflict|immutable|mismatch|existing/i);
  assert.equal(await (await bucket.get(manifestKey(seal))).text(),before);
 }finally{await mf.dispose()}
});
test('C97 RED: corrupted page body must be rejected BEFORE first R2 write',{timeout:45000},async()=>{
 const seal=await makeSeal(),ops={...seal.ops,objects:seal.ops.objects.map(o=>
  o.key.includes('/page-')?{...o,body:JSON.stringify({frames:[]})}:o)};
 const corrupt={...seal,ops};
 const {mf,bucket}=await workerd(seal),writes=[];
 try{
  await assert.rejects(publishPresentSealToR2({bucket:recorder(bucket,writes),seal:corrupt}),
   /integrity|page|sha|frame|manifest|invalid/i);
  assert.equal(writes.length,0,'invalid archives must not leave partial artifacts in R2');
 }finally{await mf.dispose()}
});