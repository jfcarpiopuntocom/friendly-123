const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { browser } = require('./helpers/browser.cjs');

async function fixture() {
  const w = browser(); w.OCAuth = { rolActual: () => 'dueno' };
  const person = await w.request('/api/promotoras', 'POST', { nombre: 'Candy Synthetic', comisionBase: 40 });
  const rack = await w.request('/api/ubicaciones', 'POST', { nombre: 'Synthetic studio', tipo: 'socio' });
  await w.request('/api/ubicaciones/' + rack.id, 'PUT', { promotoraId: person.id });
  const product = await w.request('/api/productos', 'POST', { nombre: 'Synthetic cup', barcode: 'STMT-SYNTH', precio: 100, costo: 20, stockInicial: 10, ubicacionId: rack.id });
  const sale = await w.request('/api/productos/' + product.id + '/venta', 'POST', { cantidad: 1 });
  return { w, person, rack, sale };
}

async function statement(s) {
  const source = fs.readFileSync(require.resolve('../docs/index.html'), 'utf8');
  const start = source.indexOf('async function enviarEstadoComisionista(');
  const end = source.indexOf('\n/* Diccionario de textos de dinero', start);
  assert.ok(start > 0 && end > start);
  let capture;
  Object.assign(s.w, {
    API: '/api', console, _ocMesComisiones: new Date().toISOString().slice(0, 7),
    _ocMesEtiqueta: x => x, t: x => x, _ocModalMostrar: async () => 7,
    ocAlert: async message => { throw new Error(message); },
    OCEstado: { cifrar: async data => { capture = data; return 'synthetic'; } },
    open: () => ({}), location: { origin: 'http://fixture.invalid', href: 'http://fixture.invalid/index.html' }
  });
  vm.runInContext(source.slice(start, end), s.w);
  await s.w.enviarEstadoComisionista(s.rack.id, s.person.id);
  return JSON.parse(JSON.stringify(capture));
}

test('external statement reconciles partial payouts and their reversal with the canonical ledger', async () => {
  const s = await fixture();
  const payment = await s.w.request('/api/payouts', 'POST', { ubicacionId: s.rack.id, payeeId: s.person.id, mes: new Date().toISOString().slice(0, 7), medioPago: 'transferencia', amountCents: 1500, opId: 'statement-partial' });
  const d = await statement(s);
  assert.equal(d.totalComision, 40);
  assert.equal(d.totalPagado, 15);
  assert.equal(d.totalPendiente, 25);
  assert.equal(d.lineas[0].pagado, 15);
  assert.equal(d.lineas[0].pendiente, 25);
  await s.w.request('/api/payouts/' + payment.payout.id + '/reverse', 'POST', { opId: 'statement-reverse', reason: 'Synthetic reversal' });
  const reversed = await statement(s);
  assert.equal(reversed.totalPagado, 0);
  assert.equal(reversed.totalPendiente, 40);
});

test('automatic base changes preserve a sale with actual partial money already paid', async () => {
  const s = await fixture();
  await s.w.request('/api/payouts', 'POST', { ubicacionId: s.rack.id, payeeId: s.person.id, mes: new Date().toISOString().slice(0, 7), medioPago: 'efectivo', amountCents: 1500, opId: 'sealed-partial' });
  const before = await s.w.request('/api/respaldo/exportar');
  await s.w.request('/api/promotoras/' + s.person.id, 'PUT', { comisionBase: 10 });
  const after = await s.w.request('/api/respaldo/exportar');
  assert.deepEqual(after.ventas.find(v => v.id === s.sale.ventaId).split, before.ventas.find(v => v.id === s.sale.ventaId).split);
  assert.deepEqual(after.payouts, before.payouts);
  const row = (await s.w.request('/api/liquidaciones')).find(r => r.ubicacionId === s.rack.id).payoutBalances.find(r => r.payeeId === s.person.id);
  assert.equal(row.paid, 15);
  assert.equal(row.due, 25);
  const priceEdit = await s.w.fetch('/api/ventas/' + s.sale.ventaId, { method:'PATCH', body:JSON.stringify({precioUnit:10,cantidad:2}) });
  assert.equal(priceEdit.status,400,'editing sale amounts must not erase money already paid');
  const preserved = await s.w.request('/api/respaldo/exportar');
  assert.deepEqual(preserved.ventas.find(v => v.id === s.sale.ventaId), after.ventas.find(v => v.id === s.sale.ventaId));
  assert.deepEqual(preserved.productos,after.productos,'a rejected money edit cannot move stock');
  const correction = await s.w.fetch('/api/ventas/' + s.sale.ventaId + '/comision', { method:'PATCH', body:JSON.stringify({comisionPct:10,motivo:'Synthetic correction'}) });
  assert.equal(correction.status,409,'a manual correction cannot erase actual partial money either');
});

test('external statement includes the assistant own share, never the seller full share', async () => {
  const s = await fixture();
  const helper = await s.w.request('/api/promotoras','POST',{nombre:'Helper Synthetic',comisionBase:10});
  const product = (await s.w.request('/api/respaldo/exportar')).productos.find(p => p.ubicacionId === s.rack.id);
  await s.w.request('/api/productos/'+product.id+'/venta','POST',{cantidad:1,asistenteId:helper.id,asistentePct:25});
  const d = await statement({...s,person:helper});
  assert.equal(d.totalComision,10);
  assert.equal(d.totalPendiente,10);
  assert.equal(d.lineas.length,1);
});

test('a return after settlement appears as an adjustment without rewriting the paid statement line', async () => {
  const s = await fixture();
  await s.w.request('/api/payouts','POST',{ubicacionId:s.rack.id,payeeId:s.person.id,mes:new Date().toISOString().slice(0,7),medioPago:'efectivo',amountCents:4000,opId:'return-statement-paid'});
  await s.w.request('/api/ventas/'+s.sale.ventaId+'/devolucion','POST',{motivo:'Synthetic return'});
  const d = await statement(s);
  assert.equal(d.lineas[0].comision,40); assert.equal(d.lineas[0].pagado,40);
  assert.equal(d.ajustes[0].comision,-40); assert.equal(d.ajustes[0].pendiente,-40);
  assert.equal(d.totalComision,0); assert.equal(d.totalPagado,40); assert.equal(d.totalPendiente,-40);
  const state = await s.w.request('/api/respaldo/exportar');
  const LG = require('../docs/core/ledger.js');
  const ledger = LG.buildLedger({ventas:state.ventas,ajustes:state.ajustesComision,payouts:state.payouts,ubicaciones:state.ubicaciones});
  assert.equal(ledger.balances.byPerson[s.person.id],-4000,'double entry and payout ledger reverse the commission exactly once');
  assert.equal(ledger.errors.length,0);
});

test('partial money cannot be voided or cancelled, and a return preserves the actual paid amount', async () => {
  const s = await fixture();
  await s.w.request('/api/payouts','POST',{ubicacionId:s.rack.id,payeeId:s.person.id,mes:new Date().toISOString().slice(0,7),medioPago:'efectivo',amountCents:1500,opId:'partial-return-statement'});
  for (const action of ['anular','cancelar']) {
    const r = await s.w.fetch('/api/ventas/'+s.sale.ventaId+'/'+action,{method:'POST',body:JSON.stringify({motivo:'Synthetic'})});
    assert.equal(r.status,400,action+' cannot erase paid commission');
  }
  const returned = await s.w.request('/api/ventas/'+s.sale.ventaId+'/devolucion','POST',{motivo:'Synthetic partial return'});
  assert.ok(returned.ajuste,'partial money needs a return adjustment');
  const d = await statement(s);
  assert.equal(d.totalComision,0); assert.equal(d.totalPagado,15); assert.equal(d.totalPendiente,-15);
});

test('encrypted statement roundtrip preserves partial cents and cheque, with the privacy whitelist intact', async () => {
  const ctx = {crypto:globalThis.crypto,TextEncoder,TextDecoder,atob,btoa};
  ctx.globalThis = ctx; vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(require.resolve('../docs/estado-cifrado.js'),'utf8'),ctx);
  const line = {fecha:'2026-10-07',producto:'Synthetic',cantidad:1,comision:40.01,pagado:15.01,pendiente:25,medio:'cheque',sourceId:'PRIVATE-SALE',payeeId:'PRIVATE-PERSON',cliente:'PRIVATE-CUSTOMER',costo:5};
  const result = await ctx.OCEstado.leer(await ctx.OCEstado.cifrar({nombre:'Synthetic',lineas:[line],ajustes:[{...line,comision:-2,pagado:0,pendiente:-2}],totalComision:38.01,totalPagado:15.01,totalPendiente:23}));
  assert.equal(result.ok,true); assert.equal(result.datos.l[0].pd,15.01); assert.equal(result.datos.l[0].du,25); assert.equal(result.datos.l[0].m,'cheque');
  assert.equal(result.datos.a[0].du,-2);
  assert.doesNotMatch(JSON.stringify(result.datos),/PRIVATE|sourceId|payeeId|cliente|costo/);
});
