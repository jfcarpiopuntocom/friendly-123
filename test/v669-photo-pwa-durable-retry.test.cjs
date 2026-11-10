'use strict';
// v669: Safari/PWA may return false from OCFotos.guardarPorHash without throwing.
// The Yjs photo bytes must remain visible and be retried on foreground/online.
const { test } = require('node:test');
const { createHash } = require('node:crypto');
const PHOTO='data:image/jpeg;base64,AA==';
const HASH=createHash('sha256').update(Buffer.from('AA==','base64')).digest('hex');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const SRC = fs.readFileSync(path.join(__dirname, '../docs/sync-yjs.js'), 'utf8');
const start = SRC.indexOf('  var _tVolcar = null, _fotosGuardadoPendiente = false;');
const end = SRC.indexOf('  /* SEMBRAR FOTOS AL RELAY', start);
assert.ok(start > 0 && end > start, 'extract the exact production photo-store pipeline');
const script = SRC.slice(start, end);
const settle = () => new Promise(resolve => setImmediate(resolve));

function harness({incomingHash=HASH}={}) {
  const events = [], docListeners = {}, windowListeners = {}, timers = [];
  let durable = false, alreadyStored = false, strictStored = false, attempts = 0;
  const w = {
    OCFotos: {
      tieneHash: async () => alreadyStored,
      tieneHashSoloIdb: async () => strictStored,
      hashDeDataUrl: async () => HASH,
      guardarPorHash: async () => { attempts++; return durable; }
    },
    OCSync: { hidratarFotosProductos() {} },
    addEventListener: (name, cb) => { windowListeners[name] = cb; },
    dispatchEvent: ev => events.push(ev.type)
  };
  const scope = {
    API: { fotosMap: { forEach(fn) { fn(PHOTO, incomingHash); } } },
    window: w,
    document: { hidden: false, addEventListener(name, cb) { docListeners[name] = cb; } },
    CustomEvent: class { constructor(type) { this.type = type; } },
    clearTimeout() {}, setTimeout(fn) { timers.push(fn); return timers.length; },
    Promise, _esperarFoto: p => Promise.resolve(p)
  };
  vm.createContext(scope);
  vm.runInContext(script, scope);
  return {
    scope, events, docListeners, windowListeners, timers,
    setDurable(v) { durable = v; },
    setAlreadyStored(v) { alreadyStored = v; strictStored = v; },
    setLegacyVisible(v) { alreadyStored = v; },
    setStrictStored(v) { strictStored = v; },
    attempts: () => attempts,
    pending: () => vm.runInContext('_fotosGuardadoPendiente', scope),
    flushTimer() { while (timers.length) timers.shift()(); }
  };
}

test('v669: a rejected IndexedDB write does not become a false successful photo restore', async () => {
  const h = harness();
  vm.runInContext('volcarFotosAlStore()', h.scope);
  await settle(); await settle();
  assert.equal(h.attempts(), 1);
  assert.equal(h.pending(), true, 'bytes remain pending when IDB returns false');
  assert.ok(h.events.includes('oc-fotos-actualizadas'), 'in-memory Yjs bytes are presented to the photo recovery view');
  assert.ok(h.events.includes('oc-fotos-persistencia-pendiente'), 'the failed durable save is observable');
});

test('v669: iOS foreground retries the same bytes without deleting photo evidence', async () => {
  const h = harness();
  vm.runInContext('volcarFotosAlStore()', h.scope);
  await settle(); await settle();
  h.setDurable(true);
  h.docListeners.visibilitychange();
  h.flushTimer();
  await settle(); await settle();
  assert.equal(h.attempts(), 2, 'retries the exact hash after foreground');
  assert.equal(h.pending(), false, 'successful durable save clears the pending state');
  assert.ok(h.events.filter(x => x === 'oc-fotos-actualizadas').length >= 2);
});

test('v669: an already saved photo does not issue a false photo-persistence alarm', async () => {
  const h = harness();
  h.setDurable(true);
  vm.runInContext('volcarFotosAlStore()', h.scope);
  await settle(); await settle();
  assert.equal(h.pending(), false);
  assert.equal(h.events.includes('oc-fotos-persistencia-pendiente'), false);
});

test('v669: already-saved Yjs photos notify the shelf renderer once after initial hydration', async () => {
  const h = harness();
  h.setAlreadyStored(true);
  vm.runInContext('volcarFotosAlStore()', h.scope);
  await settle(); await settle();
  assert.equal(h.attempts(), 0, 'existing image is not re-uploaded or rewritten');
  assert.equal(h.events.filter(x => x === 'oc-fotos-actualizadas').length, 1, 'late shelf pointers get a single repaint');
  assert.equal(h.pending(), false);
  vm.runInContext('volcarFotosAlStore()', h.scope);
  await settle(); await settle();
  assert.equal(h.events.filter(x => x === 'oc-fotos-actualizadas').length, 1, 'no repaint loop');
});


test('Fable P1-1 RED: rejected remote SHA cannot be persisted under a wrong hash',async()=>{
  const h=harness({incomingHash:'f'.repeat(64)});
  h.setDurable(true);
  vm.runInContext('volcarFotosAlStore()',h.scope);
  await settle();await settle();await settle();
  assert.equal(h.attempts(),0,'invalid remote hash/image pair must never reach guardarPorHash');
  assert.equal(h.pending(),false,'tampered hash is invalid evidence, not a retryable IDB quota failure');
});
test('Fable F2 RED: legacy-readable hash without an IDB copy must be copied durably',async()=>{
  const h=harness();
  h.setDurable(true);h.setLegacyVisible(true);h.setStrictStored(false);
  vm.runInContext('volcarFotosAlStore()',h.scope);
  await settle();await settle();await settle();
  assert.equal(h.attempts(),1,'a localStorage fallback is not an IDB durability ACK');
  assert.equal(h.pending(),false,'true commit clears pending without deleting old evidence');
});
