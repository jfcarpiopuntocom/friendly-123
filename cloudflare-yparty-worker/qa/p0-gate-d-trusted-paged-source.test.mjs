// Real friendly-123 Gate D2: trusted server-only signed pages, synthetic Yjs, no Firebase/customer data.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as Y from 'yjs';
import {readTrustedFrozenSource} from '../src/trusted-frozen-source.mjs';
import {prepareFrozenImport} from '../src/certified-frozen-import.mjs';
import {projectPublicCatalog} from '../src/catalog-safe-projection.mjs';

const licenseRoom='a'.repeat(32),room=licenseRoom+'-cat';
const KEY='synthetic-internal-signing-key-32bytes';
const utf8=new TextEncoder();
async function sha(bytes){
  const hash=await crypto.subtle.digest('SHA-256',bytes);
  return Array.from(new Uint8Array(hash),b=>b.toString(16).padStart(2,'0')).join('');
}
function encodePage(frames){
  const n=frames.reduce((a,b)=>a+4+b.length,0),bytes=new Uint8Array(n);
  const dv=new DataView(bytes.buffer);let off=0;
  for(const frame of frames){dv.setUint32(off,frame.length,false);off+=4;bytes.set(frame,off);off+=frame.length;}
  return bytes;
}
function b64(frame){return Buffer.from(frame).toString('base64');}
async function fixture({count=4097,malicious=false,pageSize=Math.min(4096,count-1)}={}){
  const doc=new Y.Doc();
  if(malicious)doc.getMap('_meta').set('pinsRol',{owner:'VERY_SECRET_PIN'});
  else doc.getMap('productos').set('sku1',{id:'sku1',nombre:'Book',precio:12.5,stockActual:3});
  const frame=Y.encodeStateAsUpdate(doc),state=Y.encodeStateAsUpdate(doc),vector=Y.encodeStateVector(doc);
  const sourceSha=await sha(state),vectorSha=await sha(vector);
  const projected=projectPublicCatalog({sourceDoc:doc,Y,room,channel:'cat',frozenHead:'firebase-head-20261119'});
  const projectedSha=await sha(projected.bytes);projected.doc.destroy();
  const frames=Array.from({length:count},()=>new Uint8Array(frame));
  doc.destroy();
  const frameSets=[frames.slice(0,pageSize),frames.slice(pageSize)],totalBytes=frames.reduce((a,f)=>a+f.length,0);
  const hashes=await Promise.all(frameSets.map(f=>sha(encodePage(f)))),rootSha=await sha(utf8.encode(hashes.map((h,i)=>(i+1)+':'+h+'\n').join('')));
  const pages=frameSets.map((set,i)=>({
    room,channel:'cat',frozenHead:'firebase-head-20261119',completeToHead:i===1,
    expectedStateSha256:sourceSha,expectedVectorSha256:vectorSha,
    expectedProjectedSha256:projectedSha,projectionVersion:'v1',frames:set.map(b64),
    manifest:{chunk:i+1,chunks:2,bytes:set.reduce((a,f)=>a+f.length,0),
      totalBytes,firstFrameIndex:i===0?0:pageSize,frameCount:set.length,
      sha256:hashes[i],rootSha256:rootSha}
  }));
  return {pages,sourceSha,vectorSha,count};
}
function setup(pages,opts={}){
  let requests=[],calls=0;
  const env={
    WS_OPEN_EXISTING_QA:'1',WS_AUTHORITY_QA:'1',WS_SEPARATE_ROOMS_QA:'1',
    SALA_PILOTO:licenseRoom,WS_SERVICE_KEY:KEY,
    WS_FROZEN_HISTORY_SOURCE:{fetch:async request=>{
      const input=await request.json();requests.push(input);calls++;
      assert.equal(request.headers.get('authorization'),'Bearer '+KEY);
      if(opts.statusAt===calls)return new Response('provider unavailable',{status:opts.status||401});
      const page=pages[(input.chunk||1)-1];
      return page?Response.json(page):new Response('missing page',{status:404});
    }}
  };
  return {env,requests,get calls(){return calls}};
}
test('v2 4097+ certified base64 frames arrive across two bounded internal pages and import proof validates',{timeout:20000},async()=>{
  const f=await fixture(),s=setup(f.pages);
  const out=await readTrustedFrozenSource({env:s.env,room,channel:'cat'});
  assert.equal(out.frames.length,4097,'must deliver >4096 without truncation');
  assert.equal(s.calls,2,'must read exactly two verified pages');
  assert.deepEqual(s.requests.map(x=>x.chunk??1),[1,2]);
  assert.equal(out.frozenHead,'firebase-head-20261119');
  const proof=await prepareFrozenImport(out);
  assert.equal(proof.sha256,f.sourceSha);assert.equal(proof.vectorSha256,f.vectorSha);
});
test('v1 source response stays compatible for older single-page synthetic workerd tests',async()=>{
  const d=new Y.Doc();d.getMap('products').set('item',{price:2});
  const b=Y.encodeStateAsUpdate(d),v=Y.encodeStateVector(d);d.destroy();
  const old={room,channel:'cat',frozenHead:'v1-frozen-head',completeToHead:true,
    expectedStateSha256:await sha(b),expectedVectorSha256:await sha(v),frames:[Array.from(b)]};
  const s=setup([old]);
  const out=await readTrustedFrozenSource({env:s.env,room,channel:'cat'});
  assert.equal(s.calls,1);
  assert.equal((await prepareFrozenImport(out)).sha256,old.expectedStateSha256);
});
test('401 on second page does not advertise partial history as complete',async()=>{
  const f=await fixture({count:2}),s=setup(f.pages,{statusAt:2,status:401});
  await assert.rejects(readTrustedFrozenSource({env:s.env,room,channel:'cat'}),/trusted frozen history unavailable/);
  assert.equal(s.calls,2);
});
test('second page missing or reordered: fail closed',async()=>{
  const f=await fixture({count:2});
  const swapped=structuredClone(f.pages);swapped[1].manifest.chunk=1;
  await assert.rejects(readTrustedFrozenSource({env:setup(swapped).env,room,channel:'cat'}),/trusted frozen history unavailable/);
  await assert.rejects(readTrustedFrozenSource({env:setup([f.pages[0]]).env,room,channel:'cat'}),/trusted frozen history unavailable/);
});
test('HEAD, page sha, root sha, total bytes and premature complete flag cannot be forged',async()=>{
  const f=await fixture({count:2});
  for(const mutate of [
    p=>{p[1].frozenHead='changed-head'},
    p=>{p[1].manifest.sha256='f'.repeat(64)},
    p=>{p[1].manifest.rootSha256='f'.repeat(64)},
    p=>{p[1].manifest.totalBytes+=1},
    p=>{p[1].manifest.firstFrameIndex+=1},
    p=>{p[1].manifest.frameCount+=1},
    p=>{p[0].completeToHead=true}
  ]){
    const pages=structuredClone(f.pages);mutate(pages);
    await assert.rejects(readTrustedFrozenSource({env:setup(pages).env,room,channel:'cat'}),/trusted frozen history unavailable/);
  }
});
test('v2 catalog must reject a private _meta PIN root before returning Yjs frames',async()=>{
  const f=await fixture({count:2,malicious:true});
  await assert.rejects(readTrustedFrozenSource({env:setup(f.pages).env,room,channel:'cat'}),/trusted frozen history unavailable/);
});
test('QA disabled and absent internal source fail before any network request',async()=>{
  const f=await fixture({count:2}),s=setup(f.pages);
  s.env.WS_OPEN_EXISTING_QA='0';
  await assert.rejects(readTrustedFrozenSource({env:s.env,room,channel:'cat'}),/trusted frozen history unavailable/);
  assert.equal(s.calls,0);
  s.env.WS_OPEN_EXISTING_QA='1';delete s.env.WS_FROZEN_HISTORY_SOURCE;
  await assert.rejects(readTrustedFrozenSource({env:s.env,room,channel:'cat'}),/trusted frozen history unavailable/);
});

// Isolate privacy projection's actual Yjs runtime behavior (no real personal data).
test('synthetic public catalog validator handles a decoded Y.Doc without private fields',()=>{
 const source=new Y.Doc();source.getMap('productos').set('sku1',{id:'sku1',nombre:'Book',precio:12.5,stockActual:3});
 const binary=Y.encodeStateAsUpdate(source),reopened=new Y.Doc();Y.applyUpdate(reopened,binary);
 const root=reopened.getMap('productos');assert.equal(root.size,1);assert.equal(root.get('sku1').nombre,'Book');
 const {doc:pub}=projectPublicCatalog({sourceDoc:reopened,Y});
 assert.deepEqual(root.toJSON(),pub.getMap('productos').toJSON());
 pub.destroy();reopened.destroy();source.destroy();
});

test('legacy numeric-frame catalog with real productos root cannot sneak private cost fields through v1',async()=>{
 const doc=new Y.Doc();doc.getMap('productos').set('sku1',{id:'sku1',nombre:'Book',precio:12.5,stockActual:3,costo:777,ownerPin:'SECRET_PIN'});
 const state=Y.encodeStateAsUpdate(doc),vector=Y.encodeStateVector(doc);doc.destroy();
 const body={room,channel:'cat',frozenHead:'legacy-private-catalog',completeToHead:true,
  expectedStateSha256:await sha(state),expectedVectorSha256:await sha(vector),frames:[Array.from(state)]};
 await assert.rejects(readTrustedFrozenSource({env:setup([body]).env,room,channel:'cat'}),/trusted frozen history unavailable/);
});

test('a small shop uses one-page base64 manifest without inventing a second page',async()=>{
 const f=await fixture({count:2});
 const frames=f.pages.flatMap(p=>p.frames);
 const bytes=frames.map(s=>new Uint8Array(Buffer.from(s,'base64')));
 const rawBytes=bytes.reduce((n,b)=>n+b.length,0);
 const pageSha=await sha(encodePage(bytes));
 const body={...f.pages[0],frames,completeToHead:true,
  manifest:{chunk:1,chunks:1,bytes:rawBytes,totalBytes:rawBytes,
   firstFrameIndex:0,frameCount:frames.length,
   sha256:pageSha,rootSha256:await sha(utf8.encode('1:'+pageSha+'\n'))}};
 const s=setup([body]);
 const output=await readTrustedFrozenSource({env:s.env,room,channel:'cat'});
 assert.equal(s.calls,1);
 assert.equal(output.frames.length,2);
 assert.equal((await prepareFrozenImport(output)).sha256,f.sourceSha);
});

test('429 on second page recovers by retrying the same chunk exactly once',async()=>{
 const f=await fixture({count:2}),s=setup(f.pages,{statusAt:2,status:429});
 const result=await readTrustedFrozenSource({env:s.env,room,channel:'cat'});
 assert.equal(s.calls,3);
 assert.deepEqual(s.requests.map(x=>x.chunk??1),[1,2,2]);
 assert.equal((await prepareFrozenImport(result)).sha256,f.sourceSha);
});
test('401/403 on second page are denied without any retry',async()=>{
 const f=await fixture({count:2});
 for(const code of [401,403]){
  const s=setup(f.pages,{statusAt:2,status:code});
  await assert.rejects(readTrustedFrozenSource({env:s.env,room,channel:'cat'}),/trusted frozen history unavailable/);
  assert.equal(s.calls,2);
 }
});
test('same frozen state with tampered independently declared projection SHA or version refuses',async()=>{
 const f=await fixture({count:2});
 for(const mutate of [
  pages=>{pages[0].expectedProjectedSha256='f'.repeat(64);pages[1].expectedProjectedSha256='f'.repeat(64)},
  pages=>{pages[1].expectedProjectedSha256='a'.repeat(64)},
  pages=>{pages[1].projectionVersion='unverified-v9'}
 ]){
  const pages=structuredClone(f.pages);mutate(pages);
  await assert.rejects(readTrustedFrozenSource({env:setup(pages).env,room,channel:'cat'}),/trusted frozen history unavailable/);
 }
});

test('C60 RED: numeric v1 frozen public Yjs catalog accepts semantically identical fields with reversed object key insertion order',async()=>{
 const d=new Y.Doc();
 d.getMap('productos').set('sku1',{stockActual:3,precio:12.5,nombre:'Book',id:'sku1'});
 const bytes=Y.encodeStateAsUpdate(d),vector=Y.encodeStateVector(d);
 const body={room,channel:'cat',frozenHead:'c60-reordered-valid-head-v1',completeToHead:true,
   expectedStateSha256:await sha(bytes),expectedVectorSha256:await sha(vector),frames:[Array.from(bytes)]};
 const out=await readTrustedFrozenSource({env:setup([body]).env,room,channel:'cat'});
 const verified=await prepareFrozenImport(out);
 assert.equal(verified.sha256,body.expectedStateSha256);
 assert.equal(verified.vectorSha256,body.expectedVectorSha256);
 d.destroy();
});

test('C60 RED: paged v2 frozen public Yjs catalog accepts reordered allowed keys and independent projected SHA',async()=>{
 const d=new Y.Doc();
 d.getMap('productos').set('sku1',{stockActual:3,precio:12.5,nombre:'Book',id:'sku1'});
 const bytes=Y.encodeStateAsUpdate(d),vector=Y.encodeStateVector(d),head='c60-reordered-valid-head-v2';
 const projected=projectPublicCatalog({sourceDoc:d,Y,room,channel:'cat',frozenHead:head});
 const projectedSha=await sha(projected.bytes);projected.doc.destroy();
 const pageSha=await sha(encodePage([bytes]));
 const body={room,channel:'cat',frozenHead:head,completeToHead:true,
   expectedStateSha256:await sha(bytes),expectedVectorSha256:await sha(vector),
   expectedProjectedSha256:projectedSha,projectionVersion:'v1',
   frames:[b64(bytes)],manifest:{chunk:1,chunks:1,bytes:bytes.length,
     totalBytes:bytes.length,firstFrameIndex:0,frameCount:1,
     sha256:pageSha,rootSha256:await sha(utf8.encode('1:'+pageSha+'\n'))}};
 const out=await readTrustedFrozenSource({env:setup([body]).env,room,channel:'cat'});
 const verified=await prepareFrozenImport(out);
 assert.equal(verified.sha256,body.expectedStateSha256);
 assert.equal(verified.vectorSha256,body.expectedVectorSha256);
 d.destroy();
});

test('C60 private ownerPin/costo still fail closed in both v1 numeric and v2 paged, despite valid independent SHA',async()=>{
 const d=new Y.Doc();
 d.getMap('productos').set('sku1',{stockActual:3,precio:12.5,nombre:'Book',id:'sku1',
   ownerPin:'SYNTHETIC_NEVER_EXPOSE',costo:999});
 const bytes=Y.encodeStateAsUpdate(d),vector=Y.encodeStateVector(d),head='c60-reordered-private-head';
 const p=projectPublicCatalog({sourceDoc:d,Y,room,channel:'cat',frozenHead:head});
 const projSha=await sha(p.bytes);p.doc.destroy();
 const legacy={room,channel:'cat',frozenHead:head,completeToHead:true,
   expectedStateSha256:await sha(bytes),expectedVectorSha256:await sha(vector),
   frames:[Array.from(bytes)]};
 await assert.rejects(readTrustedFrozenSource({env:setup([legacy]).env,room,channel:'cat'}),
   /trusted frozen history unavailable/);
 const pageSha=await sha(encodePage([bytes]));
 const paged={...legacy,expectedProjectedSha256:projSha,projectionVersion:'v1',
   frames:[b64(bytes)],manifest:{chunk:1,chunks:1,bytes:bytes.length,
     totalBytes:bytes.length,firstFrameIndex:0,frameCount:1,
     sha256:pageSha,rootSha256:await sha(utf8.encode('1:'+pageSha+'\n'))}};
 await assert.rejects(readTrustedFrozenSource({env:setup([paged]).env,room,channel:'cat'}),
   /trusted frozen history unavailable/);
 d.destroy();
});
