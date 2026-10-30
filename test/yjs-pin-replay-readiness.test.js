const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const { setTimeout: delay } = require('node:timers/promises');
const { browser } = require('./helpers/browser.cjs');

async function peer(initialRole, localOwnerPin = '789') {
  const w = browser();
  delete w.JSON;
  Object.assign(w, { crypto: webcrypto, TextEncoder, TextDecoder,
    F123Relay: { connect() { throw Error('No relay in PIN replay fixture'); } },
    WebSocket: class { constructor() { throw Error('No real relay allowed'); } },
    BroadcastChannel: class { constructor() { throw Error('No cross-test channels'); } } });
  w.localStorage.setItem('f123_owned', JSON.stringify({ licenseCode: 'F123-SYNTHETIC-PIN-REPLAY' }));
  let role = initialRole;
  w.OCAuth = { rolActual: () => role };
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../docs/vendor/yjs-bundle.min.js'), 'utf8'), w);
  w.IndexeddbPersistence = class { once() {} };
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../docs/sync-yjs.js'), 'utf8'), w);
  for (let i = 0; i < 100 && w.OCYjs.estado !== 'activo'; i++) await delay(10);
  assert.equal(w.OCYjs.estado, 'activo');
  const pins = { owner: localOwnerPin, emp: '583', acct: '914' };
  w.OCSecure = {
    leerPinsVisibles: () => ({ owner: pins.owner, empleados: [pins.emp], acct: pins.acct }),
    leerPinQueAbre: () => ({ ...pins }),
    fijarOwnerPin: async value => { pins.owner = value; return true; },
    fijarEmpleadoPin: async value => { pins.emp = value; return true; },
    fijarAcctPin: async value => { pins.acct = value; return true; },
    recordarPinQueAbre() {}, leerPinsEquipo: () => ({}), guardarPinsEquipo() {}
  };
  return { w, pins, setRole(value) { role = value; } };
}

test('initial partial PIN metadata is withheld until terminal history replay', async () => {
  const local = await peer('', '789');
  local.w.OCYjs.canal.recuperando = true;
  vm.runInContext("window.OCYjs.meta.set('pinsRol', { owner: '642', emp: '583', acct: '914' })", local.w);
  local.w.OCYjs._store.aplicar();
  await delay(0);
  assert.equal(local.pins.owner, '789', 'partial old history must not be adopted');

  vm.runInContext("window.OCYjs.meta.set('pinsRol', { owner: '731', emp: '583', acct: '914' })", local.w);
  local.w.OCYjs.canal.recuperando = false;
  local.w.OCYjs._store.aplicar();
  await delay(0);
  assert.equal(local.pins.owner, '731', 'only the final replayed credential is eligible');
});

test('custom local PIN remains protected and unauthenticated seed cannot publish PIN metadata', async () => {
  const local = await peer('', '888');
  local.w.OCYjs.canal.recuperando = true;
  vm.runInContext("window.OCYjs.meta.set('pinsRol', { owner: '642', emp: '583', acct: '914' })", local.w);
  local.w.OCYjs._store.aplicar();
  await delay(0);
  assert.equal(local.pins.owner, '888', 'a custom local PIN remains protected during replay');
  local.w.OCYjs.canal.recuperando = false;
  local.w.OCYjs._store.sembrar();
  assert.equal(local.w.OCYjs.meta.get('pinsRol').owner, '642', 'locked tabs cannot re-seed a transient PIN');
  local.setRole('dueno');
  local.w.OCYjs._store.sembrar();
  assert.equal(local.w.OCYjs.meta.get('pinsRol').owner, '642',
    'logging in on an out-of-date device must not publish its old PIN');
  assert.equal(local.w.OCYjs.publicarCambioPinOwner('888'), true,
    'an explicit authenticated owner action may rotate the PIN');
  assert.equal(local.w.OCYjs.meta.get('ownerPinConfirmado'), '888',
    'explicit owner rotation is durable shared metadata');
});
