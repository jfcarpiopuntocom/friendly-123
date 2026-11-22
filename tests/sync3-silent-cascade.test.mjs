import test from 'node:test';
import assert from 'node:assert/strict';
import {createSilentTransportCascade} from '../src/sync3-silent-cascade.mjs';
const route = (name, send, authority='same-do') => ({name,authority,send});

test('A to B only on definitive pre-send rejection',async()=>{
  const seen=[];
  const cascade=createSilentTransportCascade({routes:[
    route('A',async()=>{seen.push('A');return {stage:'definitively-not-sent'}}),
    route('B',async op=>{seen.push('B');return {ack:true,opId:op.opId,authority:'same-do',durable:true}})
  ]});
  assert.equal((await cascade.publish({license:'F123-TEST00000',opId:'sale_12345678'})).route,'B');
  assert.deepEqual(seen,['A','B']);
});
test('network exception never dispatches same sale to another route',async()=>{
  let calls=0;
  const cascade=createSilentTransportCascade({routes:[
    route('A',async()=>{throw Error('timeout')}),
    route('B',async()=>{calls++})
  ]});
  assert.equal((await cascade.publish({license:'F123-TEST00000',opId:'sale_12345678'})).stage,'commit-unverified');
  assert.equal(calls,0);
});
test('invalid or nondurable receipt cannot confirm',async()=>{
  const cascade=createSilentTransportCascade({routes:[
    route('A',async()=>({ack:true,opId:'sale_12345678',authority:'same-do'}))
  ]});
  assert.equal((await cascade.publish({license:'F123-TEST00000',opId:'sale_12345678'})).confirmed,false);
});
test('different commercial authorities rejected',()=>{
  assert.throws(()=>createSilentTransportCascade({routes:[
    route('A',async()=>{},'one'),route('B',async()=>{},'two')
  ]}),/authority/);
});
test('missing authority rejected',()=>{
  assert.throws(()=>createSilentTransportCascade({routes:[{name:'A',send:async()=>{}}]}),/authority/);
});
test('after A definitively fails B is used, then cooldown restores A',async()=>{
  let ready=false,clock=0;
  const cascade=createSilentTransportCascade({now:()=>clock,cooldownMs:100,routes:[
    route('A',async op=>ready?{ack:true,opId:op.opId,authority:'same-do',durable:true}:{stage:'definitively-not-sent'}),
    route('B',async op=>({ack:true,opId:op.opId,authority:'same-do',durable:true}))
  ]});
  assert.equal((await cascade.publish({license:'F123-TEST00000',opId:'sale_12345678'})).route,'B');
  assert.equal(cascade.status().active,'B');
  ready=true;
  assert.equal((await cascade.publish({license:'F123-TEST00000',opId:'sale_87654321'})).route,'B');
  clock=101;
  assert.equal((await cascade.publish({license:'F123-TEST00000',opId:'sale_22222222'})).route,'A');
  assert.equal(cascade.status().active,'A');
});

test('hung A is bounded and cannot send same sale to B', async () => {
  let backupCalls=0,aborted=false;
  const cascade=createSilentTransportCascade({timeoutMs:25,routes:[
    route('A',async (_op,signal) => {
      signal.addEventListener('abort',()=>{aborted=true;},{once:true});
      return new Promise(()=>{});
    }),
    route('B',async()=>{backupCalls++;return {stage:'definitively-not-sent'};})
  ]});
  const result=await cascade.publish({license:'F123-TEST00000',opId:'sale_timeout_12345'});
  assert.equal(result.stage,'commit-unverified');
  assert.equal(result.retryTarget,'same-authority-only');
  assert.equal(result.confirmed,false);
  assert.equal(backupCalls,0);
  assert.equal(aborted,true);
});

test('invalid route timeout rejected',()=>{
  assert.throws(()=>createSilentTransportCascade({timeoutMs:0,routes:[route('A',async()=>{})]}),/timeoutMs/);
});

test('abort listener reporting definitively-not-sent cannot bypass timeout fence', async () => {
  let backupCalls=0;
  const cascade=createSilentTransportCascade({timeoutMs:25,routes:[
    route('A',(_op,signal)=>new Promise(resolve=>{
      signal.addEventListener('abort',()=>resolve({stage:'definitively-not-sent'}),{once:true});
    })),
    route('B',async()=>{backupCalls++;return {stage:'definitively-not-sent'};})
  ]});
  const result=await cascade.publish({license:'F123-TEST00000',opId:'sale_abort_123456'});
  assert.equal(result.stage,'commit-unverified');
  assert.equal(backupCalls,0);
});

test('A and B definite pre-send rejection select C without duplicate authority',async()=>{
  const calls=[];
  const c=createSilentTransportCascade({routes:[
    route('A',async()=>{calls.push('A');return {stage:'definitively-not-sent'}}),
    route('B',async()=>{calls.push('B');return {stage:'definitively-not-sent'}}),
    route('C',async op=>{calls.push('C');return {ack:true,opId:op.opId,authority:'same-do',durable:true}})
  ]});
  assert.equal((await c.publish({license:'F123-TEST00000',opId:'sale_22223333'})).route,'C');
  assert.deepEqual(calls,['A','B','C']);
  assert.equal(c.status().active,'C');
});

test('all routes definitively unavailable returns no ACK',async()=>{
  const reject=()=>({stage:'definitively-not-sent'});
  const c=createSilentTransportCascade({routes:[
    route('A',async()=>reject()),route('B',async()=>reject()),route('C',async()=>reject())
  ]});
  assert.equal((await c.publish({license:'F123-TEST00000',opId:'sale_22224444'})).stage,'all-routes-unavailable');
  assert.equal(c.status().active,null);
});

test('ambiguous A pauses only that route for subsequent distinct opId',async()=>{
  const calls=[];
  const c=createSilentTransportCascade({now:()=>0,cooldownMs:100,routes:[
    route('A',async()=>{calls.push('A');throw Error('timeout')}),
    route('B',async op=>{calls.push('B');return {ack:true,opId:op.opId,authority:'same-do',durable:true}})
  ]});
  assert.equal((await c.publish({license:'F123-TEST00000',opId:'sale_22225555'})).stage,'commit-unverified');
  assert.equal((await c.publish({license:'F123-TEST00000',opId:'sale_22226666'})).route,'B');
  assert.deepEqual(calls,['A','B']);
});

test('missing or invalid license rejects before any transport send',async()=>{
  let sent=0;
  const c=createSilentTransportCascade({routes:[
    route('A',async()=>{sent++;return {stage:'definitively-not-sent'}})
  ]});
  await assert.rejects(c.publish({opId:'sale_12345678'}),/license/);
  await assert.rejects(c.publish({license:'another-license',opId:'sale_12345678'}),/license/);
  assert.equal(sent,0);
});
