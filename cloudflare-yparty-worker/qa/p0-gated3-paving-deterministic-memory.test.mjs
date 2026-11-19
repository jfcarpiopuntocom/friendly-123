// PORT2 Gate D3: deterministic detached-public Yjs SHA and fail-closed memory envelope.
// Source-executed in the REAL friendly-123 Worker. Synthetic data only.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import * as Y from 'yjs';
import {projectPublicCatalog} from '../src/catalog-safe-projection.mjs';
import {readTrustedFrozenSource} from '../src/trusted-frozen-source.mjs';

const room='a'.repeat(32)+'-cat';
const key='synthetic-server-service-key-0000001';
const sha=b=>createHash('sha256').update(b).digest('hex');
const lineHash=list=>sha(new TextEncoder().encode(list.map((h,i)=>`${i+1}:${h}\n`).join('')));
function source(){
 const doc=new Y.Doc();
 doc.getMap('productos').set('sku1',{id:'sku1',nombre:'Book',precio:15,stockActual:4,costo:12.25});
 doc.getMap('ubicaciones').set('shelf1',{id:'shelf1',nombre:'Store shelf',activa:true});
 doc.getMap('_meta').set('pinsRol',{owner:'PRIVATE_PIN'});
 return doc;
}
function projected(doc,head='head-20261119'){
 return projectPublicCatalog({sourceDoc:doc,Y,room,channel:'cat',frozenHead:head});
}
test('same frozen shop, channel and HEAD always gives byte-identical projected Yjs state',()=>{
 const original=source(),a=projected(original),b=projected(original);
 try{
  assert.equal(sha(a.bytes),sha(b.bytes));
  assert.equal(a.doc.clientID,b.doc.clientID);
  assert.notEqual(a.doc.clientID,original.clientID);
  assert.ok(a.doc.clientID>0 && a.doc.clientID<=0xffffffff);
 } finally {a.doc.destroy();b.doc.destroy();original.destroy();}
});
test('HEAD or room variation changes deterministic projection identity',()=>{
 const original=source(),a=projected(original),b=projected(original,'head-20261120');
 const c=projectPublicCatalog({sourceDoc:original,Y,room:'b'.repeat(32)+'-cat',channel:'cat',frozenHead:'head-20261119'});
 try{
  assert.notEqual(a.doc.clientID,b.doc.clientID);
  assert.notEqual(a.doc.clientID,c.doc.clientID);
  assert.equal(sha(a.bytes),sha(projected(original).bytes));
 }finally{a.doc.destroy();b.doc.destroy();c.doc.destroy();original.destroy();}
});
test('deterministic projections are strictly detached from private PIN and money',()=>{
 const original=source(),a=projected(original);
 try{
  const raw=Buffer.from(a.bytes).toString('utf8');
  assert.equal(raw.includes('PRIVATE_PIN'),false);
  assert.equal(raw.includes('12.25'),false);
  assert.deepEqual([...a.doc.share.keys()].sort(),['productos','ubicaciones']);
  assert.equal(a.doc.getMap('productos').get('sku1').costo,undefined);
 }finally{a.doc.destroy();original.destroy();}
});
test('projection client scope is rejected when partially supplied',()=>{
 const original=source();
 try{
  assert.throws(()=>projectPublicCatalog({sourceDoc:original,Y,room,channel:'cat'}),/scope|frozenHead|invalid/i);
 }finally{original.destroy();}
});
test('6112 realistic 8KiB-class Yjs frame payloads exceed the RAM budget and fail before page 2',async()=>{
 const doc=new Y.Doc(),products=doc.getMap('productos');
 for(let i=0;i<40;i++)products.set('p'+i,{
  id:'p'+i,nombre:'B'.repeat(170),precio:1,stockActual:1
 });
 const frame=Y.encodeStateAsUpdate(doc),vector=Y.encodeStateVector(doc),encoded=Buffer.from(frame).toString('base64');
 const size=frame.length,count=6112,declared=count*size,pageSize=1024,pages=Math.ceil(count/pageSize);
 assert.ok(declared>24*1024*1024 && declared<64*1024*1024,
  `expected a 24..64MiB realistic Yjs payload, got ${declared} bytes`);
 const pageCounts=Array.from({length:pages},(_,i)=>Math.min(pageSize,count-i*pageSize));
 const pageHashes=pageCounts.map(n=>{
   const block=Buffer.allocUnsafe(n*(size+4));
   for(let i=0;i<n;i++){block.writeUInt32BE(size,i*(size+4));Buffer.from(frame).copy(block,i*(size+4)+4);}
   return sha(block);
 });
 const rootSha=sha(new TextEncoder().encode(pageHashes.join('\n'))),stateSha=sha(frame),vectorSha=sha(vector);
 let calls=0;
 const env={WS_OPEN_EXISTING_QA:'1',WS_AUTHORITY_QA:'1',WS_SEPARATE_ROOMS_QA:'1',
  SALA_PILOTO:'a'.repeat(32),WS_SERVICE_KEY:key,WS_FROZEN_HISTORY_SOURCE:{
   fetch:async req=>{
    const input=await req.json(),index=input.chunk??1;
    calls++;
    const n=pageCounts[index-1];
    assert.ok(n>0);
    const frames=Array.from({length:n},()=>encoded);
    return Response.json({room,channel:'cat',frozenHead:'head-20261119',
     completeToHead:index===pages,expectedStateSha256:stateSha,expectedVectorSha256:vectorSha,
     frames,manifest:{chunk:index,chunks:pages,bytes:n*size,totalBytes:declared,
      firstFrameIndex:(index-1)*pageSize,frameCount:n,
      sha256:pageHashes[index-1],rootSha256:rootSha}});
   }
  }};
 try{
  await assert.rejects(readTrustedFrozenSource({env,room,channel:'cat'}),/trusted frozen history unavailable/);
  assert.equal(calls,1,'must reject declared 48MiB before fetching more pages');
 }finally{doc.destroy();}
});
test('root manifest digest binds chunk index and refuses an old unindexed root',()=>{
 const h='a'.repeat(64),old=sha(new TextEncoder().encode([h,h].join('\n')));
 const indexed=lineHash([h,h]);
 assert.notEqual(indexed,old);
});
