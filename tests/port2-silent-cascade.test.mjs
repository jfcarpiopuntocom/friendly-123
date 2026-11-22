import test from 'node:test';
import assert from 'node:assert/strict';
import {createSilentTransportCascade} from '../src/port2-silent-cascade.mjs';

test('A then B then C, preserving opId and only accepting durable ACK', async () => {
  const seen=[];
  const cascade=createSilentTransportCascade({routes:[
    {name:'A',send:async op=>{seen.push(['A',op.opId]);throw Error('offline')}},
    {name:'B',send:async op=>{seen.push(['B',op.opId]);return {ack:false}}},
    {name:'C',send:async op=>{seen.push(['C',op.opId]);return {ack:true,opId:op.opId}}}
  ]});
  const result=await cascade.publish({opId:'sale_12345678'});
  assert.deepEqual(seen,[['A','sale_12345678'],['B','sale_12345678'],['C','sale_12345678']]);
  assert.equal(result.route,'C');
});

test('never confirms an unverified ACK',async()=>{
  const cascade=createSilentTransportCascade({routes:[{name:'A',send:async()=>({ack:true,opId:'wrong'})}]});
  assert.equal((await cascade.publish({opId:'sale_12345678'})).confirmed,false);
});

test('returns to A when available on next operation',async()=>{
  let available=false;
  const cascade=createSilentTransportCascade({routes:[
    {name:'A',send:async op=>available?{ack:true,opId:op.opId}:null},
    {name:'B',send:async op=>({ack:true,opId:op.opId})}
  ]});
  assert.equal((await cascade.publish({opId:'sale_12345678'})).route,'B');
  available=true;
  assert.equal((await cascade.publish({opId:'sale_87654321'})).route,'A');
});

test('rejects route without shared authority',()=>{
  assert.throws(()=>createSilentTransportCascade({routes:[{name:'A',authority:'one',send:async()=>{}},{name:'B',authority:'two',send:async()=>{}}]}),/authority/);
});
