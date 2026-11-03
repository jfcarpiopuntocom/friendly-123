'use strict';
// v654 step 5 (plan OpenCode, JFC 2026-11-03): runs the real login region of validar() (after the central check, before
// the Owner entry) in five scenarios. Set F123_AUTH_SRC=<path> to run it against another version, e.g. v653, for the RED run.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const src = fs.readFileSync(process.env.F123_AUTH_SRC || path.join(__dirname, '../docs/auth-ui.js'), 'utf8');
const start = src.indexOf('if(central==="locked")');
const end = src.indexOf('if (rolHash === "dueno") {', start);
assert.ok(start > 0 && end > start, 'login region not found');
const region = src.slice(start, end);

const LIC = 'F123-SYNTHETIC-TEST';
function run({ marker = false, flags = {}, pinsRol = null, recuperando = false, unida = false }) {
  let msg = null;
  const store = Object.assign({ f123_owned: JSON.stringify({ licenseCode: LIC, instanceId: 'synthetic-device' }) }, flags);
  const localStorage = { getItem: (k) => (k in store ? store[k] : null) };
  const window = {
    __f123JoinEspera: Date.now() - 600000, // v653's 90 s fallback already expired
    OCTienda: { esUnida: () => unida },
    OCYjs: { meta: { get: (k) => (k === 'pinsRol' ? pinsRol : null) }, canal: { recuperando } },
  };
  const fn = new Function('rolHash', 'code', 'ACTIVATION_PIN', 'central', 'joinPendienteVivo', 'window', 'localStorage', 'error',
    region + '\nreturn "entra";');
  const r = fn('dueno', '789', '789', 'unconfigured', () => marker, window, localStorage, (m) => { msg = m; });
  return r === 'entra' && !msg ? 'entra' : 'rechaza';
}

test('joining now, store PIN not arrived, recovery finished: 789 does not open', () =>
  assert.equal(run({ marker: true }), 'rechaza'));
test('device joined before v654 (no marker, no flag), store PIN is another: 789 does not open', () =>
  assert.equal(run({ pinsRol: { owner: '555' } }), 'rechaza'));
test('creator device, store PIN is 789: opens', () =>
  assert.equal(run({ pinsRol: { owner: '789' } }), 'entra'));
test('brand-new store, nothing synced yet: opens', () =>
  assert.equal(run({}), 'entra'));
test('joined device, store itself says 789: opens', () =>
  assert.equal(run({ flags: { f123_aparato_unido: LIC }, pinsRol: { owner: '789' } }), 'entra'));
