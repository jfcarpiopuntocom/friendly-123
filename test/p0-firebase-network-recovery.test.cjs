'use strict';
// P0 #681: real Firebase REST adapter under deterministic synthetic failures.
// No internet, customer data, room capability or backend modifications.
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const SOURCE = fs.readFileSync(path.join(__dirname, '../docs/firebase-relay.js'), 'utf8');
const LOCATOR = 'wss://friendly123-sync-relay.jfcarpio.workers.dev/sala/' + 'a'.repeat(40) + '-y';
const wait = () => new Promise(resolve => setTimeout(resolve, 30));
const ok = () => ({ ok:true, status:200, text:async()=> 'null', json:async()=> null, headers:{get:()=>null} });
const httpError = status => ({ok:false, status, text:async()=>'', json:async()=>null, headers:{get:()=>null}});
function setup(fetchFn) {
  const w = {TextEncoder, Uint8Array, ArrayBuffer, JSON, Promise, Number, String, Object, Math,
    EventTarget, Event, MessageEvent, DOMException, URLSearchParams, setTimeout, clearTimeout,
    btoa, atob, Date};
  w.window = w;
  vm.runInNewContext(SOURCE, w);
  const adapter = w.F123FirebaseRelay.create({fetch:fetchFn, EventSource:null});
  const socket = adapter.connect(LOCATOR);
  const closes = [];
  socket.addEventListener('close', ev => closes.push({code:ev.code, reason:ev.reason}));
  return {socket, closes};
}
test('P0 RED: initial transient network rejection is a short-retry network close, not server refusal', async () => {
  const {socket, closes} = setup(async () => { throw new TypeError('synthetic network unreachable'); });
  await wait();
  assert.equal(socket.readyState,3);
  assert.equal(closes.length,1);
  assert.equal(closes[0].code,1006,'the relay selector assigns only the short 5s pause to network close 1006');
});
test('P0 RED: transient Firebase checkpoint GET after opening is not a 60s server refusal', async () => {
  let calls=0;
  const {socket, closes} = setup(async () => ++calls === 1 ? ok() : Promise.reject(new TypeError('synthetic fetch failed')));
  await wait();
  assert.equal(socket.readyState,1);
  socket.send(JSON.stringify({k:'pull',v:2,rev:0,seq:0,limit:64}));
  await wait();
  assert.equal(socket.readyState,3);
  assert.equal(closes.length,1);
  assert.equal(closes[0].code,1006);
});
test('P0: actual HTTP errors are still server refusals; 401 admission remains fail closed', async () => {
  const denied = setup(async () => httpError(401));
  await wait();
  assert.equal(denied.closes[0].code,1008);
  let calls=0;
  const refused = setup(async () => ++calls === 1 ? ok() : httpError(503));
  await wait();
  refused.socket.send(JSON.stringify({k:'pull',v:2,rev:0,seq:0,limit:64}));
  await wait();
  assert.equal(refused.closes[0].code,1011,'real HTTP 503 retains long server-refusal pause');
});
