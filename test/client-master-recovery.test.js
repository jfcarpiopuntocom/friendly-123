const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');

const file = path.join(__dirname, '..', 'docs', 'crypto-store.js');
const source = fs.readFileSync(file, 'utf8');
function run(online = true) {
  const values = new Map([['f123_owned', JSON.stringify({ instanceId: 'fixture-device' })]]);
  const calls = [];
  const store = { getItem: k => values.has(k) ? values.get(k) : null,
    setItem: (k, v) => values.set(k, String(v)), removeItem: k => values.delete(k) };
  const window = {};
  const context = { window, localStorage: store, crypto: webcrypto, self: { isSecureContext: true, crypto: webcrypto },
    location: { hostname: 'fixture.invalid' }, TextEncoder, TextDecoder, btoa, atob,
    console: { warn() {} }, fetch: async (url, options) => {
      calls.push({ url, body: JSON.parse(options.body) });
      if (!online) throw new Error('offline fixture');
      return { ok: true, async json() { return { ok: true }; } };
    } };
  vm.runInNewContext(source, context, { filename: file });
  return { api: window.OCSecure, values, calls };
}

test('server permit verifies the intended device without embedding a universal default', async () => {
  const fixture = run();
  assert.equal(await fixture.api.verificarMaestro('fixture-token'), true);
  assert.equal(fixture.calls.length, 1);
  assert.equal(fixture.calls[0].body.instanceId, 'fixture-device');
  assert.equal(fixture.values.get('f123_lord'), '1');
  assert.doesNotMatch(source, /MASTER_CODE_DEFAULT/);
});

test('offline without a custom hash fails closed; an existing custom hash still works', async () => {
  const fixture = run(false);
  assert.equal(await fixture.api.verificarMaestro('fixture-token'), false);
  assert.equal(fixture.values.get('f123_lord'), undefined);
  const digest = await webcrypto.subtle.digest('SHA-256', new TextEncoder().encode('oc-master:fixture-custom-code'));
  fixture.values.set('f123_secure', JSON.stringify({ masterHash: btoa(String.fromCharCode(...new Uint8Array(digest))) }));
  assert.equal(await fixture.api.verificarMaestro('fixture-custom-code'), true);
});
