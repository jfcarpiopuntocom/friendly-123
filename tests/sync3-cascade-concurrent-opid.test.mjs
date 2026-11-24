import test from 'node:test';
import assert from 'node:assert/strict';
import {createSilentTransportCascade} from '../src/sync3-silent-cascade.mjs';

const operation = Object.freeze({opId:'sale_12345678',license:'F123-ABCDEFGH',kind:'sale.record'});

test('overlapping calls for same opId publish only once', async () => {
  let sends = 0;
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const cascade = createSilentTransportCascade({routes:[{name:'A',authority:'ledger',async send(op) {
    sends++;
    await gate;
    return {ack:true,opId:op.opId,authority:'ledger',durable:true};
  }}]});
  const first = cascade.publish(operation);
  const second = cascade.publish({...operation});
  assert.equal(first,second);
  release();
  const [a,b] = await Promise.all([first,second]);
  assert.equal(sends,1);
  assert.equal(a.confirmed,true);
  assert.equal(b.confirmed,true);
});

test('same opId with different concurrent payload fails closed', async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const cascade = createSilentTransportCascade({routes:[{name:'A',authority:'ledger',async send(op) {
    await gate;
    return {ack:true,opId:op.opId,authority:'ledger',durable:true};
  }}]});
  const first = cascade.publish(operation);
  assert.throws(() => cascade.publish({...operation,kind:'stock.adjust'}),/opId payload conflict/);
  release();
  await first;
});
