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
  assert.equal(owner.OCYjs.publicarCambioPinOwner('731'), true);
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


test('E4: a stale authenticated owner peer cannot overwrite a newer shared name on equal revision', async () => {
  const current = await peer();
  const stale = await peer();
  const catalog = (w, name, rev, ts) => {
    const original = w.OCSync.catalogoPropio;
    w.OCSync.catalogoPropio = () => ({ ...original(), nombreNegocio: name,
      nombreNegocioRev: rev, nombreNegocioTs: ts });
  };
  catalog(current, '17 de Septiembre', 7, 1000);
  current.OCYjs._store.sembrar();
  stale.Y.applyUpdate(stale.OCYjs.doc, current.Y.encodeStateAsUpdate(current.OCYjs.doc), 'red');
  assert.equal(stale.OCYjs.meta.get('nombreNegocio'), '17 de Septiembre');
  catalog(stale, 'My small shop USA', 7, 999999);
  stale.OCYjs._store.sembrar();
  assert.equal(stale.OCYjs.meta.get('nombreNegocio'), '17 de Septiembre',
    'equal revisions must never let a stale phone overwrite the owner name even with a future timestamp');
  catalog(stale, 'New owner rename', 8, 1000000);
  stale.OCYjs._store.sembrar();
  assert.equal(stale.OCYjs.meta.get('nombreNegocio'), 'New owner rename',
    'a higher authenticated owner revision must still publish');
});

test('P0 v621: a stale owner device cannot re-publish an old custom PIN over the recovered notebook', async () => {
  const source = await peer();
  const stale = await peer({ owner: '642', emp: '583', acct: '914' });
  vm.runInContext("window.OCYjs.meta.set('pinsRol', { owner: '731', emp: '583', acct: '914' })", source);
  stale.Y.applyUpdate(stale.OCYjs.doc, source.Y.encodeStateAsUpdate(source.OCYjs.doc), 'red');
  stale.OCYjs._store.sembrar();
  assert.equal(stale.OCYjs.meta.get('pinsRol').owner, '731',
    'an old phone must not resurrect a retired owner PIN during a routine catalog scan');
});

test('P0 v621: only deliberate owner PIN rotation publishes a replacement; catalog/data stay untouched', async () => {
  const owner = await peer({ owner: '642', emp: '583', acct: '914' });
  owner.OCYjs._store.sembrar();
  const before = JSON.parse(JSON.stringify(owner.OCYjs.meta.get('pinsRol')));
  assert.equal(typeof owner.OCYjs.publicarCambioPinOwner, 'function');
  assert.equal(owner.OCYjs.publicarCambioPinOwner('731'), true);
  const after = JSON.parse(JSON.stringify(owner.OCYjs.meta.get('pinsRol')));
  assert.deepEqual(after, { ...before, owner: '731' });
  owner.setSyntheticPins({ owner: '642', emp: '583', acct: '914' });
  owner.OCYjs._store.sembrar();
  assert.equal(owner.OCYjs.meta.get('pinsRol').owner, '731',
    'old local state must not overwrite an expressly rotated owner PIN');
  const fresh = await peer({ owner: '789', emp: '260', acct: '357' });
  fresh.Y.applyUpdate(fresh.OCYjs.doc, owner.Y.encodeStateAsUpdate(owner.OCYjs.doc), 'red');
  assert.equal(fresh.OCYjs.meta.get('pinsRol').owner, '731',
    'the same notebook must transmit the deliberately rotated owner PIN');
  assert.equal(fresh.OCYjs.meta.get('ownerPinConfirmado'), '731',
    'explicit owner PIN intent survives inside the same Y.Doc');
  // A legacy shell can still modify only pinsRol; new devices must retain
  // the explicit credential and never adopt this outdated legacy field.
  vm.runInContext("window.OCYjs.meta.set('pinsRol', { owner: '642', emp: '583', acct: '914' })", fresh);
  assert.equal(fresh.OCYjs.meta.get('ownerPinConfirmado'), '731');
  fresh.OCYjs._store.sembrar();
  assert.equal(fresh.OCYjs.meta.get('ownerPinConfirmado'), '731');
});

test('v632: a later authorized A-B-A return increments the shared revision, and a stale B retry is fenced', async () => {
  const pc=await peer({owner:'642',emp:'583',acct:'914'});
  pc.OCYjs._store.sembrar();
  assert.equal(pc.OCYjs.publicarCambioPinOwner('731',0),true);
  assert.equal(pc.OCYjs.meta.get('ownerPinCambioRev'),1);
  const phone=await peer({owner:'731',emp:'583',acct:'914'});
  phone.Y.applyUpdate(phone.OCYjs.doc,pc.Y.encodeStateAsUpdate(pc.OCYjs.doc),'red');
  assert.equal(phone.OCYjs.meta.get('ownerPinCambioRev'),1);
  assert.equal(phone.OCYjs.publicarCambioPinOwner('642',1),true);
  assert.equal(phone.OCYjs.meta.get('ownerPinCambioRev'),2);
  pc.Y.applyUpdate(pc.OCYjs.doc,phone.Y.encodeStateAsUpdate(phone.OCYjs.doc),'red');
  assert.equal(pc.OCYjs.meta.get('ownerPinConfirmado'),'642');
  assert.equal(pc.OCYjs.meta.get('ownerPinCambioRev'),2);
  assert.equal(pc.OCYjs.publicarCambioPinOwner('731',0),false);
  assert.equal(pc.OCYjs.publicarCambioPinOwner('731',1),false);
  assert.equal(pc.OCYjs.meta.get('ownerPinConfirmado'),'642');
  assert.equal(pc.OCYjs.meta.get('pinsRol').emp,'583');
  assert.equal(pc.OCYjs.meta.get('pinsRol').acct,'914');
});
