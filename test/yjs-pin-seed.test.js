const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const { setTimeout: delay } = require('node:timers/promises');
const { browser } = require('./helpers/browser.cjs');

async function peer(pins = {}) {
  const w = browser();
  delete w.JSON;
  Object.assign(w, { crypto: webcrypto, TextEncoder, TextDecoder,
    F123Relay: { connect() { throw Error('No relay in PIN fixture'); } },
    WebSocket: class { constructor() { throw Error('No real relay allowed'); } },
    BroadcastChannel: class { constructor() { throw Error('No cross-test channels'); } } });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../docs/vendor/yjs-bundle.min.js'), 'utf8'), w);
  w.IndexeddbPersistence = class { once() {} };
  w.localStorage.setItem('f123_owned', JSON.stringify({ licenseCode: 'F123-SYNTHETIC-PIN-SEED' }));
  w.OCAuth = { rolActual: () => 'dueno' };
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../docs/sync-yjs.js'), 'utf8'), w);
  for (let attempt = 0; attempt < 100 && w.OCYjs.estado !== 'activo'; attempt++) await delay(10);
  assert.equal(w.OCYjs.estado, 'activo');
  w.OCYjs.canal.recuperando = false;
  let current = { ...pins };
  w.OCSecure = {
    leerPinQueAbre: () => ({ ...current }),
    leerPinsVisibles: () => ({ owner: current.owner || '', empleados: current.emp ? [current.emp] : [], acct: current.acct || '' })
  };
  w.setSyntheticPins = value => { current = { ...value }; };
  return w;
}

test('fresh factory PINs do not seed shared pinsRol metadata', async () => {
  // These are the app's documented factory values, used only to model a fresh device.
  const fresh = await peer({ owner: '789', emp: '260', acct: '357' });
  fresh.OCYjs._store.sembrar();
  assert.equal(fresh.OCYjs.meta.get('pinsRol'), undefined);
});

test('factory local PINs cannot overwrite known synthetic custom remote PINs', async () => {
  const source = await peer();
  const fresh = await peer({ owner: '789', emp: '260', acct: '357' });
  const remote = { owner: '642', emp: '583', acct: '914' };
  vm.runInContext("window.OCYjs.meta.set('pinsRol', { owner: '642', emp: '583', acct: '914' })", source);
  fresh.Y.applyUpdate(fresh.OCYjs.doc, source.Y.encodeStateAsUpdate(source.OCYjs.doc), 'red');
  fresh.OCYjs._store.sembrar();
  assert.deepEqual(JSON.parse(JSON.stringify(fresh.OCYjs.meta.get('pinsRol'))), remote);
});

test('legitimate synthetic custom PIN edits publish all roles and preserve them on reseed', async () => {
  const owner = await peer({ owner: '642', emp: '583', acct: '914' });
  owner.OCYjs._store.sembrar();
  assert.deepEqual(JSON.parse(JSON.stringify(owner.OCYjs.meta.get('pinsRol'))), { owner: '642', emp: '583', acct: '914' });
  owner.setSyntheticPins({ owner: '731', emp: '583', acct: '914' });
  owner.OCYjs._store.sembrar();
  assert.deepEqual(JSON.parse(JSON.stringify(owner.OCYjs.meta.get('pinsRol'))), { owner: '731', emp: '583', acct: '914' });
});

test('partial custom owner PIN seed preserves remote employee and accountant PINs', async () => {
  const source = await peer();
  const device = await peer({ owner: '731', emp: '260', acct: '357' });
  vm.runInContext("window.OCYjs.meta.set('pinsRol', { owner: '731', emp: '583', acct: '914' })", source);
  device.Y.applyUpdate(device.OCYjs.doc, source.Y.encodeStateAsUpdate(source.OCYjs.doc), 'red');
  device.OCYjs._store.sembrar();
  assert.deepEqual(JSON.parse(JSON.stringify(device.OCYjs.meta.get('pinsRol'))), { owner: '731', emp: '583', acct: '914' });
});

test('invalid and demo local PINs do not replace valid remote role PINs', async () => {
  const source = await peer();
  const device = await peer({ owner: '12x', emp: '456', acct: '00?' });
  const remote = { owner: '642', emp: '583', acct: '914' };
  vm.runInContext("window.OCYjs.meta.set('pinsRol', { owner: '642', emp: '583', acct: '914' })", source);
  device.Y.applyUpdate(device.OCYjs.doc, source.Y.encodeStateAsUpdate(source.OCYjs.doc), 'red');
  device.OCYjs._store.sembrar();
  assert.deepEqual(JSON.parse(JSON.stringify(device.OCYjs.meta.get('pinsRol'))), remote);
});

test('full Yjs replay preserves custom PIN metadata through a fresh peer reseed', async () => {
  const owner = await peer({ owner: '642', emp: '583', acct: '914' });
  owner.OCYjs._store.sembrar();
  const fresh = await peer({ owner: '789', emp: '260', acct: '357' });
  fresh.Y.applyUpdate(fresh.OCYjs.doc, owner.Y.encodeStateAsUpdate(owner.OCYjs.doc), 'red');
  fresh.OCYjs._store.sembrar();
  assert.deepEqual(JSON.parse(JSON.stringify(fresh.OCYjs.meta.get('pinsRol'))), { owner: '642', emp: '583', acct: '914' });
});
