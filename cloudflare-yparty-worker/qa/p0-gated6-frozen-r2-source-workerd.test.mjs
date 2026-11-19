// Gate D6 RED/GREEN: REAL independent R2 Worker + existing trusted reader.
// R2 is only preloaded with synthetic content here; the Worker has no PUT path.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import path from 'node:path';
import * as Y from 'yjs';
import {build} from 'esbuild';
import {Miniflare} from 'miniflare';
import {readTrustedFrozenSource} from '../src/trusted-frozen-source.mjs';
import {prepareFrozenImport} from '../src/certified-frozen-import.mjs';
import {projectPublicCatalog} from '../src/catalog-safe-projection.mjs';

const roomId='a'.repeat(32),opsRoom=roomId+'-ops',catRoom=roomId+'-cat';
const head='certified-r2-frozen-head-20261119';
const serviceKey='synthetic-only-shared-service-key-32bytes';
const sha=b=>createHash('sha256').update(b).digest('hex');
const utf8=new TextEncoder();
const ROOT='f123-frozen/v1/';
const objKey=(room,channel,file)=>ROOT+room+'/'+head+'/'+channel+'/'+file;
function pageSha(frames){
 const bytes=Buffer.allocUnsafe(frames.reduce((n,f)=>n+4+f.length,0));
 let offset=0;
 for(const frame of frames){bytes.writeUInt32BE(frame.length,offset);offset+=4;
  Buffer.from(frame).copy(bytes,offset);offset+=frame.length;}
 return sha(bytes);
}
function framesFromDoc(channel='ops'){
 const doc=new Y.Doc();doc.clientID=104;
 const updates=[];doc.on('update',u=>updates.push(new Uint8Array(u)));
 if(channel==='ops'){
  doc.getMap('eventos').set('sale-001',{kind:'sale.record',opId:'sale-001',amountCents:250});
  doc.getMap('eventos').set('sale-002',{kind:'sale.record',opId:'sale-002',amountCents:175});
 }else{
  doc.getMap('productos').set('prod-1',{id:'prod-1',nombre:'Book',precio:15,stockActual:2});
  doc.getMap('ubicaciones').set('shelf-1',{id:'shelf-1',nombre:'Main shelf',activa:true});
  doc.getMap('_meta').set('pinsRol',{owner:'PRIVATE_PIN_NOT_FOR_SERVER'});
 }
 let activeDoc=doc,frames=updates;
 if(channel==='cat'){
  const projection=projectPublicCatalog({sourceDoc:doc,Y,room:catRoom,channel:'cat',frozenHead:head});
  activeDoc=projection.doc;
  // A detached PUBLIC Y.Doc is the only catalog source that may be frozen.
  frames=[Y.encodeStateAsUpdate(activeDoc)];
 }
 const state=Y.encodeStateAsUpdate(activeDoc),vector=Y.encodeStateVector(activeDoc);
 const projectedSha=channel==='cat'?sha(projectPublicCatalog({sourceDoc:activeDoc,Y,
  room:catRoom,channel:'cat',frozenHead:head}).bytes):null;
 const result={frames,stateSha:sha(state),vectorSha:sha(vector),expectedOpIds:channel==='ops'?2:undefined,
  projectedSha};
 activeDoc.destroy();if(activeDoc!==doc)doc.destroy();
 return result;
}
function freeze(channel='ops'){
 const room=roomId+'-'+channel,v=framesFromDoc(channel);
 // ops uses two pages; catalog a small one-page frozen PUBLIC projection.
 const frameSets=channel==='ops'?[v.frames.slice(0,1),v.frames.slice(1)]:[v.frames];
 const pages=frameSets.map((frames,i)=>({chunk:i+1,firstFrameIndex:frameSets.slice(0,i).reduce((n,f)=>n+f.length,0),
  frameCount:frames.length,bytes:frames.reduce((n,f)=>n+f.length,0),sha256:pageSha(frames)}));
 const rootSha256=sha(utf8.encode(pages.map(p=>p.chunk+':'+p.sha256+'\n').join('')));
 const manifest={
  version:1,room,channel,frozenHead:head,completeToHead:true,
  expectedStateSha256:v.stateSha,expectedVectorSha256:v.vectorSha,
  ...(channel==='ops'?{expectedOpIds:v.expectedOpIds}:{
   expectedProjectedSha256:v.projectedSha,projectionVersion:'v1'}),
  totalBytes:pages.reduce((n,p)=>n+p.bytes,0),rootSha256,pages
 };
 const manifestText=JSON.stringify(manifest);
 const content=frameSets.map(frames=>JSON.stringify({frames:frames.map(x=>Buffer.from(x).toString('base64'))}));
 return {room,manifest,manifestText,pin:sha(utf8.encode(manifestText)),contents:content};
}
async function runtime({channel='ops',fill=true,overrides={}}={}){
 const frozen=freeze(channel);
 const bindings={
  F123_FROZEN_ROOM:roomId,F123_FROZEN_HEAD:head,
  WS_SERVICE_KEY:serviceKey,
  F123_FROZEN_OPS_MANIFEST_SHA256:channel==='ops'?frozen.pin:undefined,
  F123_FROZEN_CAT_MANIFEST_SHA256:channel==='cat'?frozen.pin:undefined,
  ...overrides
 };
 for(const k of Object.keys(bindings))if(bindings[k]===undefined)delete bindings[k];
 const {outputFiles}=await build({
  entryPoints:[path.join(import.meta.dirname,'../src/frozen-r2-source.mjs')],
  bundle:true,format:'esm',platform:'neutral',
  mainFields:['module','main'],conditions:['workerd','worker','browser'],
  external:['cloudflare:*'],write:false});
 const mf=new Miniflare({modules:true,script:outputFiles[0].text,
  compatibilityDate:'2026-06-01',compatibilityFlags:['nodejs_compat'],
  r2Buckets:['F123_FROZEN_R2'],bindings});
 try{await mf.ready;}catch(error){await mf.dispose();throw error;}
 const bucket=await mf.getR2Bucket('F123_FROZEN_R2');
 const pageKey=i=>objKey(frozen.room,channel,'page-'+String(i).padStart(4,'0')+'.json');
 const manifestKey=objKey(frozen.room,channel,'manifest.json');
 if(fill){
  await bucket.put(manifestKey,frozen.manifestText);
  for(let i=0;i<frozen.contents.length;i++)await bucket.put(pageKey(i+1),frozen.contents[i]);
 }
 async function request({room=frozen.room,part=1,key=serviceKey,method='POST',channelName=channel}={}){
  const init={method,headers:{'content-type':'application/json',...(key!==null?{authorization:'Bearer '+key}:{})}};
  if(method==='POST')init.body=JSON.stringify(part===1?{room,channel:channelName}:{room,channel:channelName,chunk:part});
  const r=await mf.dispatchFetch('https://internal-history-source.invalid/v1/frozen',init);
  return r;
 }
 async function readThroughExistingConsumer(){
  const env={WS_OPEN_EXISTING_QA:'1',WS_AUTHORITY_QA:'1',WS_SEPARATE_ROOMS_QA:'1',
   SALA_PILOTO:roomId,WS_SERVICE_KEY:serviceKey,
   WS_FROZEN_HISTORY_SOURCE:{fetch:async request=>{
    // The harness crosses Node → Miniflare processes; service bindings in
    // Cloudflare carry Request natively. Use a fresh plain request in Node QA.
    return mf.dispatchFetch(request.url,{
     method:request.method,headers:Object.fromEntries(request.headers),
     body:await request.text()
    });
   }}};
  return readTrustedFrozenSource({env,room:frozen.room,channel});
 }
 return {mf,bucket,request,readThroughExistingConsumer,pageKey,manifestKey,frozen,
  async close(){await mf.dispose()}};
}

test('R2 → REAL internal reader: independently pinned two-page frozen HEAD yields exact Yjs facts and state SHA',{timeout:45000},async()=>{
 const s=await runtime();
 try{
  const first=await s.request(),body=await first.json();
  assert.equal(first.status,200);
  assert.equal(body.completeToHead,false);
  assert.equal(body.manifest.chunk,1);
  const second=await s.request({part:2}),body2=await second.json();
  assert.equal(second.status,200);assert.equal(body2.completeToHead,true);
  assert.equal(body2.frozenHead,head);
  const out=await s.readThroughExistingConsumer();
  assert.equal(out.frames.length,2);
  const proof=await prepareFrozenImport(out);
  assert.equal(proof.sha256,s.frozen.manifest.expectedStateSha256);
  assert.equal(proof.eventCount,2);
 }finally{await s.close()}
});
test('same HEAD and page gives byte-identical frozen R2 response on any retry',async()=>{
 const s=await runtime();
 try{
  const a=await(await s.request({part:2})).text();
  const b=await(await s.request({part:2})).text();
  assert.equal(a,b);
 }finally{await s.close()}
});
test('without valid internal key no frozen metadata or bytes leave source; GET and wrong room denied',async()=>{
 const s=await runtime();
 try{
  for(const input of [{key:null},{key:'wrong-key'},{method:'GET'},
   {room:'b'.repeat(32)+'-ops'},{channelName:'cat'}]){
   const r=await s.request(input);
   assert.notEqual(r.status,200);
   const body=await r.text();
   assert.equal(body.includes(head),false);
   assert.equal(body.includes('sale-'),false);
  }
 }finally{await s.close()}
});
test('missing independent manifest pin fails closed even with valid R2 objects',async()=>{
 const s=await runtime({overrides:{F123_FROZEN_OPS_MANIFEST_SHA256:''}});
 try{assert.notEqual((await s.request()).status,200)}finally{await s.close()}
});
test('R2 manifest tampering or different HEAD with same pin cannot change served frozen business facts',async()=>{
 const s=await runtime();
 try{
  const m={...s.frozen.manifest,expectedOpIds:3};
  await s.bucket.put(s.manifestKey,JSON.stringify(m));
  assert.notEqual((await s.request()).status,200);
  assert.notEqual((await s.request({part:2})).status,200);
 }finally{await s.close()}
});
test('modified page bytes, invalid base64 and wrong frame count are rejected before HTTP 200',async()=>{
 const s=await runtime();
 try{
  for(const bad of [
   JSON.stringify({frames:['YWJjZA==']}),
   JSON.stringify({frames:['@@@']}),
   JSON.stringify({frames:[]})
  ]){
   await s.bucket.put(s.pageKey(2),bad);
   assert.notEqual((await s.request({part:2})).status,200);
  }
 }finally{await s.close()}
});
test('missing page or manifest denies complete history, no partial success',async()=>{
 const s=await runtime();
 try{
  await s.bucket.delete(s.pageKey(2));
  assert.notEqual((await s.request({part:2})).status,200);
  await assert.rejects(s.readThroughExistingConsumer(),/trusted frozen history unavailable/);
  await s.bucket.delete(s.manifestKey);
  assert.notEqual((await s.request()).status,200);
 }finally{await s.close()}
});
test('oversized JSON R2 page refuses before parsing, with no client-visible data',async()=>{
 const s=await runtime();
 try{
  await s.bucket.put(s.pageKey(1),'X'.repeat(4*1024*1024+1));
  assert.notEqual((await s.request()).status,200);
 }finally{await s.close()}
});
test('catalog channel accepts only independently pinned detached public catalog with no raw PIN',async()=>{
 const s=await runtime({channel:'cat'});
 try{
  const r=await s.request(),text=await r.text();
  assert.equal(r.status,200);
  assert.equal(text.includes('PRIVATE_PIN_NOT_FOR_SERVER'),false);
  assert.equal(text.includes('_meta'),false);
  const out=await s.readThroughExistingConsumer();
  const result=await prepareFrozenImport(out);
  assert.equal(result.sha256,s.frozen.manifest.expectedStateSha256);
  assert.equal(result.channel,'cat');
 }finally{await s.close()}
});
test('source cannot be used through signed reader while its QA flag is OFF',async()=>{
 const s=await runtime();
 try{
  const env={WS_OPEN_EXISTING_QA:'0',WS_AUTHORITY_QA:'1',WS_SEPARATE_ROOMS_QA:'1',
   SALA_PILOTO:roomId,WS_SERVICE_KEY:serviceKey,
   WS_FROZEN_HISTORY_SOURCE:{fetch:async request=>s.mf.dispatchFetch(request.url,{
    method:request.method,headers:Object.fromEntries(request.headers),
    body:await request.text()
   })}};
  await assert.rejects(readTrustedFrozenSource({env,room:opsRoom,channel:'ops'}),/unavailable/);
 }finally{await s.close()}
});
