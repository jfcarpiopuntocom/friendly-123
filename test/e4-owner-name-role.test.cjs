'use strict';
// Copy this test to test/e4-owner-name-role.test.cjs on the exact PR417 checkout.
// Synthetic notebook only. No customer data, relay calls, or real login.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { browser } = require('./helpers/browser.cjs');

async function fixture(rol) {
  const app = browser();
  app.OCAuth = { rolActual: () => rol, esDemo: () => false };
  const read = async () => (await app.fetch('/api/instancia')).json();
  const before = await read();
  const snapshot = {
    name: before.nombreNegocio,
    rev: app.catalog().nombreNegocioRev,
    sidecar: app.localStorage.getItem('f123_owned'),
    ptr: app.localStorage.getItem('f123_estado_v4_ptr')
  };
  let noticeCount = 0;
  app.addEventListener('oc-negocio-actualizado', () => { noticeCount++; });
  const response = await app.fetch('/api/instancia/nombre', {
    method: 'POST',
    body: JSON.stringify({ nombre: `Synthetic ${rol} rename` })
  });
  const payload = await response.json();
  return { app, before, snapshot, after: await read(), response, payload, noticeCount };
}

for (const rol of ['empleado', 'admin']) {
  test(`E4: ${rol} cannot rename owner's business by direct API call`, async () => {
    const f = await fixture(rol);
    assert.equal(f.response.status, 403);
    assert.equal(f.payload.ok, undefined);
    assert.equal(f.after.nombreNegocio, f.snapshot.name);
    assert.equal(f.app.catalog().nombreNegocioRev, f.snapshot.rev);
    assert.equal(f.app.localStorage.getItem('f123_owned'), f.snapshot.sidecar);
    assert.equal(f.app.localStorage.getItem('f123_estado_v4_ptr'), f.snapshot.ptr);
    assert.equal(f.noticeCount, 0);
  });
}

test('E4: owner can rename with durable local acknowledgment', async () => {
  const f = await fixture('dueno');
  assert.equal(f.response.status, 200);
  assert.equal(f.payload.ok, true);
  assert.equal(f.after.nombreNegocio, 'Synthetic dueno rename');
  assert.equal(f.noticeCount, 1);
  assert.ok(f.app.localStorage.getItem('f123_estado_v4_ptr'));
});
