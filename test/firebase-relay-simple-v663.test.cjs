'use strict';
// v663 (2026-11-04): Firebase writes are CORS "simple" requests (POST + x-http-method-override=PUT, no JSON content
// type) so no preflight round trip is paid on each sale; reads stay plain GETs.
const { test } = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const SRC = fs.readFileSync(path.join(__dirname, '../docs/firebase-relay.js'), 'utf8');
test('v663: a durable op is written without a preflight', async () => {
  const calls = [];
  const w = { TextEncoder, JSON, Promise, Number, String, Object, Math, EventTarget, Event, MessageEvent, DOMException, URLSearchParams, setTimeout, clearTimeout, btoa, atob };
  w.window = w; vm.runInNewContext(SRC, w);
  const fetchFn = async (url, opt) => { calls.push({ url, opt }); return { ok: true, status: 200, text: async () => 'null', json: async () => null, headers: { get: () => null } }; };
  const R = w.F123FirebaseRelay.create({ fetch: fetchFn, EventSource: null });
  const ws = R.connect('wss://friendly123-sync-relay.jfcarpio.workers.dev/sala/' + 'a'.repeat(40) + '-ops');
  await new Promise(r => setTimeout(r, 30)); ws.readyState = 1;
  ws.send(JSON.stringify({ k: 'op', id: 'op-1', c: 'cipher', lam: 1 }));
  await new Promise(r => setTimeout(r, 30));
  const put = calls.find(c => /\/o\/.+\.json/.test(c.url) && c.opt && c.opt.body);
  assert.ok(put, 'op written');
  assert.equal(put.opt.method, 'POST');
  assert.match(put.url, /x-http-method-override=PUT/);
  assert.equal(Object.keys(put.opt.headers).length, 0, 'no content type: no preflight');
  assert.ok(calls.filter(c => !c.opt || !c.opt.body).every(c => !c.opt || c.opt.method === 'GET'), 'reads stay GET');
});
