'use strict';
// 4D/1AAA: execute the exact production import route in a synthetic notebook.
// No client storage, network, license, real pictures, or production endpoint.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const src = fs.readFileSync(path.join(__dirname, '../docs/mock-backend.js'), 'utf8');
const a = src.indexOf('      if (path === "/api/respaldo/importar") {');
const b = src.indexOf('      if (path === "/api/liquidaciones")', a);
assert.ok(a !== -1 && b > a, 'production route anchors must exist');
const route = src.slice(a, b);

function scenario({ quota = false, role = 'dueno', valid = true, commit = true } = {}) {
  const initial = {
    productos: [{ id: 'old', stockActual: 12 }],
    movimientos: [{ id: 'old-mov', sello: 'old-seal' }],
    nombreNegocio: 'Original', usuarios: [{ id: 'owner', pin: '555' }],
    configuracion: { categoriasMeta: { ceramics: { estado: 'visible' } } }
  };
  const imported = {
    productos: [{ id: 'new', stockActual: 0 }],
    movimientos: [], nombreNegocio: 'Imported',
    usuarios: [{ id: 'owner', pin: '123' }],
    configuracion: { categoriasMeta: { ceramics: { estado: 'oculta' } } },
    schemaVersion: 3
  };
  const ledger = new Map();
  let current = structuredClone(initial), applied = 0, saves = 0, backupAttempts = 0;
  const deps = {
    OC_STATE_KEY: 'f123_estado_v4',
    localStorage: {
      setItem(k, v) {
        backupAttempts++;
        if (quota) throw Error('QuotaExceededError');
        ledger.set(k, v);
      }
    },
    _rolLocal: () => role,
    validarRespaldo: () => valid ? '' : 'Invalid backup',
    estadoActualExportable: () => structuredClone(current),
    aplicarRespaldo: backup => { current = structuredClone(backup); applied++; },
    guardarEstadoLocal: () => { saves++; return Promise.resolve(commit); },
    J: (body, status = 200) => ({ body, status })
  };
  const run = new Function('d', `
    const {localStorage, _rolLocal, validarRespaldo, estadoActualExportable,
      aplicarRespaldo, guardarEstadoLocal, J, OC_STATE_KEY} = d;
    return async function(body) {
      const path = '/api/respaldo/importar';
      let debePersistir = true;
      try { ${route} }
      finally { if (debePersistir) guardarEstadoLocal(); }
    };
  `)(deps);
  return { run: () => run(imported), initial, imported,
    inspect: () => ({ current, applied, saves, backupAttempts,
      preimage: ledger.has('f123_estado_v4_preimport')
        ? JSON.parse(ledger.get('f123_estado_v4_preimport')) : null }) };
}

test('1AAA: quota rejects recovery preimage -> HTTP 507, original business untouched', async () => {
  const x = scenario({ quota: true });
  const reply = await x.run();
  assert.equal(reply.status, 507);
  assert.deepEqual(x.inspect().current, x.initial);
  assert.equal(x.inspect().applied, 0);
  assert.equal(x.inspect().saves, 0);
});
test('1AAA: legitimate import preserves an exact original recovery preimage', async () => {
  const x = scenario();
  const reply = await x.run();
  assert.equal(reply.status, 200);
  assert.deepEqual(x.inspect().preimage, x.initial);
  assert.deepEqual(x.inspect().current, x.imported);
});
test('1AAA: owner-only authorization and invalid file reject BEFORE mutation', async () => {
  const denied = scenario({ role: 'empleado' }), invalid = scenario({ valid: false });
  assert.equal((await denied.run()).status, 403);
  assert.equal((await invalid.run()).status, 400);
  assert.equal(denied.inspect().applied, 0);
  assert.equal(invalid.inspect().applied, 0);
});
test('1AAA RED (unresolved): preimage succeeds but durable commit fails -> 507, full rollback', async () => {
  const x = scenario({ commit: false });
  const reply = await x.run();
  assert.equal(reply.status, 507, 'never promise a restored notebook without a durable commit');
  assert.deepEqual(x.inspect().current, x.initial, 'stock, PIN, audit and categories must survive');
});
