'use strict';
const { test } = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm'), path = require('node:path');
const src = fs.readFileSync(path.join(__dirname, '../docs/idb-fotos.js'), 'utf8');
const from = src.indexOf('  async function guardarFotoContenido(dataUrl) {');
const to = src.indexOf('  // Clave localStorage', from);
assert.ok(from >= 0 && to > from, 'use real current photo writer');
async function save(durable) {
  const ctx = { hashDeDataUrl: async () => 'hash-fixture',
    guardarPorHash: async () => durable };
  vm.createContext(ctx);
  vm.runInContext(src.slice(from,to) + '\nthis.save=guardarFotoContenido;', ctx);
  return ctx.save('data:image/png;base64,AA==');
}
test('photo hash cannot be announced if bytes were rejected', async () => {
  await assert.rejects(save(false), /not saved|no se guard/i);
});
test('photo hash is returned after bytes are durable', async () => {
  assert.equal(await save(true), 'hash-fixture');
});
test('legacy copy-only migration retains retry after hash write failure', () => {
  assert.match(src, /try \{ await guardarFotoContenido\(dataUrl\); \} catch \(_\) \{ todoOk = false; \}/);
  assert.match(src, /if \(todoOk\) localStorage\.setItem\(FLAG, "copy-only"\)/);
});

async function rescue(mode, perIdAlreadyPresent=false) {
  const name = mode === 'db' ? 'rescatarDbPreAislamiento' : 'rescatarLocalStoragePreAislamiento';
  const from = src.indexOf('  async function ' + name + '() {');
  const to = src.indexOf(mode === 'db' ? '  /* G10b:' : '  async function diagnosticoRecuperacion()', from);
  assert.ok(from >= 0 && to > from, 'extract real pre-isolation recovery flow');
  let copied = 0;
  const legacy = { perchas: { 'fixture-rack': 'data:image/png;base64,AA==' }, blobs: {} };
  const ctx = {
    window: { AMG: { Aislamiento: {
      leerFotosDbPreAislamiento: async () => legacy,
      leerFotosLocalStoragePreAislamiento: () => legacy
    } } },
    localStorage: { setItem() {} },
    guardarFotoContenido: async () => { throw new Error('hash quota'); },
    leerFotoSoloIdb: async () => perIdAlreadyPresent ? 'data:image/png;base64,NEW=' : null,
    guardarFoto: async () => { copied++; return true; },
    leerPorHash: async () => null, guardarPorHash: async () => false,
    hashDeDataUrl: async () => 'hash-fixture', console
  };
  vm.createContext(ctx);
  vm.runInContext(src.slice(from,to) + '\nthis.rescue=' + name + ';', ctx);
  return { outcome: await ctx.rescue(), copied };
}
test('hash quota failure must not block per-ID recovery in either legacy source', async () => {
  for (const mode of ['db','local']) {
    const a = await rescue(mode);
    assert.equal(a.copied,1);
    assert.equal(a.outcome.perchas,1);
    assert.equal(a.outcome.blobsPendientes,1);
    const already=await rescue(mode,true);
    assert.equal(already.copied,0,'never overwrite an existing photo by ID');
    assert.equal(already.outcome.blobsPendientes,1);
  }
});
