const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

async function fakeRun(license, { joined = false, customOwnerPin = false, recoveringCatalog = false } = {}) {
  const script = fs.readFileSync(path.join(__dirname, '../scripts/canario-union-fria.cjs'), 'utf8');
  let now = 0, keypadClicks = 0, exitCode = null;
  const messages = [];
  const pad = {
    waitFor: async () => {},
    click: async () => { keypadClicks++; },
    isVisible: async () => true,
  };
  const page = {
    on() {},
    setDefaultTimeout() {},
    goto: async () => {},
    locator: () => ({ first: () => pad }),
    click: async () => {},
    fill: async () => {},
    evaluate: async (fn) => {
      if (joined && String(fn).includes('licenciaAdoptada:')) {
        return { licenciaAdoptada: true, syncCodeIgual: true, salaCorrecta: true, tieneDispositivo: true, tienePinOwnerNoFactory: customOwnerPin, catalogoRecuperando: recoveringCatalog };
      }
      return null; // Owner never authenticates: exercise login budget
    },
    waitForTimeout: async (ms) => { now += ms; },
    waitForFunction: async () => {},
  };
  const browser = { newPage: async () => page, close: async () => {} };
  const fakeProcess = {
    argv: ['node', 'scripts/canario-union-fria.cjs'],
    env: license === null ? {} : { F123_CANARIO_LICENCIA: license },
    exit(n) { exitCode = n; throw Object.assign(new Error('CANARY_EXIT'), { canaryExit: true }); },
  };
  const ctx = {
    require(name) { assert.equal(name, 'playwright'); return { chromium: { launch: async () => browser } }; },
    process: fakeProcess,
    console: { log: (...xs) => messages.push(xs.join(' ')), error: (...xs) => messages.push(xs.join(' ')) },
    Date: class FakeDate extends Date { static now() { return now; } },
    setTimeout: (f) => { f(); return 1; },
    clearTimeout() {},
  };
  try { await vm.runInNewContext(script, ctx, { filename: 'canario-union-fria.cjs', timeout: 4000 }); }
  catch (error) { if (!error?.canaryExit) throw error; }
  return { keypadClicks, exitCode, messages, now };
}

test('P0: no repetir el PIN si la tienda no autentica en el primer intento', async () => {
  const r = await fakeRun('F123-TEST-COLD-JOIN-00002');
  assert.ok(r.keypadClicks <= 6, 'máximo 6 pulsaciones incluyendo selector de unión; recibido: ' + r.keypadClicks);
  assert.equal(r.exitCode, 1, 'la recuperación fallida debe seguir dando rojo');
});

test('P0: sin licencia sintética el canario no puede salir verde', async () => {
  const r = await fakeRun(null);
  assert.notEqual(r.exitCode, 0, 'ausencia de licencia NO cuenta como canario aprobado');
  assert.ok(r.messages.some(m => /F123_CANARIO_LICENCIA/.test(m)), 'diagnóstico de configuración claro');
});

test('P0: tras adoptar licencia, introduce un solo PIN de propietario', async () => {
  const r = await fakeRun('F123-TEST-COLD-JOIN-00002', { joined: true });
  assert.equal(r.keypadClicks, 6, 'selector de unión y un único login');
  assert.equal(r.exitCode, 1, 'un PIN que no entra termina rojo');
  assert.ok(r.messages.some(m => /ACCESO:/.test(m)), 'informa etapa de acceso');
});

test('P0: si el PIN Owner observado no es factory, no probar 789', async () => {
  const r = await fakeRun('F123-TEST-COLD-JOIN-00002', { joined: true, customOwnerPin: true });
  assert.equal(r.keypadClicks, 3, 'solo selector de unión, nunca tantear PIN incorrecto');
  assert.equal(r.exitCode, 1);
  assert.ok(r.messages.some(m => /F123_CANARIO_PIN/.test(m)), 'pide secreto sintético actualizado sin revelar PIN');
});

test('P0: no escribir PIN mientras catalogo de una tienda unida sigue recuperando', async () => {
  const r = await fakeRun('F123-TEST-COLD-JOIN-00002', { joined: true, recoveringCatalog: true });
  assert.equal(r.keypadClicks, 3, 'unicamente 789 inicial para elegir Join; NO se intenta login durante recuperación');
  assert.equal(r.exitCode, 1, 'la recuperación no terminada da rojo explícito');
  assert.ok(r.messages.some(m => /RECUPERACION:/.test(m)), 'etapa real: recuperación');
});
