'use strict';
// v769 (JFC 13 nov 2026, measured in the real store with the published app and a new device): a PIN typed before the
// team PINs arrived fell into "Your store's name and team PINs have not finished synchronizing" and was DISCARDED.
// Now it waits in memory (pinEnEspera) and is validated ONCE when Y.canal.accesoListo() is true.
// Real source regions of docs/auth-ui.js; synthetic data only. F123_AUTH_SRC runs it against another version
// (RED on master 408349e6: the waiting block and canalAccesoListo do not exist, and the branch uses recuperando).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const authSrc = fs.readFileSync(process.env.F123_AUTH_SRC || path.join(__dirname, '../docs/auth-ui.js'), 'utf8');
function entre(a, b) {
  const i = authSrc.indexOf(a), j = authSrc.indexOf(b, i + 1);
  assert.ok(i > 0 && j > i, 'region not found: ' + a);
  return authSrc.slice(i, j);
}
const bloqueEspera = () => entre('  const PIN_ESPERA_MAX_MS', '  async function validar(');
const ramaEquipo = () => entre('    // A newly joined notebook with no verified owner credentials', '    // A licensed browser with no local verifier');
const MSG = "Your store's name and team PINs have not finished synchronizing. No incorrect PIN attempt has been recorded.";

// ---- The "not finished synchronizing" branch of validar() ----
function rama({ code = '555', esReintento = false, recuperando = true, accesoListo = false, owner = '555' } = {}) {
  const out = { msg: null, guardado: null };
  const window = {
    OCTienda: { esUnida: () => true },
    OCYjs: { roomId: 'r', canal: { recuperando, accesoListo: () => accesoListo }, meta: { get: k => (k === 'pinsRol' ? { owner } : null) } },
  };
  const canalAccesoListo = new Function('return ' + entre('function canalAccesoListo(', '  function soltarPinEnEspera()').trim())();
  const fn = new Function('window', 'joinPendienteVivo', 'canalAccesoListo', 'error', 'guardarPinEnEspera', 'code', 'esReintento',
    ramaEquipo() + '\nreturn "pasa";');
  const r = fn(window, () => false, canalAccesoListo, m => { out.msg = m; }, c => { out.guardado = c; }, code, esReintento);
  out.r = r;
  return out;
}

test('aparato no listo: mismo mensaje de siempre y el PIN queda esperando en memoria', () => {
  const o = rama();
  assert.equal(o.r, undefined);
  assert.equal(o.msg, MSG);
  assert.equal(o.guardado, '555');
});
test('el reintento que vuelve a caer en "no listo" NO se reencola (una sola llamada, sin bucle)', () => {
  const o = rama({ esReintento: true });
  assert.equal(o.msg, MSG);
  assert.equal(o.guardado, null);
});
test('misma prueba que v753/v764: HEAD leido y sin pendientes de PIN/rol basta aunque falte historia', () => {
  const o = rama({ recuperando: true, accesoListo: true });
  assert.equal(o.r, 'pasa', 'with access proven the PIN goes on to the normal checks (a wrong one is counted)');
  assert.equal(o.guardado, null);
});
test('negativo: con acceso listo pero sin PIN propio de la tienda sigue esperando', () => {
  for (const owner of ['', '456', '789']) assert.equal(rama({ accesoListo: true, owner }).msg, MSG);
});

// ---- The waiting PIN itself ----
function espera() {
  const t = { now: 1000000 }, llamadas = [], timers = new Map();
  let nextId = 1;
  const pad = { style: { display: '' }, _ocTeclado: { entrada: () => ctx.digitos } };
  const listo = { v: false };
  const ctx = {
    digitos: [], rol: null, Promise,
    Date: { now: () => t.now },
    gate: { isConnected: true, style: { display: 'flex' } },
    $: id => (id === 'oc-pad' ? pad : null),
    window: { OCYjs: { canal: { recuperando: true, accesoListo: () => listo.v } } },
    validar: (code, esReintento) => { llamadas.push([code, esReintento]); return Promise.resolve(); },
    setInterval: fn => { const id = nextId++; timers.set(id, fn); return id; },
    clearInterval: id => { timers.delete(id); },
    localStorage: { setItem() { throw Error('PIN must never reach localStorage'); } },
    sessionStorage: { setItem() { throw Error('PIN must never reach sessionStorage'); } },
  };
  vm.createContext(ctx);
  vm.runInContext(bloqueEspera() + '\nthis.api = { guardarPinEnEspera, revisarPinEnEspera, soltarPinEnEspera };', ctx);
  const tic = async (ms = 1000) => { t.now += ms; for (const fn of [...timers.values()]) fn(); await new Promise(r => setImmediate(r)); };
  return { ctx, api: ctx.api, llamadas, timers, listo, pad, tic };
}

test('cuando el aparato queda listo, el PIN esperado se valida UNA vez por validar() y se suelta', async () => {
  const e = espera();
  e.api.guardarPinEnEspera('555');
  await e.tic(); await e.tic();
  assert.equal(e.llamadas.length, 0, 'not ready: nothing is retried');
  e.listo.v = true;
  await e.tic();                       // first ready observation
  await e.tic();                       // ready for 1 s: credentials from the room had time to be installed
  assert.deepEqual(e.llamadas, [['555', true]]);
  await e.tic(); await e.tic();
  assert.equal(e.llamadas.length, 1, 'exactly one call');
  assert.equal(e.timers.size, 0, 'the 1 s check stops');
});
test('el escucha de oc-sync-merge revisa con la misma regla (no salta la espera de 1 s)', async () => {
  const e = espera();
  e.api.guardarPinEnEspera('555');
  e.listo.v = true;
  e.api.revisarPinEnEspera(); e.api.revisarPinEnEspera();
  assert.equal(e.llamadas.length, 0);
  await e.tic();
  assert.deepEqual(e.llamadas, [['555', true]]);
  assert.match(authSrc, /addEventListener\("oc-sync-merge", function \(\) \{ try \{ revisarPinEnEspera\(\); \} catch \(_\) \{\} \}\)/);
});
test('un PIN nuevo reemplaza al que esperaba', async () => {
  const e = espera();
  e.api.guardarPinEnEspera('111');
  e.api.guardarPinEnEspera('222');
  e.listo.v = true;
  await e.tic(); await e.tic();
  assert.deepEqual(e.llamadas, [['222', true]]);
  assert.equal(e.timers.size, 0);
  assert.match(authSrc, /async function validar\(code, esReintento\) \{\n\s+if \(!esReintento\) soltarPinEnEspera\(\);/,
    'a typed PIN (not the retry) clears the waiting one before validating');
});
test('no borra digitos que alguien esta tecleando ni corre durante el bloqueo por intentos', async () => {
  const e = espera();
  e.api.guardarPinEnEspera('555');
  e.listo.v = true;
  e.ctx.digitos = [1];
  await e.tic(); await e.tic(); await e.tic();
  assert.equal(e.llamadas.length, 0);
  e.ctx.digitos = []; e.pad.style.display = 'none';
  await e.tic(); await e.tic();
  assert.equal(e.llamadas.length, 0);
  e.pad.style.display = '';
  await e.tic(); await e.tic();
  assert.deepEqual(e.llamadas, [['555', true]]);
});
test('se suelta sin validar al entrar, al ocultarse el candado o a los 10 min', async () => {
  for (const caso of ['rol', 'oculto', 'tope']) {
    const e = espera();
    e.api.guardarPinEnEspera('555');
    if (caso === 'rol') e.ctx.rol = 'dueno';
    if (caso === 'oculto') e.ctx.gate.style.display = 'none';
    if (caso === 'tope') await e.tic(600001);
    e.listo.v = true;
    await e.tic(); await e.tic(); await e.tic();
    assert.equal(e.llamadas.length, 0, caso);
    assert.equal(e.timers.size, 0, caso);
  }
});
test('el PIN esperado vive solo en memoria: el bloque no escribe en ningun almacenamiento', () => {
  const b = bloqueEspera();
  assert.doesNotMatch(b, /localStorage|sessionStorage|indexedDB|setItem|\bput\(/);
});
