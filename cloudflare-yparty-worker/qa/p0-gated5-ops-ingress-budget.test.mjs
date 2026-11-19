// Gate D5: signed server-only history ingress MUST bound -ops at 12MiB
// BEFORE Y.applyUpdate in its privacy/causality validator. Synthetic Yjs frames.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import * as Y from 'yjs';
import {readTrustedFrozenSource} from '../src/trusted-frozen-source.mjs';

const MiB=1024*1024,license='a'.repeat(32),room=license+'-ops';
const KEY='synthetic-server-binding-credential-12345';
const sha=b=>createHash('sha256').update(b).digest('hex');
function digestPage(frames){
 const bytes=Buffer.allocUnsafe(frames.reduce((n,b)=>n+4+b.length,0));
 let off=0;
 for(const frame of frames){
  bytes.writeUInt32BE(frame.length,off);off+=4;
  Buffer.from(frame).copy(bytes,off);off+=frame.length;
 }
 return sha(bytes);
}
test('complete independently valid 13MiB -ops manifest refuses on page 1, before Yjs materialization',{timeout:50000},async()=>{
 const frames=[],doc=new Y.Doc();
 try{
  for(let i=0;i<4;i++){
   const d=new Y.Doc();d.clientID=9000+i;
   d.getMap('eventos').set('op-'+i,{kind:'sale.record',opId:'op-'+i,
    amountCents:500+i,note:'N'.repeat(3_300_000)});
   const frame=Y.encodeStateAsUpdate(d);
   assert.ok(frame.length<4*MiB,'test frame must be within trusted per-frame cap');
   Y.applyUpdate(doc,frame);
   frames.push(frame);d.destroy();
  }
  const total=frames.reduce((n,f)=>n+f.length,0);
  assert.ok(total>12*MiB&&total<24*MiB,`fixture needs 12..24 MiB, saw ${total}`);
  const chunks=[frames.slice(0,2),frames.slice(2)],hashes=chunks.map(digestPage);
  const rootSha=sha(new TextEncoder().encode(hashes.map((h,i)=>(i+1)+':'+h+'\n').join('')));
  const frozenHead='source-head-20261119',stateSha=sha(Y.encodeStateAsUpdate(doc)),vectorSha=sha(Y.encodeStateVector(doc));
  const pages=chunks.map((items,i)=>({room,channel:'ops',frozenHead,
   expectedOpIds:4,expectedStateSha256:stateSha,expectedVectorSha256:vectorSha,
   completeToHead:i===1,frames:items.map(x=>Buffer.from(x).toString('base64')),
   manifest:{chunk:i+1,chunks:2,firstFrameIndex:i*2,frameCount:2,
    bytes:items.reduce((n,f)=>n+f.length,0),totalBytes:total,
    sha256:hashes[i],rootSha256:rootSha}
  }));
  let calls=0;
  const env={WS_OPEN_EXISTING_QA:'1',WS_AUTHORITY_QA:'1',WS_SEPARATE_ROOMS_QA:'1',
   SALA_PILOTO:license,WS_SERVICE_KEY:KEY,
   WS_FROZEN_HISTORY_SOURCE:{fetch:async request=>{
    calls++;
    assert.equal(request.headers.get('authorization'),'Bearer '+KEY);
    const input=await request.json();
    return Response.json(pages[(input.chunk??1)-1]);
   }}
  };
  await assert.rejects(readTrustedFrozenSource({env,room,channel:'ops'}),/trusted frozen history unavailable/);
  assert.equal(calls,1,'must stop at declared total on first page, not decode/read page 2');
 }finally{doc.destroy();}
});
