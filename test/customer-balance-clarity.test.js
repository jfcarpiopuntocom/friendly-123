const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..', 'docs');
const index = fs.readFileSync(process.env.F123_INDEX_TEST_SOURCE || path.join(root, 'index.html'), 'utf8');
const cartera = fs.readFileSync(process.env.F123_CARTERA_TEST_SOURCE || path.join(root, 'cartera.js'), 'utf8');

test('fictional on-account sales and manual debt explain the net balance without changing facts', async () => {
  const facts = [
    { tipo: 'cartera_cargo', ts: 1, datos: { clienteId: 'fixture', monto: 5, motivo: 'Sale A' } },
    { tipo: 'cartera_cargo', ts: 2, datos: { clienteId: 'fixture', monto: 5, motivo: 'Sale B' } },
    { tipo: 'cartera_cargo', ts: 3, datos: { clienteId: 'fixture', monto: 25, motivo: 'Manual debt' } },
  ];
  const window = { AMG: { Hechos: { todos: async () => facts,
    verificarCadenas: async () => ({ ok: true }) } } };
  vm.runInNewContext(cartera, { window, console, localStorage: { getItem: () => null } });
  const info = await window.AMG.Cartera.saldoDeCliente('fixture');
  const view = window.AMG.Cartera.vistaCarteraSegunRol(info, 'dueno');
  assert.equal(view.saldo, -35);
  assert.equal(view.historial.length, 3);
  assert.equal(view.integridad.ok, true);
  assert.deepEqual(facts.map(f => f.datos.monto), [5, 5, 25]);
});

test('purchase subtotal is not labeled as amount owed and the balance exposes its ledger', () => {
  assert.doesNotMatch(index, /Owes '\s*\+ fmtMoney\(fiadoTot\)/);
  assert.match(index, /On-account sales shown:/);
  assert.match(index, /See charges and payments behind this balance/);
  assert.match(index, /amount owed/);
  assert.match(index, /if \(!deudaRes\.ok\) throw new Error/);
  assert.match(index, /The sale was recorded, but the debt could not be confirmed/);
});

test('a requested product filter never falls back to all buyers', () => {
  assert.match(index, /presel !== "__all__" && !optsF\.some/);
  assert.match(index, /filtro\.value = presel;/);
  assert.doesNotMatch(index, /if \(optsF\.some\(\(o\) => o\.k === presel\)\) filtro\.value = presel/);
});

test('product price spinners use whole-unit arrows while still accepting typed decimals', () => {
  for (const id of ['np-precio', 'np-costo', 'np-precio-casa', 'ed-precio', 'ed-costo', 'ed-precio-casa']) {
    assert.match(index, new RegExp(`id="${id}" type="number" min="0" step="any"`));
  }
});
