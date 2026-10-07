// Autor: Claude 2026-10-07 (spec aprobada por JFC: "Aprobado, házlo").
// La deuda de una venta fiada SIGUE A LA VENTA: corregir el precio en Sold corrige la deuda sin escribir
// ningun hecho nuevo. Datos sinteticos, sin red, sin perfiles reales.
// Compatibilidad: el lector v459 se carga desde los bytes REALES de git (b8bd538), no desde una copia.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { browser } = require('./helpers/browser.cjs');

const REPO = process.env.F123_REPO || path.resolve(__dirname, '..');
const V459 = 'b8bd538';
const v459 = (file) => execFileSync('git', ['-C', REPO, 'show', V459 + ':' + file], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const clone = (x) => JSON.parse(JSON.stringify(x));

/* Un "aparato" = un window con mock-backend + hechos compartidos (el sync de hechos se modela con el mismo arreglo). */
function device(facts, rol = 'dueno') {
  const w = browser();
  w.OCAuth = { rolActual: () => rol };
  w.AMG = { Hechos: {
    registrar: async (tipo, datos) => {
      const fact = { id: 'fact-' + facts.length, tipo, datos: clone(datos), ts: 1000 + facts.length };
      facts.push(fact); return fact;
    },
    todos: async () => facts,
    verificarCadenas: async () => ({ ok: true }) } };
  vm.runInContext(fs.readFileSync(require.resolve('../docs/cartera.js'), 'utf8'), w);
  return w;
}
const cartera = (w, id) => w.request('/api/clientes/' + id + '/cartera');

async function fixture(precio = 108) {
  const facts = [];
  const w = device(facts);
  const customer = await w.request('/api/clientes', 'POST', { nombre: 'Synthetic debtor' });
  const other = await w.request('/api/clientes', 'POST', { nombre: 'Synthetic second debtor' });
  const product = await w.request('/api/productos', 'POST', { nombre: 'Synthetic wine', barcode: 'FIADO-FOLLOW', precio, costo: 5, stockInicial: 20 });
  return { facts, w, customer, other, product };
}
const sell = (s, forma = 'fiado', cliente) => s.w.request('/api/productos/' + s.product.id + '/venta', 'POST', { cantidad: 1, clienteId: (cliente || s.customer).id, info: { formaPago: forma } });
/* Camino nuevo de la UI: el cargo nace con el ventaId de su venta. */
const charge = (s, sale, monto = 108) => s.w.request('/api/clientes/' + s.customer.id + '/fiar', 'POST', { monto, motivo: 'Sale on credit: wine', ventaId: sale.ventaId });
const manualCharge = (s, monto = 108) => s.w.request('/api/clientes/' + s.customer.id + '/fiar', 'POST', { monto, motivo: 'Legacy debt' });
const fixPrice = (w, ventaId, precioUnit) => w.request('/api/ventas/' + ventaId, 'PATCH', { precioUnit });

test('the 108 -> 18 case: correcting the sale price in Sold corrects the customer debt, writing no new fact', async () => {
  const s = await fixture();
  const sale = await sell(s);
  await charge(s, sale);
  assert.equal((await cartera(s.w, s.customer.id)).saldo, -108);
  const before = JSON.stringify(s.facts);
  await fixPrice(s.w, sale.ventaId, 18);
  const after = await cartera(s.w, s.customer.id);
  assert.equal(after.saldo, -18);
  assert.equal(after.tienePendiente, true);
  assert.equal(JSON.stringify(s.facts), before, 'a price correction creates NO facts (no abono, no correction)');
  // The history explains the number: the charge shows its CURRENT value and keeps its original amount.
  const cargo = after.historial.find((m) => m.tipo === 'cargo');
  assert.equal(cargo.monto, 18);
  assert.equal(cargo.montoOriginal, 108);
});

test('repeating the same correction changes nothing (never +72 or a second discount)', async () => {
  const s = await fixture();
  const sale = await sell(s);
  await charge(s, sale);
  await fixPrice(s.w, sale.ventaId, 18);
  await fixPrice(s.w, sale.ventaId, 18);
  await fixPrice(s.w, sale.ventaId, 18);
  assert.equal((await cartera(s.w, s.customer.id)).saldo, -18);
  assert.equal(s.facts.length, 1);
});

test('two devices correct 108->18 and 108->20 concurrently: the debt follows the sale final version, never +70', async () => {
  const facts = [];
  const A = device(facts), B = device(facts);
  const customer = await A.request('/api/clientes', 'POST', { nombre: 'Synthetic debtor' });
  const product = await A.request('/api/productos', 'POST', { nombre: 'Synthetic wine', barcode: 'FIADO-CONC', precio: 108, costo: 5, stockInicial: 20 });
  const sale = await A.request('/api/productos/' + product.id + '/venta', 'POST', { cantidad: 1, clienteId: customer.id, info: { formaPago: 'fiado' } });
  await A.request('/api/clientes/' + customer.id + '/fiar', 'POST', { monto: 108, motivo: 'Sale on credit', ventaId: sale.ventaId });
  B.receive(A);
  await fixPrice(A, sale.ventaId, 18);
  await fixPrice(B, sale.ventaId, 20);
  // Sync both ways, twice (order must not matter).
  A.receive(B); B.receive(A); A.receive(B);
  const priceOf = (w) => w.catalog().ventas.find((v) => v.id === sale.ventaId).precioUnit;
  assert.equal(priceOf(A), priceOf(B), 'both devices converge on the same sale version');
  const final = priceOf(A);
  assert.ok(final === 18 || final === 20);
  assert.equal((await cartera(A, customer.id)).saldo, -final);
  assert.equal((await cartera(B, customer.id)).saldo, -final);
  assert.equal(facts.length, 1, 'concurrent corrections wrote no facts to sum');
});

test('v459 reader on data from the new mechanic: keeps the old balance, no double discount, no invented cash, no crash', async () => {
  const facts = [];
  const w = device(facts);
  const customer = await w.request('/api/clientes', 'POST', { nombre: 'Synthetic debtor' });
  const product = await w.request('/api/productos', 'POST', { nombre: 'Synthetic wine', barcode: 'FIADO-OLD', precio: 108, costo: 5, stockInicial: 20 });
  const sale = await w.request('/api/productos/' + product.id + '/venta', 'POST', { cantidad: 1, clienteId: customer.id, info: { formaPago: 'fiado' } });
  await w.request('/api/clientes/' + customer.id + '/fiar', 'POST', { monto: 108, motivo: 'Sale on credit', ventaId: sale.ventaId });
  const legacy = await w.request('/api/clientes/' + customer.id + '/fiar', 'POST', { monto: 7, motivo: 'Legacy debt' });
  await fixPrice(w, sale.ventaId, 18);
  // new fact type: manual link of the legacy charge to a second sale
  const sale2 = await w.request('/api/productos/' + product.id + '/venta', 'POST', { cantidad: 1, clienteId: customer.id, info: { formaPago: 'fiado' } });
  const cargoLegacy = facts.find((f) => f.datos.motivo === 'Legacy debt');
  await w.request('/api/clientes/' + customer.id + '/vincular', 'POST', { cargoId: cargoLegacy.id, ventaId: sale2.ventaId });
  assert.ok(facts.some((f) => f.tipo === 'cartera_vinculo'));
  // Load the REAL v459 reader bytes over the very same facts.
  const old = { AMG: { Hechos: { todos: async () => facts, verificarCadenas: async () => ({ ok: true }) } } };
  vm.runInNewContext(v459('docs/cartera.js'), { window: old, console, localStorage: { getItem: () => null } });
  const oldInfo = await old.AMG.Cartera.saldoDeCliente(customer.id);
  assert.equal(oldInfo.saldo, -115, 'v459 keeps showing the stored charges (108 + 7): old balance, nothing subtracted twice');
  assert.equal(oldInfo.movimientos.length, 2, 'the link fact is not shown as a charge or payment');
  // v459 core ledger: no link fact or sale-linked charge is read as cash.
  const mod = { exports: {} };
  vm.runInNewContext(v459('docs/core/ledger.js'), { module: mod, exports: mod.exports, require: () => require('../docs/core/payout-ledger.js') });
  const cartAsLedger = facts.filter((f) => f.tipo === 'cartera_cargo' || f.tipo === 'cartera_abono' || f.tipo === 'cartera_vinculo')
    .map((f) => ({ id: f.id, tipo: f.tipo === 'cartera_abono' ? 'abono' : 'cargo', monto: f.datos.monto, clienteId: f.datos.clienteId }));
  const book = mod.exports.buildLedger({ ventas: [], ajustes: [], payouts: [], gastos: [], ubicaciones: [], cartera: cartAsLedger });
  const cash = book.entries.flatMap((e) => e.lines).filter((l) => l.account === '1000').reduce((n, l) => n + l.debitCents - l.creditCents, 0);
  assert.equal(cash, 0);
  assert.equal(book.errors.length, 0);
});

test('an abono-correction is never read as cash: a price correction leaves no abono, cash stays 0 and receivables follow the sale', async () => {
  const s = await fixture();
  const sale = await sell(s);
  await charge(s, sale);
  await fixPrice(s.w, sale.ventaId, 18);
  assert.equal(s.facts.filter((f) => f.tipo === 'cartera_abono').length, 0);
  const LG = require('../docs/core/ledger.js');
  const v = s.w.catalog().ventas.find((x) => x.id === sale.ventaId);
  const ledger = LG.buildLedger({ ventas: [v], ajustes: [], payouts: [], gastos: [], ubicaciones: s.w.catalog().ubicaciones, cartera: [] });
  const net = (acct) => ledger.entries.flatMap((e) => e.lines).filter((l) => l.account === acct).reduce((n, l) => n + l.debitCents - l.creditCents, 0);
  assert.equal(net('1000'), 0, 'no cash invented');
  assert.equal(net('1100'), 1800, 'receivable = the sale current value');
});

test('old device + new device on the same data: the new mechanic fixes the debt, the old one keeps working with real payments', async () => {
  const facts = [];
  const nuevo = device(facts);
  const customer = await nuevo.request('/api/clientes', 'POST', { nombre: 'Synthetic debtor' });
  const product = await nuevo.request('/api/productos', 'POST', { nombre: 'Synthetic wine', barcode: 'FIADO-MIX', precio: 108, costo: 5, stockInicial: 20 });
  const sale = await nuevo.request('/api/productos/' + product.id + '/venta', 'POST', { cantidad: 1, clienteId: customer.id, info: { formaPago: 'fiado' } });
  await nuevo.request('/api/clientes/' + customer.id + '/fiar', 'POST', { monto: 108, motivo: 'Sale on credit', ventaId: sale.ventaId });
  await fixPrice(nuevo, sale.ventaId, 18);
  // An old device registers a REAL payment of 18 with v459 code over the same facts.
  const old = { AMG: { Hechos: { todos: async () => facts, verificarCadenas: async () => ({ ok: true }),
    registrar: async (tipo, datos) => { const f = { id: 'old-' + facts.length, tipo, datos: clone(datos), ts: 5000 + facts.length }; facts.push(f); return f; } } } };
  vm.runInNewContext(v459('docs/cartera.js'), { window: old, console, localStorage: { getItem: () => null } });
  await old.AMG.Cartera.registrarMovimiento(customer.id, 'abono', 18, 'cash payment');
  assert.equal((await old.AMG.Cartera.saldoDeCliente(customer.id)).saldo, -90, 'old device shows its old (stored) arithmetic, no crash');
  assert.equal((await cartera(nuevo, customer.id)).saldo, 0, 'new device: 18 owed - 18 paid');
});

test('overpaid: payments above the sale current value show CREDIT in favor; received money is never deleted', async () => {
  const s = await fixture();
  const sale = await sell(s);
  await charge(s, sale);
  await s.w.request('/api/clientes/' + s.customer.id + '/abonar', 'POST', { monto: 108, motivo: 'paid in full' });
  assert.equal((await cartera(s.w, s.customer.id)).saldo, 0);
  const antes = JSON.stringify(s.facts);
  await fixPrice(s.w, sale.ventaId, 18);
  const view = await cartera(s.w, s.customer.id);
  assert.equal(view.saldo, 90, 'positive = credit in favor (existing cartera convention)');
  assert.equal(view.tienePendiente, false);
  assert.equal(JSON.stringify(s.facts), antes, 'the real payment fact and everything else is untouched');
  assert.equal(view.historial.filter((m) => m.tipo === 'abono').reduce((n, m) => n + m.monto, 0), 108);
});

test('a voided fiado sale stops being debt', async () => {
  const s = await fixture();
  const sale = await sell(s);
  await charge(s, sale);
  const other = await sell(s);
  await charge(s, other);
  assert.equal((await cartera(s.w, s.customer.id)).saldo, -216);
  await s.w.request('/api/ventas/' + other.ventaId + '/anular', 'POST', {});
  assert.equal((await cartera(s.w, s.customer.id)).saldo, -108, 'voided sale: 0 contribution');
});

test('manual link of an old charge: before/after balances, same-customer fiado sales only, owner/admin only, undo is append-only', async () => {
  const s = await fixture();
  const sale = await sell(s);                       // a $108 fiado sale
  await manualCharge(s, 108);                       // the old unlinked charge (no ventaId)
  await fixPrice(s.w, sale.ventaId, 18);
  const paid = await sell(s, 'efectivo');
  const alien = await sell(s, 'fiado', s.other);
  const old = s.facts[0];
  assert.equal((await cartera(s.w, s.customer.id)).saldo, -108, 'unlinked charge keeps its stored amount');
  const cargoView = (await cartera(s.w, s.customer.id)).historial.find((m) => m.tipo === 'cargo');
  assert.equal(cargoView.vinculables, 1, 'only the one eligible sale is offered');
  const opc = await s.w.request('/api/clientes/' + s.customer.id + '/cartera/' + old.id + '/opciones');
  assert.equal(opc.cargo.monto, 108);
  assert.deepEqual(opc.opciones.map((o) => o.ventaId), [sale.ventaId], 'no cash sale, no other customer sale');
  assert.equal(opc.opciones[0].saldoAntes, -108);
  assert.equal(opc.opciones[0].saldoDespues, -18);
  // rejected links write nothing
  const n0 = s.facts.length;
  const post = (b) => s.w.request('/api/clientes/' + s.customer.id + '/vincular', 'POST', b);
  await assert.rejects(post({ cargoId: old.id, ventaId: paid.ventaId }));
  await assert.rejects(post({ cargoId: old.id, ventaId: alien.ventaId }));
  await assert.rejects(post({ cargoId: old.id, ventaId: 'missing' }));
  await assert.rejects(post({ cargoId: 'missing', ventaId: sale.ventaId }));
  s.w.OCAuth.rolActual = () => 'empleado';
  await assert.rejects(post({ cargoId: old.id, ventaId: sale.ventaId }));
  s.w.OCAuth.rolActual = () => 'dueno';
  assert.equal(s.facts.length, n0);
  // link
  const original = JSON.stringify(old);
  const linked = await post({ cargoId: old.id, ventaId: sale.ventaId });
  assert.equal(linked.saldo, -18);
  assert.equal(JSON.stringify(s.facts[0]), original, 'the original charge fact is byte-identical');
  assert.equal(s.facts[1].tipo, 'cartera_vinculo');
  await assert.rejects(post({ cargoId: old.id, ventaId: sale.ventaId }), 'already linked');
  // it now follows its sale
  await fixPrice(s.w, sale.ventaId, 30);
  assert.equal((await cartera(s.w, s.customer.id)).saldo, -30);
  // undo (append-only)
  const un = await s.w.request('/api/clientes/' + s.customer.id + '/desvincular', 'POST', { cargoId: old.id });
  assert.equal(un.saldo, -108);
  assert.equal(s.facts.length, 3);
  assert.equal(s.facts[2].datos.accion, 'desvincular');
  await assert.rejects(s.w.request('/api/clientes/' + s.customer.id + '/desvincular', 'POST', { cargoId: old.id }), 'nothing to unlink');
  // and can be linked again
  assert.equal((await post({ cargoId: old.id, ventaId: sale.ventaId })).saldo, -30);
});

test('a sale that already has its own charge is not offered to a second charge (no double debt)', async () => {
  const s = await fixture();
  const sale = await sell(s);
  await charge(s, sale);
  await manualCharge(s, 50);
  const manual = s.facts.find((f) => f.datos.motivo === 'Legacy debt');
  const opc = await s.w.request('/api/clientes/' + s.customer.id + '/cartera/' + manual.id + '/opciones');
  assert.deepEqual(opc.opciones, []);
  await assert.rejects(s.w.request('/api/clientes/' + s.customer.id + '/vincular', 'POST', { cargoId: manual.id, ventaId: sale.ventaId }));
});
