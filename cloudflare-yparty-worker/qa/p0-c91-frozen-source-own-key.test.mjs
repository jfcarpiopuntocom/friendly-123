// C91 RED-FIRST: the frozen R2 source must receive its OWN least-privilege key.
// The QA Worker's WS_SERVICE_KEY is shared with friendly123-licencias and must never be sent to the frozen source when WS_FROZEN_SOURCE_KEY is set.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import * as Y from 'yjs';
import {readTrustedFrozenSource} from '../src/trusted-frozen-source.mjs';

const roomId='c'.repeat(32),room=roomId+'-ops',authorityKey='authority-licencias-key-must-stay-home-32b',ownKey='frozen-source-own-least-privilege-key-32b';
const sha=v=>createHash('sha256').update(v).digest('hex');
function body(){
 const doc=new Y.Doc();doc.clientID=91;
 doc.getMap('eventos').set('c91',{kind:'sale.record',opId:'c91',amountCents:100});
 const state=Y.encodeStateAsUpdate(doc),vector=Y.encodeStateVector(doc);doc.destroy();
 return {room,channel:'ops',frozenHead:'c91-head-20261120',completeToHead:true,expectedStateSha256:sha(state),
  expectedVectorSha256:sha(vector),expectedOpIds:1,frames:[Array.from(state)]};
}
function env(extra){
 const seen=[];
 return {seen,env:{SALA_PILOTO:roomId,WS_OPEN_EXISTING_QA:'1',WS_AUTHORITY_QA:'1',WS_SEPARATE_ROOMS_QA:'1',WS_SERVICE_KEY:authorityKey,...extra,
  WS_FROZEN_HISTORY_SOURCE:{fetch:async request=>{seen.push(request.headers.get('authorization'));return Response.json(body());}}}};
}
test('C91 RED P0: with WS_FROZEN_SOURCE_KEY set, the frozen source gets that key and never the licencias WS_SERVICE_KEY',async()=>{
 const s=env({WS_FROZEN_SOURCE_KEY:ownKey});
 await readTrustedFrozenSource({env:s.env,room,channel:'ops'});
 assert.deepEqual(s.seen,['Bearer '+ownKey]);
 assert(!s.seen.some(h=>h.includes(authorityKey)));
});
test('C91: a short or empty own key fails closed instead of falling back to the licencias key',async()=>{
 for(const bad of ['','short-key']){
  const s=env({WS_FROZEN_SOURCE_KEY:bad});
  await assert.rejects(readTrustedFrozenSource({env:s.env,room,channel:'ops'}));
  assert.equal(s.seen.length,0);
 }
});
test('C91 compatibility: without WS_FROZEN_SOURCE_KEY the existing WS_SERVICE_KEY contract is unchanged',async()=>{
 const s=env({});
 await readTrustedFrozenSource({env:s.env,room,channel:'ops'});
 assert.deepEqual(s.seen,['Bearer '+authorityKey]);
});
