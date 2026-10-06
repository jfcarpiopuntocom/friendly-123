// Pruebas del esquema del contrato de UI (Tarea 3).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { validateContract, diffNeedsApproval } = require('../scripts/ui-contract.cjs');
const contract = require('../release/ui-contract.json');

test('el contrato publicado es válido', () => {
  assert.deepEqual(validateContract(contract), []);
});
test('quitar un control exige changeApproval de JFC', () => {
  const next = JSON.parse(JSON.stringify(contract));
  next.screens[0].controls.pop();
  assert.equal(diffNeedsApproval(contract, next), true);
  assert.ok(validateContract(next, contract).some(e => /changeApproval/.test(e)));
});
test('admin aparece en todo control que tenga dueno, salvo borrar el negocio', () => {
  for (const s of contract.screens) for (const c of s.controls) {
    if (c.roles.includes('dueno') && c.id !== 'advanced.delete-business') assert.ok(c.roles.includes('admin'), c.id);
  }
});
