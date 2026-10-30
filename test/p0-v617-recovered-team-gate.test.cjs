'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const cryptoSource = fs.readFileSync(path.join(__dirname, '../docs/crypto-store.js'), 'utf8');
const authSource = fs.readFileSync(path.join(__dirname, '../docs/auth-ui.js'), 'utf8');
const start = cryptoSource.indexOf('  async function identificarPin(pin) {');
const end = cryptoSource.indexOf('  function limpiarLockouts()', start);
assert.ok(start > 0 && end > start);
const method = cryptoSource.slice(start, end);
const retiredStart=cryptoSource.indexOf('  async function duenoRetirado(pin, s, candidate) {');
const retiredEnd=cryptoSource.indexOf('  function pinOwnerPendienteLocal()', retiredStart);
assert.ok(retiredStart>0 && retiredEnd>retiredStart,'load production helper needed by identificarPin');
const retiredHelper=cryptoSource.slice(retiredStart,retiredEnd);

const fakeLicense = 'F123-SYNTHETIC-TEST';
function check({ pin = '432', ready = true, room = true, owner = '432', joined = true } = {}) {
  const fn = new Function('pin', 'ready', 'room', 'owner', 'joined', 'lic',
    'const window={OCTienda:{licenciaActual:()=>lic,esUnida:()=>joined},OCYjs:room?{roomId:"synthetic-room",canal:{recuperando:!ready},meta:{get:k=>k==="pinsRol"?{owner,emp:"671",acct:"128"}:null}}:null};' +
    'const localStorage={getItem:k=>k==="f123_owned"?JSON.stringify({licenseCode:lic,instanceId:"synthetic-device"}):null};' +
    'const leerSecreto=()=>null;'+ retiredHelper + method + ';return identificarPin(pin);'
  );
  return fn(pin, ready, room, owner, joined, fakeLicense);
}
test('real fully recovered team roles work without any local f123_secure', async () => {
  assert.equal(await check(), 'dueno');
  assert.equal(await check({pin:'671'}), 'empleado');
  assert.equal(await check({pin:'128'}), 'contador');
});
test('recovery and PIN grant access on the same license, whether joined or owned', async () => {
  assert.equal(await check({ready:false}), null);
  assert.equal(await check({room:false}), null);
  // An installed owned PWA and a joined browser must share the same verified
  // license. The joined flag is a UI classification, not a separate identity.
  assert.equal(await check({joined:false}), 'dueno');
  assert.equal(await check({pin:'321'}), null);
  assert.equal(await check({pin:'456',owner:'456'}), null);
  assert.equal(await check({pin:'789',owner:'789'}), null);
});
test('joined team login cannot overwrite original device owner PIN', () => {
  const at = authSource.indexOf('  async function alinearYEntrar(code, rolEntrada) {');
  const stop = authSource.indexOf('  async function validar(code)', at);
  assert.ok(at > 0 && stop > at);
  const entry = authSource.slice(at, stop);
  assert.match(entry, /recordarPinQueAbre\(code, rolEntrada\)/);
  assert.doesNotMatch(entry, /fijarOwnerPin\(code\)/,
    'login is read-only for both joined and owned notebooks');
});
test('activated businesses reject demo PIN before lockout or another shop access', () => {
  assert.match(authSource, /if \(code === DEMO_PIN && dispositivoApropiado\(\)\) \{[\s\S]*?return;/);
});

test('unrecovered team metadata shows pending without classifying the PIN as wrong', () => {
  const at = authSource.indexOf('    // A newly joined notebook with no verified owner credentials');
  const stop = authSource.indexOf('    // A licensed browser with no local verifier', at);
  assert.ok(at > 0 && stop > at);
  const readiness = authSource.slice(at, stop);
  const check = (ready, owner) => {
    const messages = [];
    const fn = new Function('window', 'error', readiness + ';return true;');
    const window = {
      OCTienda: { esUnida: () => true },
      OCYjs: { roomId: 'synthetic-room', canal: { recuperando: !ready },
        meta: { get: () => ({ owner }) } }
    };
    const ok = fn(window, msg => messages.push(msg));
    return { ok, messages };
  };
  assert.equal(check(false, '432').ok, undefined);
  assert.equal(check(false, '432').messages.length, 1);
  assert.equal(check(true, '432').ok, true);
  assert.equal(check(true, '432').messages.length, 0);
  assert.equal(check(true, '456').ok, undefined);
});
