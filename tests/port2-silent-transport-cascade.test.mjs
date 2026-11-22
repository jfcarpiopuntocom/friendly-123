import test from 'node:test';
import assert from 'node:assert/strict';
import {createSilentTransportCascade} from '../src/port2-silent-transport-cascade.mjs';

const op = Object.freeze({license:'F123-TEST00000',opId:'sale-12345678',ciphertext:'sealed'});
test('A verified durable ack: B and C untouched', async () => {
  const called = [];
  const route = id => ({
    async send(x) {called.push(id); return {ok:true, receipt:{opId:x.opId}};},
    async verify(x,r) {return r.receipt.opId === x.opId;}
  });
  const c = createSilentTransportCascade({routes:{A:route('A'),B:route('B'),C:route('C')}});
  assert.deepEqual(await c.publish(op),{accepted:true,route:'A',opId:op.opId});
  assert.deepEqual(called,['A']);
});
test('definite rejection routes A -> B silently, then A after cooldown', async () => {
  let clock=0;
  const called=[];
  const routes={
    A:{send:async()=>{called.push('A');return {definitelyNotCommitted:true};},verify:async()=>false},
    B:{send:async()=>{called.push('B');return {ok:true};},verify:async()=>true},
    C:{send:async()=>{called.push('C');return {ok:true};},verify:async()=>true}
  };
  const c=createSilentTransportCascade({routes,now:()=>clock,cooldownMs:100});
  assert.equal((await c.publish(op)).route,'B');
  assert.deepEqual(called,['A','B']);
  clock=101;
  assert.equal((await c.publish({...op,opId:'sale-87654321'})).route,'B');
  assert.deepEqual(called,['A','B','A','B']);
});
test('ambiguous delivery never sends a second sale to B or C',async()=>{
  let count=0;
  const c=createSilentTransportCascade({routes:{
    A:{send:async()=>{count++;throw new Error('timeout');},verify:async()=>true},
    B:{send:async()=>{count++;return {ok:true};},verify:async()=>true}
  }});
  assert.equal((await c.publish(op)).reason,'commit-unverified');
  assert.equal(count,1);
});
test('unverified ACK never counts as success or permits another authority',async()=>{
  let count=0;
  const c=createSilentTransportCascade({routes:{
    A:{send:async()=>{count++;return {ok:true};},verify:async()=>false},
    B:{send:async()=>{count++;return {ok:true};},verify:async()=>true}
  }});
  assert.equal((await c.publish(op)).reason,'commit-unverified');
  assert.equal(count,1);
});
test('A/B definite rejection then C verified',async()=>{
  const called=[];
  const fail=id=>({send:async()=>{called.push(id);return {definitelyNotCommitted:true};},verify:async()=>false});
  const c=createSilentTransportCascade({routes:{A:fail('A'),B:fail('B'),C:{send:async()=>{called.push('C');return {ok:true};},verify:async()=>true}}});
  assert.equal((await c.publish(op)).route,'C');
  assert.deepEqual(called,['A','B','C']);
});
test('all unavailable retains envelope without false ACK',async()=>{
  const fail=()=>({send:async()=>({definitelyNotCommitted:true}),verify:async()=>false});
  const c=createSilentTransportCascade({routes:{A:fail(),B:fail(),C:fail()}});
  assert.equal((await c.publish(op)).accepted,false);
});
