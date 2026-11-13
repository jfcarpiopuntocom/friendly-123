'use strict';
// capa1 (13 nov 2026, JFC: «conecta con mucho cuidado»): the Cloudflare layer is used ONLY on a device flagged for QA.
// Runs the REAL docs/cloudflare-relay.js and docs/relay-selector.js in a vm with stub relays. No network.
const { test } = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const leer = f => fs.readFileSync(path.join(__dirname, '../docs', f), 'utf8');
const ROOM = 'wss://friendly123-sync-relay.jfcarpio.workers.dev/sala/abc123-ops';

function cargar(flag) {
  const store = new Map(flag ? [['f123_capa1_qa', flag]] : []);
  const abiertos = [];
  class FakeWS {
    constructor(url) { this.url = url; this.readyState = 0; this.l = {}; abiertos.push(url); }
    addEventListener(t, f) { (this.l[t] = this.l[t] || []).push(f); }
    removeEventListener() {} send() {} close() { this.readyState = 3; }
  }
  const relay = (nombre, bytes) => ({ ckptFrameBytes: bytes, connect: url => { const w = new FakeWS(nombre + ':' + url); return w; } });
  const ctx = {
    console, Date, Math, JSON, Promise, Number, String, Object, Array, Error, setTimeout, clearTimeout, EventTarget, Event,
    setInterval: () => ({ unref() {} }), clearInterval() {},
    localStorage: { getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) },
    WebSocket: FakeWS
  };
  ctx.window = ctx;
  ctx.F123Relay = relay('supabase', 768 * 1024);
  ctx.F123FirebaseRelay = relay('firebase', 768 * 1024);
  vm.createContext(ctx);
  vm.runInContext(leer('cloudflare-relay.js'), ctx);
  vm.runInContext(leer('relay-selector.js'), ctx);
  return { ctx, abiertos };
}

test('without the QA flag the cascade is the v0.7.72 one (Supabase first)', () => {
  const { ctx, abiertos } = cargar(null);
  assert.equal(ctx.F123Relay.ckptFrameBytes, 768 * 1024, 'first layer is Supabase');
  ctx.F123Relay.connect(ROOM);
  assert.ok(abiertos.length > 0);
  assert.ok(abiertos.every(u => !/relay-capa1/.test(u)), 'nothing opens on the Cloudflare layer: ' + abiertos.join(', '));
});

test('any flag value other than "1" keeps the v0.7.72 cascade', () => {
  for (const v of ['0', 'true', 'si', '']) {
    const { ctx, abiertos } = cargar(v);
    ctx.F123Relay.connect(ROOM);
    assert.ok(abiertos.every(u => !/relay-capa1/.test(u)), 'flag ' + JSON.stringify(v));
  }
});

test('with the QA flag the Cloudflare layer goes first, on its own host', () => {
  const { ctx, abiertos } = cargar('1');
  assert.equal(ctx.F123Relay.ckptFrameBytes, 256 * 1024, 'first layer is capa1');
  ctx.F123Relay.connect(ROOM);
  assert.equal(abiertos[0], 'wss://friendly123-relay-capa1.jfcarpio.workers.dev/sala/abc123-ops');
});

test('the adapter refuses any URL that is not a room of the original relay', () => {
  const { ctx } = cargar(null);
  assert.throws(() => ctx.F123CloudflareRelay.connect('wss://evil.example/sala/x'));
});
