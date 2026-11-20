// C84 RED-FIRST: an independently pinned R2-only source MUST NOT accept
// a self-attested legacy numeric Yjs frame stream (no immutable manifest).
// REAL trusted-frozen-source consumer and mature Yjs; synthetic objects only.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import * as Y from 'yjs';
import {readTrustedFrozenSource} from '../src/trusted-frozen-source.mjs';
import {prepareFrozenImport} from '../src/certified-frozen-import.mjs';

const roomId='a'.repeat(32),room=roomId+'-ops',key='synthetic-c84-private-service-key-32-bytes';
const head='c84-independent-head-20261120',sha=v=>createHash('sha256').update(v).digest('hex');
const data=()=>{
 const doc=new Y.Doc();doc.clientID=84;
 doc.getMap('eventos').set('economic-id-c84-001',{kind:'sale.record',opId:'economic-id-c84-001',amountCents:1200});
 const state=Y.encodeStateAsUpdate(doc),vector=Y.encodeStateVector(doc);doc.destroy();
 return {state,vector};
};
function source(body,{strict=false,open=true}={}){
 let calls=0;
 const env={
  SALA_PILOTO:roomId,
  WS_OPEN_EXISTING_QA:open?'1':'0',
  WS_AUTHORITY_QA:'1',WS_SEPARATE_ROOMS_QA:'1',
  WS_SERVICE_KEY:key,
  ...(strict?{WS_R2_MANIFEST_REQUIRED_QA:'1'}:{}),
  WS_FROZEN_HISTORY_SOURCE:{fetch:async request=>{
   calls++;
   assert.equal(request.headers.get('authorization'),'Bearer '+key);
   assert.equal((await request.json()).room,room);
   return Response.json(body);
  }}
 };
 return {env,get calls(){return calls}};
}
function proof(){
 const {state,vector}=data();
 const base={room,channel:'ops',frozenHead:head,completeToHead:true,
  expectedStateSha256:sha(state),expectedVectorSha256:sha(vector),expectedOpIds:1};
 const legacy={...base,frames:[Array.from(state)]};
 const wire=new Uint8Array(4+state.length),view=new DataView(wire.buffer);
 view.setUint32(0,state.length,false);wire.set(state,4);
 const pageSha=sha(wire);
 const page={...base,frames:[Buffer.from(state).toString('base64')],
  manifest:{chunk:1,chunks:1,firstFrameIndex:0,frameCount:1,bytes:state.length,
   totalBytes:state.length,sha256:pageSha,
   rootSha256:sha('1:'+pageSha+'\n')}};
 return {base,legacy,page};
}
test('C84 compatibility control: existing legacy V1 numeric frames stay usable when opt-in R2 strict mode is OFF',async()=>{
 const f=proof(),s=source(f.legacy);
 const result=await readTrustedFrozenSource({env:s.env,room,channel:'ops'});
 assert.equal(s.calls,1);
 assert.equal((await prepareFrozenImport(result)).sha256,f.base.expectedStateSha256);
});
test('C84 RED P0: R2-only strict flag refuses a legacy V1 source self-attesting complete HEAD with SHA and no pinned manifest',async()=>{
 const f=proof(),s=source(f.legacy,{strict:true});
 await assert.rejects(
  readTrustedFrozenSource({env:s.env,room,channel:'ops'}),
  /trusted frozen history unavailable/i,
  'a miswired legacy service must not claim external immutable R2 certification');
 assert.equal(s.calls,1,'one internal request with no second false HEAD request');
});
test('C84 control: real paged V2 source with consistent page/root hashes and strict R2 flag still imports unchanged Yjs',async()=>{
 const f=proof(),s=source(f.page,{strict:true});
 const result=await readTrustedFrozenSource({env:s.env,room,channel:'ops'});
 assert.equal(s.calls,1);
 assert.equal(result.frames.length,1);
 const cert=await prepareFrozenImport(result);
 assert.equal(cert.sha256,f.base.expectedStateSha256);
 assert.equal(cert.vectorSha256,f.base.expectedVectorSha256);
 assert.equal(cert.expectedOpIds,1);
});
test('C84 negative: strict mode rejects damaged paged page digest, forged root and missing manifest without partial source ACK',async()=>{
 const f=proof();
 const variants=[
  {...f.page,manifest:{...f.page.manifest,sha256:'f'.repeat(64)}},
  {...f.page,manifest:{...f.page.manifest,rootSha256:'f'.repeat(64)}},
  {...f.legacy},
  {...f.page,frames:['QUJD']}
 ];
 for(const body of variants){
  const s=source(body,{strict:true});
  await assert.rejects(
   readTrustedFrozenSource({env:s.env,room,channel:'ops'}),
   /trusted frozen history unavailable/i);
  assert.equal(s.calls,1);
 }
});
test('C84 control: QA cutover OFF denies before any R2 or legacy source network access',async()=>{
 const f=proof(),s=source(f.page,{strict:true,open:false});
 await assert.rejects(readTrustedFrozenSource({env:s.env,room,channel:'ops'}),
  /trusted frozen history unavailable/i);
 assert.equal(s.calls,0);
});
