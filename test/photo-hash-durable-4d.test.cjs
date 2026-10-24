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