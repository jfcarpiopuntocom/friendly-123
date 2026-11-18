'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Evaluate the actual dashboard Entrar click handler, not a retyped imitation.
const source = fs.readFileSync(path.join(__dirname, '..', 'src/dashboard/dashboard-main.js'), 'utf8');
const start = source.indexOf('  $("entrar").addEventListener("click", async function () {');
const end = source.indexOf('  /* ========================================================================\n     QUIEN TIENE ACCESO', start);
assert.ok(start >= 0 && end > start, 'real Entrar handler must remain discoverable');
const loginSource = source.slice(start, end);

async function attempt({
  local = null, localCode = '',
  pinResult = null, paintResult = true,
  remoteError = new Error('timeout'), online = true,
  enteredCode = 'F123-1234-1234-1234-12345',
} = {}) {
  let click, painted = 0, connected = 0, remembered = 0;
  const elements = {
    entrar: { disabled: false, addEventListener(type, fn) {
      assert.equal(type, 'click'); click = fn;
    } },
    codigo: { value: enteredCode },
    pin: { value: '123', focus() {} },
    msg: { style: {}, textContent: '' },
  };
  const sandbox = {
    $: id => { assert.ok(elements[id], 'unexpected element ' + id); return elements[id]; },
    leerEstadoLocalActual: async () => local,
    normalizarCodigo: c => c,
    codigoLocalActivo: () => localCode,
    pinLocalOk: async () => pinResult,
    pintarDesdeLocal: () => { painted++; return paintResult; },
    conectar: async () => { connected++; throw remoteError; },
    verificarPin: async () => { throw new Error('unexpected PIN request'); },
    recordarLicencia: () => { remembered++; },
    navigator: { onLine: online },
    Number,
    autorizado: false,
    _sesionLocal: false,
    codigoSesionActual: '',
    _ultimaRevRepintada: -1,
  };
  vm.runInNewContext(loginSource, sandbox, { filename: 'dashboard-entrar-real.js' });
  assert.equal(typeof click, 'function');
  await click();
  return { message: elements.msg.textContent, sandbox, painted, connected, remembered, elements };
}

test('a P2P peer timeout is NOT falsely described as internet failure', async () => {
  const result = await attempt();
  assert.equal(result.message, 'Ningún dispositivo de tu equipo contestó. Abre friendly-123 y vuelve a intentar.');
  assert.equal(result.sandbox.autorizado, false);
  assert.equal(result.elements.entrar.disabled, false);
});

test('an unrelated JS exception is NOT falsely described as internet failure', async () => {
  const result = await attempt({ remoteError: new ReferenceError('runtime rendering bug') });
  assert.notEqual(result.message, 'No se pudo conectar. Revisa tu internet.');
  assert.equal(result.sandbox.autorizado, false);
});

test('only a verified offline state may use the existing internet warning', async () => {
  const result = await attempt({ remoteError: new Error('error'), online: false });
  assert.equal(result.message, 'No se pudo conectar. Revisa tu internet.');
});

test('a correctly validated local owner/admin PIN paints immediately without a P2P peer', async () => {
  const local = { _rev: 9 };
  const result = await attempt({ local, localCode: 'F123-1234-1234-1234-12345', pinResult: true });
  assert.equal(result.sandbox.autorizado, true);
  assert.equal(result.sandbox._sesionLocal, true);
  assert.equal(result.painted, 1);
  assert.equal(result.remembered, 1);
  assert.equal(result.connected, 1, 'background P2P is attempted only after local authorization');
  assert.notEqual(result.message, 'No se pudo conectar. Revisa tu internet.');
});

test('an invalid local PIN cannot disclose the notebook', async () => {
  const result = await attempt({ local: { _rev: 9 }, localCode: 'F123-1234-1234-1234-12345', pinResult: false });
  assert.equal(result.sandbox.autorizado, false);
  assert.equal(result.painted, 0);
  assert.equal(result.connected, 0);
});

test('missing local PIN proof never grants local authorization', async () => {
  const result = await attempt({ local: { _rev: 9 }, localCode: 'F123-1234-1234-1234-12345', pinResult: null });
  assert.equal(result.sandbox.autorizado, false);
  assert.equal(result.painted, 0);
});

test('a different license cannot reuse the PIN of a local notebook', async () => {
  const result = await attempt({ local: { _rev: 9 }, localCode: 'F123-9999-9999-9999-99999', pinResult: true });
  assert.equal(result.sandbox.autorizado, false);
  assert.equal(result.painted, 0);
});
