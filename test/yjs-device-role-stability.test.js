const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const { setTimeout: delay } = require('node:timers/promises');
const { browser } = require('./helpers/browser.cjs');

const DEVICE = 'synthetic-shared-device';
const LICENSE = 'SYNTHETIC-DEVICE-ROLE-STABILITY';

async function peer(initialRole, nickname = 'Desk') {
  const w = browser();
  delete w.JSON;
  Object.assign(w, { crypto: webcrypto, TextEncoder, TextDecoder,
    F123Relay: { connect() { throw Error('No relay in device-role fixture'); } },
    WebSocket: class { constructor() { throw Error('No production relay in device-role fixture'); } } });
  w.localStorage.setItem('f123_owned', JSON.stringify({ licenseCode: LICENSE }));
  w.localStorage.setItem('f123_micelio_yo', JSON.stringify({ id: DEVICE, apodo: nickname }));
  let role = initialRole;
  w.OCAuth = { rolActual: () => role };
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../docs/micelio-vivo.js'), 'utf8'), w);
  w.OCSync.catalogoPropio = () => ({ dispositivos: [{
    id: String(w.OCMicelio.yo().id),
    apodo: String(w.OCMicelio.miApodo()),
    rol: String(w.OCAuth.rolActual() || '')
  }] });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../docs/vendor/yjs-bundle.min.js'), 'utf8'), w);
  w.IndexeddbPersistence = class { once() {} };
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../docs/sync-yjs.js'), 'utf8'), w);
  for (let i = 0; i < 100 && w.OCYjs.estado !== 'activo'; i++) await delay(10);
  assert.equal(w.OCYjs.estado, 'activo');
  for (let i = 0; i < 100 && !w.OCYjs._store; i++) await delay(10);
  assert(w.OCYjs._store, 'store bridge should be available');
  return { w, setRole(value) { role = value; } };
}

function transfer(from, to) {
  to.w.Y.applyUpdate(to.w.OCYjs.doc, from.w.Y.encodeStateAsUpdate(from.w.OCYjs.doc), 'red');
}

function profile(peer) {
  return peer.w.OCYjs.mapas.dispositivos.get(DEVICE);
}

test('locked same-device reseeds preserve the last known authenticated role without emitting updates', async () => {
  const owner = await peer('dueno');
  const locked = await peer('');
  owner.w.OCYjs._store.sembrar();
  transfer(owner, locked);
  assert.equal(profile(locked).rol, 'dueno');

  let updates = 0;
  locked.w.OCYjs.doc.on('update', (_update, origin) => { if (origin === 'seed') updates++; });
  for (let i = 0; i < 10; i++) locked.w.OCYjs._store.sembrar();

  assert.equal(profile(locked).rol, 'dueno', 'an unauthenticated/locked tab cannot erase the known device role');
  assert.equal(updates, 0, 'unchanged locked profile must not create relay outbox traffic');
});

test('an explicit authenticated role change still publishes to the peer', async () => {
  const owner = await peer('dueno');
  const admin = await peer('empleado');
  owner.w.OCYjs._store.sembrar();
  transfer(owner, admin);
  admin.w.OCYjs._store.sembrar();
  assert.equal(profile(admin).rol, 'empleado');

  transfer(admin, owner);
  assert.equal(profile(owner).rol, 'empleado', 'the authorized current role remains shared');
});

test('nickname changes publish while locked and retain the last known role', async () => {
  const authenticated = await peer('admin');
  const locked = await peer('');
  authenticated.w.OCYjs._store.sembrar();
  transfer(authenticated, locked);
  locked.w.OCMicelio.ponerApodo('Desk renamed');
  locked.w.OCYjs._store.sembrar();

  assert.deepEqual({ apodo: profile(locked).apodo, rol: profile(locked).rol },
    { apodo: 'Desk renamed', rol: 'admin' }, 'a locked nickname edit must retain the known role');
  transfer(locked, authenticated);
  assert.deepEqual({ apodo: profile(authenticated).apodo, rol: profile(authenticated).rol },
    { apodo: 'Desk renamed', rol: 'admin' });
});
