'use strict';
// P0 #681 · Regression against the actual shipped Firebase adapter, no live network.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SOURCE = fs.readFileSync(path.join(__dirname,'../docs/firebase-relay.js'),'utf8');
const LOCATOR = 'wss://friendly123-sync-relay.jfcarpio.workers.dev/sala/'+'a'.repeat(40)+'-y';
const pause = () => new Promise(resolve => setTimeout(resolve, 60));
const response = (data, status = 200) => ({
  ok: status >= 200 && status < 300, status,
  text: async () => JSON.stringify(data), json: async () => data, headers: {get: () => null}
});
function app(fetchFn) {
  const w = {TextEncoder, TextDecoder, Uint8Array, ArrayBuffer, JSON, Promise, Number, String, Object, Math,
    EventTarget, Event, MessageEvent, DOMException, URLSearchParams, setTimeout, clearTimeout, btoa, atob, Date};
  w.window=w;
  vm.runInNewContext(SOURCE,w);
  const relay=w.F123FirebaseRelay.create({fetch:fetchFn, EventSource:null});
  const ws=relay.connect(LOCATOR), closes=[], events=[];
  ws.addEventListener('close', ev=>closes.push({code:ev.code,reason:ev.reason}));
  ws.addEventListener('message', ev=>events.push(ev.data));
  return {ws, closes, events};
}

test('P0 RED: a single transient GET failure on Firebase room probe recovers on one bounded read retry', async () => {
  let reads=0;
  const a=app(async (_url, opt) => {
    assert.equal(opt.method,'GET');
    if (++reads===1) throw new TypeError('transient network failure');
    return response(null);
  });
  await pause();
  assert.equal(a.ws.readyState,1,'a new device must not discard a usable relay because first GET failed');
  assert.deepEqual(a.closes,[]);
  assert.equal(reads,2,'exactly one GET retry');
});

test('P0 RED: failed checkpoint GET in pull retries once and emits one complete cursor without duplicate frames', async () => {
  let kReads=0, oReads=0;
  const encrypted=Buffer.from('synthetic-yjs-frame').toString('base64');
  const a=app(async (url,opt)=>{
    assert.equal(opt.method,'GET');
    if (url.includes('/k.json')) {
      if (++kReads===2) throw new TypeError('transient checkpoint read outage');
      return response(null);
    }
    if (url.includes('/o.json')) {
      oReads++;
      return response({op1:{s:17,c:encrypted,lam:0}});
    }
    throw Error('unexpected synthetic URL');
  });
  await pause();
  assert.equal(a.ws.readyState,1);
  a.ws.send(JSON.stringify({k:'pull',v:2,rev:0,seq:0,limit:12}));
  await pause();
  assert.equal(a.ws.readyState,1,'checkpoint read should not drop healthy socket');
  assert.equal(kReads,3,'initial GET, failed pull GET and one retry');
  assert.equal(oReads,1,'do not refetch or duplicate operation page');
  const receipts=a.events.filter(x=>typeof x==='string').map(JSON.parse).filter(x=>x.k==='pull-page');
  assert.equal(receipts.length,1);
  assert.equal(receipts[0].n,1);
  assert.equal(receipts[0].seq,17,'cursor follows a complete validated frame');
  assert.equal(a.events.filter(x=>x instanceof ArrayBuffer).length,1,'encrypted frame emitted once');
  assert.equal(a.closes.length,0);
});

test('P0 RED: persistent network failure gets one retry only then returns short 1006 fail-closed', async () => {
  let calls=0;
  const a=app(async()=>{calls++;throw new TypeError('still offline');});
  await pause();
  assert.equal(calls,2,'bounded retries, never spin while offline');
  assert.equal(a.ws.readyState,3);
  assert.equal(a.closes[0].code,1006);
});

test('P0 control: POST durable operation is NEVER retried after an ambiguous network failure', async () => {
  let writes=0;
  const a=app(async (_url,opt)=>{
    if(opt.method==='POST'){writes++;throw new TypeError('write acknowledgement lost');}
    return response(null);
  });
  await pause();
  assert.equal(a.ws.readyState,1);
  a.ws.send(JSON.stringify({k:'op',id:'synthetic-op',c:'YWJj',lam:1,ack:1}));
  await pause();
  assert.equal(writes,1,'must not duplicate append-only money/stock writes');
  assert.equal(a.ws.readyState,3);
  assert.equal(a.closes[0].code,1006);
  assert.equal(a.events.filter(x=>typeof x==='string').map(JSON.parse).filter(x=>x.k==='persist-result').length,0,
    'no false durable ACK after ambiguous write');
});

test('P0 control: explicit HTTP 401 and 503 never retry, preserving fail-closed admission and server refusal', async () => {
  for(const [status,code] of [[401,1008],[503,1011]]) {
    let calls=0;
    const a=app(async()=>{calls++;return response(null,status);});
    await pause();
    assert.equal(calls,1,'HTTP response is not a network failure');
    assert.equal(a.ws.readyState,3);
    assert.equal(a.closes[0].code,code);
  }
});
