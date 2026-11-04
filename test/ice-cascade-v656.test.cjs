'use strict';
// v656: ICE cascade helper (window.F123Ice in docs/peer-sync.js). Run: node --test test/ice-cascade-v656.test.cjs
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), nc = require('node:crypto');
const docs = path.join(__dirname, '..', 'docs');

function load(cryptoObj) {
  const window = { addEventListener() {}, removeEventListener() {}, location: { href: 'http://localhost/' }, navigator: {}, crypto: cryptoObj, WebSocket: function () {}, RTCPeerConnection: function () {} };
  window.window = window;
  const ctx = vm.createContext({ window, TextEncoder, btoa, atob, Date, Promise, Uint8Array, setTimeout, clearTimeout, console, EventTarget, Event, CustomEvent: Event, document: new EventTarget(), URL, Map, Set });
  vm.runInContext(fs.readFileSync(path.join(docs, 'peer-sync.js'), 'utf8'), ctx);
  return window;
}

test('build(): STUN sin Cloudflare + TURN con HMAC-SHA1 correcto', async () => {
  const w = load(nc.webcrypto), list = await w.F123Ice.build();
  assert.equal(list.length, 3);
  assert.ok(!JSON.stringify(list).toLowerCase().includes('cloudflare'));
  assert.equal(list[0].urls, 'stun:stun.l.google.com:19302');
  assert.equal(list[1].urls, 'stun:staticauth.openrelay.metered.ca:80');
  const t = list[2];
  assert.deepEqual([...t.urls], ['turn:staticauth.openrelay.metered.ca:80', 'turn:staticauth.openrelay.metered.ca:80?transport=tcp', 'turn:staticauth.openrelay.metered.ca:443', 'turns:staticauth.openrelay.metered.ca:443?transport=tcp']);
  assert.match(t.username, /^\d+:/);
  const exp = Number(t.username.split(':')[0]), now = Date.now() / 1000;
  assert.ok(exp > now + 80000 && exp < now + 90000, 'expira en ~24 h');
  const expected = nc.createHmac('sha1', 'openrelayprojectsecret').update(t.username).digest('base64');
  assert.equal(t.credential, expected);
});

test('build(): cache de 1 hora', async () => {
  const w = load(nc.webcrypto), a = await w.F123Ice.build(), b = await w.F123Ice.build();
  assert.strictEqual(a, b);
  assert.strictEqual(w.F123Ice.cached(), a);
});

test('sin crypto.subtle devuelve solo STUN y no lanza', async () => {
  const w = load({}), list = await w.F123Ice.build();
  assert.equal(list.length, 2);
  assert.ok(list.every(e => String(e.urls).startsWith('stun:')));
  assert.ok(!JSON.stringify(list).toLowerCase().includes('cloudflare'));
});

test('estatico: sin iceServers vacio ni STUN de Cloudflare en docs/*.js', () => {
  assert.ok(!/iceServers:\s*\[\s*\]/.test(fs.readFileSync(path.join(docs, 'sync-yjs.js'), 'utf8')));
  for (const f of fs.readdirSync(docs).filter(n => n.endsWith('.js'))) {
    assert.ok(!fs.readFileSync(path.join(docs, f), 'utf8').includes('stun.cloudflare.com'), f);
  }
});
