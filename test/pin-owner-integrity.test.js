const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');

function secureFixture() {
  const entries = new Map();
  let rejectSecure = false;
  const localStorage = {
    get length() { return entries.size; },
    key(i) { return [...entries.keys()][i] ?? null; },
    getItem(k) { return entries.get(k) ?? null; },
    setItem(k, v) {
      if (rejectSecure && k === 'f123_secure') throw new Error('quota');
      entries.set(k, String(v));
    },
    removeItem(k) { entries.delete(k); },
  };
  const window = {};
  const context = { window, localStorage, crypto: webcrypto, self: { isSecureContext: true, crypto: webcrypto },
    location: { hostname: 'localhost' }, TextEncoder, TextDecoder, btoa, atob, console };
  const source = process.env.F123_CRYPTO_TEST_SOURCE || require.resolve('../docs/crypto-store.js');
  vm.runInNewContext(fs.readFileSync(source, 'utf8'), context);
  return { secure: window.OCSecure, localStorage, reject: () => { rejectSecure = true; } };
}

test('owner can replace initial 789 with a personal PIN', async () => {
  const f = secureFixture();
  assert.equal(await f.secure.guardarSecreto('789', ['260'], '357', 'owner@example.invalid'), true);
  assert.equal(await f.secure.fijarOwnerPin('682'), true);
  assert.equal(await f.secure.verificarOwner('682'), true);
  assert.equal(await f.secure.verificarOwner('789'), false);
  assert.equal(f.secure.leerCorreo(), 'owner@example.invalid');
});

test('full storage rejects PIN change without deleting a photo or the old credential', async () => {
  const f = secureFixture();
  assert.equal(await f.secure.guardarSecreto('789', ['260'], '357', ''), true);
  f.localStorage.setItem('vp_foto_percha_fixture', 'photo bytes');
  f.reject();
  assert.equal(await f.secure.fijarOwnerPin('682'), false);
  assert.equal(f.localStorage.getItem('vp_foto_percha_fixture'), 'photo bytes');
  assert.equal(await f.secure.verificarOwner('789'), true);
  assert.equal(await f.secure.verificarOwner('682'), false);
});

test('rotating owner PIN retires the former PIN even when directory and team sidecars retain it', async () => {
  const f = secureFixture();
  assert.equal(await f.secure.guardarSecreto('789', ['260'], '357', ''), true);
  assert.equal(f.secure.guardarDirectorio({ owner: { pin: '789', nombre: 'Owner' } }), true);
  f.secure.recordarPinQueAbre('789', 'dueno');
  assert.equal(f.secure.guardarPinsEquipo({ owner: '789' }), true);
  assert.equal(await f.secure.fijarOwnerPin('682'), true);
  f.secure.recordarPinQueAbre('682', 'dueno');
  assert.equal(await f.secure.identificarPin('682'), 'dueno');
  assert.equal(await f.secure.identificarPin('789'), null);
  const secret = JSON.parse(f.localStorage.getItem('f123_secure'));
  assert.ok(secret.retiredOwnerHashes.length > 0);
  assert.ok(secret.retiredOwnerHashes.every((hash) => hash !== '789'));
});
