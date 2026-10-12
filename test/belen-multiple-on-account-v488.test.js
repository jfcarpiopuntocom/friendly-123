// Hotfix v488 — Belén/idiomARTE, 2026-10-12. Synthetic, offline, no real license.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { browser } = require('./helpers/browser.cjs');

function fixture() {
  const w = browser(), facts = [];
  w.OCAuth = { rolActual: () => 'dueno' };
  w.AMG = { Hechos: {
    registrar: async (tipo, datos) => {
      const fact = { id: 'bel-test-' + facts.length, tipo, datos: JSON.parse(JSON.stringify(datos)), ts: Date.now() + facts.length };
      facts.push(fact); return fact;
    },
    todos: async () => facts,
    verificarCadenas: async () => ({ok:true})
  } };
  vm.runInContext(fs.readFileSync(path.resolve(__dirname, '../docs/cartera.js'), 'utf8'), w);
  return { w, facts };
}
async function scenario() {
  const s = fixture();
  s.customer = await s.w.request('/api/clientes', 'POST', {nombre:'Synthetic Sarah (not real customer)'});
  s.product = await s.w.request('/api/productos', 'POST', {
    nombre:'Synthetic IPA', barcode:'IPA-HOTFIX-488', precio:1.6, costo:0.8, stockInicial:30
  });
  s.sale = await s.w.request('/api/productos/' + s.product.id + '/venta', 'POST',
    { cantidad:12, clienteId:s.customer.id, info:{formaPago:'cash'} });
  return s;
}
const patch = (s, payload) => s.w.request('/api/ventas/' + s.sale.ventaId, 'PATCH', payload);
const balance = s => s.w.request('/api/clientes/' + s.customer.id + '/cartera');
const stock = async s => (await s.w.request('/api/productos')).find(p => p.id === s.product.id).stockActual;

test('named customer buys 12 IPA once, with correct stock and money', async () => {
  const s = await scenario();
  const rows = await s.w.request('/api/ventas/todas');
  const entry = rows.find(v => v.id === s.sale.ventaId);
  assert.ok(entry);
  assert.equal(entry.clienteId, s.customer.id);
  assert.equal(entry.cantidad, 12);
  assert.equal(entry.precioUnit, 1.6);
  assert.equal(entry.formaPago, 'cash');
  assert.equal((entry.precioUnit * entry.cantidad).toFixed(2), '19.20');
  assert.equal(await stock(s), 18);
  assert.equal((await balance(s)).saldo, 0);
});

test('cash -> fiado writes one sale-linked debt, retry is idempotent, cash cancels debt without destroying evidence', async () => {
  const s = await scenario();
  await patch(s, {cantidad:12, precioUnit:1.6, info:{formaPago:'fiado'}});
  assert.equal((await balance(s)).saldo, -19.2);
  assert.equal(s.facts.filter(f => f.tipo === 'cartera_cargo').length, 1);
  assert.equal(s.facts[0].datos.ventaId, s.sale.ventaId);
  await patch(s, {cantidad:12, precioUnit:1.6, info:{formaPago:'fiado'}});
  assert.equal((await balance(s)).saldo, -19.2);
  assert.equal(s.facts.length, 1, 'retry must never make 2 charges');
  assert.equal(await stock(s), 18);
  await patch(s, {info:{formaPago:'cash'}});
  assert.equal((await balance(s)).saldo, 0);
  assert.equal(s.facts.length, 1, 'audit event is retained');
  await patch(s, {info:{formaPago:'fiado'}});
  assert.equal((await balance(s)).saldo, -19.2);
  assert.equal(s.facts.length, 1, 'reusing same sale never creates second debt');
});

test('no registered customer -> credit rejected, unchanged stock and no orphan ledger entry', async () => {
  const s = fixture();
  const p = await s.w.request('/api/productos', 'POST',
    {nombre:'Synthetic counter IPA', barcode:'IPA-NO-CUST-488', precio:1.6, costo:0.8, stockInicial:20});
  const sale = await s.w.request('/api/productos/' + p.id + '/venta','POST',{cantidad:1,info:{formaPago:'cash'}});
  await assert.rejects(
    () => s.w.request('/api/ventas/' + sale.ventaId,'PATCH',{cantidad:2,info:{formaPago:'fiado'}}),
    /400.*registered customer/i
  );
  assert.equal((await s.w.request('/api/ventas/todas')).find(v=>v.id===sale.ventaId).formaPago,'cash');
  assert.equal(s.facts.length,0);
  assert.equal((await s.w.request('/api/productos')).find(v=>v.id===p.id).stockActual,19);
});

test('failed credit persistence aborts edit and stock change', async () => {
  const s = await scenario();
  const original = s.w.AMG.Cartera.registrarMovimiento;
  s.w.AMG.Cartera.registrarMovimiento = async () => {throw new Error('Simulated disk full');};
  await assert.rejects(() => patch(s, {cantidad:13, info:{formaPago:'fiado'}}), /409.*Simulated disk full/);
  s.w.AMG.Cartera.registrarMovimiento = original;
  const sale = (await s.w.request('/api/ventas/todas')).find(v=>v.id===s.sale.ventaId);
  assert.equal(sale.cantidad,12);
  assert.equal(sale.formaPago,'cash');
  assert.equal(await stock(s),18);
  assert.equal(s.facts.length,0);
});

test('UI regression: named customer does not hide or reset quantity; Sold offers fiado', () => {
  const ui=fs.readFileSync(path.resolve(__dirname, '../docs/index.html'),'utf8');
  assert.ok(ui.includes('if (cantWrap) cantWrap.style.display = "block";'));
  assert.ok(!ui.includes('const esMostrador = !selCli.value'));
  assert.ok(ui.includes(': (_esBar ? 1 : Number(g("vi-cantidad")));'));
  assert.ok(ui.includes('<option value="fiado"${v.formaPago === "fiado" ? " selected" : ""}>On account (fiado)</option>'));
  assert.ok(ui.includes('bloqueada ? "disabled" : ""'), 'settled price and quantity stay locked');
});
