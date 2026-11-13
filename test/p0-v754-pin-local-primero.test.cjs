'use strict';
// v754 (JFC 12 nov 2026: «entrar con el PIN que el aparato YA tiene guardado», aunque la sync siga atrasada).
// Runs the real verificarPinOwnerCentral() and the real login region of validar(). Set F123_AUTH_SRC / F123_TAB_SRC
// to run against another version (RED run on master 6f71498e).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const src = fs.readFileSync(process.env.F123_AUTH_SRC || path.join(__dirname, '../docs/auth-ui.js'), 'utf8');
const tabSrc = fs.readFileSync(process.env.F123_TAB_SRC || path.join(__dirname, '../docs/tab-session.js'), 'utf8');

const vStart = src.indexOf('  async function verificarPinOwnerCentral(code, esPinLocalDueno) {');
const vEnd = src.indexOf('  // A deliberate Owner rotation first commits', vStart);
assert.ok(vStart > 0 && vEnd > vStart, 'verificarPinOwnerCentral not found');
const verificarSrc = src.slice(vStart, vEnd);
const rStart = src.indexOf('if(central==="wrong"&&rolHash==="dueno")');
const rEnd = src.indexOf('if (rolHash === "dueno") {', rStart);
assert.ok(rStart > 0 && rEnd > rStart, 'login region not found');
const region = src.slice(rStart, rEnd);

const LIC = 'F123-SYNTHETICV754';
function central({ owned = { licenseCode: LIC, instanceId: 'synthetic-device' }, active = LIC, onLine = true, cbAbierto = false, reply = null }) {
  const data = new Map([['f123_owned', JSON.stringify(owned)]]);
  const calls = [];
  const ctx = {
    location: { hostname: 'friendly123.com' }, URL, AbortController, setTimeout, clearTimeout,
    OC_WORKER_URL: 'https://friendly123-licencias.jfcarpio.workers.dev',
    navigator: { onLine },
    _cbBloqueado: () => cbAbierto,
    localStorage: { getItem: (k) => (data.has(k) ? data.get(k) : null), setItem: (k, v) => data.set(k, String(v)) },
    fetch: async (url) => {
      calls.push(url);
      if (!reply) throw Error('synthetic network down');
      return { status: reply.status, ok: reply.status === 200, json: async () => reply.body || {} };
    },
  };
  ctx.window = { OCTienda: { licenciaActual: () => active }, OCSecure: {} };
  vm.runInNewContext(verificarSrc + '\nthis.v=verificarPinOwnerCentral;', ctx);
  return { run: () => ctx.v('555', true), calls };
}
// Device with its own saved Owner PIN (rolHash "dueno", code not 789), joined, recovery stuck (pendingStructs).
function login(centralResult, { rolHash = 'dueno', code = '555', pinsRol = null } = {}) {
  let msg = null;
  const window = { OCTienda: { esUnida: () => true }, OCYjs: { meta: { get: (k) => (k === 'pinsRol' ? pinsRol : null) }, canal: { recuperando: true } } };
  const localStorage = { getItem: (k) => (k === 'f123_owned' ? JSON.stringify({ licenseCode: LIC }) : null) };
  const fn = new Function('rolHash', 'code', 'ACTIVATION_PIN', 'central', 'joinPendienteVivo', 'window', 'localStorage', 'error',
    region + '\nreturn "entra";');
  const r = fn(rolHash, code, '789', centralResult, () => true, window, localStorage, (m) => { msg = m; });
  return r === 'entra' && !msg ? 'entra' : 'rechaza: ' + msg;
}

test('A+B: saved Owner PIN, no instanceId, sync stuck: enters (no false «identity does not match»)', async () => {
  const c = central({ owned: { licenseCode: LIC } });
  assert.equal(login(await c.run()), 'entra');
});
test('A+B: saved Owner PIN, active store license differs locally, sync stuck: enters', async () => {
  const c = central({ active: 'F123-OTHERSTORE01' });
  assert.equal(login(await c.run()), 'entra');
});
test('A+B: saved Owner PIN, license without F123- form: enters', async () => {
  const c = central({ owned: { licenseCode: 'legacy-code', instanceId: 'synthetic-device' } });
  assert.equal(login(await c.run()), 'entra');
});
test('B guard kept: the Worker explicit license-instance-mismatch still blocks the Owner', async () => {
  const c = central({ reply: { status: 404, body: { reason: 'license-instance-mismatch' } } });
  const r = await c.run();
  assert.equal(r, 'unavailable-identity');
  assert.match(login(r), /^rechaza: La identidad de la licencia no coincide/);
});
test('C: navigator.onLine===false skips /pin/verify and enters local-first', async () => {
  const c = central({ onLine: false, reply: { status: 401 } });
  const r = await c.run();
  assert.equal(c.calls.length, 0, 'no network call while offline');
  assert.equal(login(r), 'entra');
});
test('C: heartbeat breaker open skips /pin/verify', async () => {
  const c = central({ cbAbierto: true, reply: { status: 401 } });
  await c.run();
  assert.equal(c.calls.length, 0);
});
test('C guard kept: with network the central rejection of a replaced Owner PIN still blocks', async () => {
  const c = central({ reply: { status: 401 } });
  const r = await c.run();
  assert.equal(c.calls.length, 1);
  assert.equal(r, 'wrong');
  assert.match(login(r), /^rechaza:/);
});
test('limits kept: 789 on a joined store with its own PIN does not open, even offline', async () => {
  const c = central({ onLine: false });
  assert.match(login(await c.run(), { code: '789', pinsRol: { owner: '555' } }), /^rechaza:/);
  assert.match(login(await c.run(), { code: '789' }), /^rechaza:/); // store PIN not arrived: waits
});
test('D: tab-session boots without crypto.randomUUID (iOS Safari < 15.4)', () => {
  const store = new Map();
  const ctx = {
    crypto: {}, console, setTimeout, clearTimeout, setInterval, clearInterval,
    localStorage: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) },
    sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    document: { addEventListener() {}, getElementById: () => null, readyState: 'complete', visibilityState: 'visible', createElement: () => ({ style: {}, setAttribute() {}, appendChild() {} }), body: { appendChild() {} }, head: { appendChild() {} } },
    addEventListener() {}, location: { href: 'https://friendly123.com/app/' }, navigator: {},
  };
  ctx.window = ctx; ctx.globalThis = ctx;
  assert.doesNotThrow(() => vm.runInNewContext(tabSrc, ctx));
});
