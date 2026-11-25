const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const RM = require('../docs/core/business-read-model.js');
const ledger = require('../docs/core/payout-ledger.js');
const html = require('./helpers/page-source.cjs').readFileSync(path.join(__dirname, '../docs/dashboard.html'), 'utf8');

function dashboard(state) {
  const context = {
    window: { OCBusinessReadModel: RM, OCPayoutLedger: ledger },
    Date: class extends Date {
      constructor(...args) { super(...(args.length ? args : ['2026-10-16T12:00:00Z'])); }
      static now() { return Date.parse('2026-10-16T12:00:00Z'); }
    },
    localStorage: { getItem: () => 'en' },
    zonaNegocioDashboard: () => 'America/Guayaquil',
    fechaLocalDashboard: (value) => RM.day(value, 'America/Guayaquil'),
    mesLocalDe: (value) => RM.day(value, 'America/Guayaquil').slice(0, 7),
    estadoSimon: () => 'verde', latidos: {}, VISTAS: { reposicion: { filas: () => [] } },
    datos: {},
  };
  const node = { innerHTML: '', querySelectorAll: () => [] };
  context.$ = (id) => id === 'cm' ? node : null;
  context.esc = String;
  context.money = (value) => value == null ? 'pending' : '$' + Number(value).toFixed(2);
  context.cmMes = '2026-10';
  context.cmVista = 'producto';
  context.rendered = node;
  vm.createContext(context);
  for (const [begin, end] of [
    ['  function cmMesActual()', '  /* Para pruebas de navegador:'],
    ['  function datosDesdeLocal(e)', '  /* El color Simon'],
    ['  function totalesHub()', '  function textoVenta('],
  ]) {
    const start = html.indexOf(begin);
    const finish = html.indexOf(end, start);
    assert.ok(start > 0 && finish > start);
    vm.runInContext(html.slice(start, finish), context);
  }
  context.datos = context.datosDesdeLocal(state);
  return context;
}

function fixture() {
  const sale = (id, extra = {}) => ({
    id, productoId: 'p1', ubicacionId: 'rack-1', promotoraId: 'artist-1',
    fecha: '2026-10-10T12:00:00Z', cantidad: 1, precioUnit: 100, costoUnit: 10,
    modoComision: 'acuerdo', split: { montoBruto: 100, montoComisionSocio: 80, montoNetoDueno: 20, comisionPct: 80 },
    ...extra,
  });
  return {
    productos: [{ id: 'p1', nombre: 'Synthetic print', precio: 100, costo: 10, stockActual: 3 }],
    ubicaciones: [{ id: 'rack-1', nombre: 'Synthetic consignment', tipo: 'socio', promotoraId: 'artist-1' }],
    promotoras: [{ id: 'artist-1', nombre: 'Synthetic artist' }],
    ventas: [sale('sale-1', { liquidada: true, devuelta: true }), sale('sale-2')],
    ajustesComision: [{ id: 'return-1', ventaId: 'sale-1', productoId: 'p1', ubicacionId: 'rack-1',
      fecha: '2026-10-11T12:00:00Z', cantidad: 1, montoBruto: -100, montoComisionSocio: -80, montoNetoDueno: -20 }],
    payouts: [], payoutConflicts: [],
  };
}

for (const mode of ['local', 'remote']) {
  test(`${mode}: returned paid sale offsets the same beneficiary and matches every settlement view`, () => {
    const c = dashboard(fixture());
    if (mode === 'remote') {
      delete c.datos.payoutObligations;
      c.datos.ventas.forEach((v) => { delete v.split; });
    }
    const totals = c.datos.liquidaciones[0];
    assert.deepEqual([totals.ventasBrutas, totals.comisionSocio, totals.netoDueno, totals.stillDue], [100, 80, 20, 0]);
    const rows = c.cmFilas('2026-10');
    const group = c.cmAgrupar(rows, 'producto')[0];
    assert.deepEqual([group.bruto, group.socio, group.casa, group.pend], [100, 80, 20, 0]);
    assert.equal(c.cmPendienteDe('2026-10'), 0);
    assert.equal(c.totalesHub().pend, 0);
    for (const view of ['producto', 'percha']) {
      c.cmVista = view;
      c.pintarComisiones();
      assert.match(c.rendered.innerHTML, /Sales with commission<\/div><div class="n">\$100\.00/);
      assert.match(c.rendered.innerHTML, /Still to pay<\/div><div class="n cm-verde">\$0\.00/);
      assert.doesNotMatch(c.rendered.innerHTML, /class="pagar"/);
    }
  });
}

test('dated return remains in an adjustment-only month and does not rewrite the original month', () => {
  const state = fixture();
  state.ventas = [state.ventas[0]];
  state.ventas[0].fecha = '2026-09-30T12:00:00Z';
  const c = dashboard(state);
  assert.deepEqual(Array.from(c.cmMeses()), ['2026-10', '2026-09']);
  const october = c.datos.liquidaciones[0];
  assert.deepEqual([october.ventasBrutas, october.comisionSocio, october.netoDueno, october.stillDue], [-100, -80, -20, -80]);
  const september = c.cmAgrupar(c.cmFilas('2026-09'), 'percha')[0];
  assert.deepEqual([september.bruto, september.socio, september.casa], [100, 80, 20]);
  assert.equal(c.cmFilas('2026-10').length, 1);
  assert.equal(c.totalesHub().pend, 0);
});

test('a credit cannot pay another beneficiary or another rack', () => {
  for (const change of [{ promotoraId: 'artist-2' }, { ubicacionId: 'rack-2' }]) {
    const state = fixture();
    Object.assign(state.ventas[1], change);
    const c = dashboard(state);
    assert.equal(c.totalesHub().pend, 80);
    assert.equal(c.cmPendienteDe('2026-10'), 80);
    assert.equal(c.totalesHub().nPerchas, 1);
  }
});

test('refund credits are consumed by payout items exactly once', () => {
  const state = fixture();
  state.ventas[1].split.montoComisionSocio = 160;
  state.ventas[1].split.montoNetoDueno = 40;
  state.ventas[1].precioUnit = 200;
  state.payouts = [{ id: 'payout-1', opId: 'synthetic-payment', status: 'paid', payeeId: 'artist-1',
    locationId: 'rack-1', period: '2026-10', amountCents: 8000,
    items: [{ kind: 'sale', sourceId: 'sale-2', payeeId: 'artist-1', amountCents: 16000 },
      { kind: 'adjustment', sourceId: 'return-1', payeeId: 'artist-1', amountCents: 8000, offset: true }] }];
  const c = dashboard(state);
  assert.equal(c.totalesHub().pend, 0);
  assert.equal(c.cmFilas('2026-10').find((v) => v.ajusteId).comisionPendiente, 0);
});

test('local financial projection preserves frozen tax and explicit no-commission evidence', () => {
  const state = fixture();
  state.ventas[0].impuesto = { modo: 'incluido', tasa: 15, monto: 15 };
  state.ventas[1].split = null;
  state.ventas[1].noCommission = true;
  const c = dashboard(state);
  assert.deepEqual(c.datos.ventas[0].impuesto, state.ventas[0].impuesto);
  assert.equal(c.datos.ventas[1].noCommission, true);
  assert.equal(c.datos.ventas[0].noCommission, false);
});

test('missing financial coverage cannot show a zero payable balance', () => {
  const c = dashboard(fixture());
  c.datos.cobertura = { ventas: true, liquidaciones: true, ajustesComision: false };
  assert.equal(c.totalesHub().pend, null);
  delete c.datos.cobertura;
  delete c.datos.ajustesComision;
  assert.equal(c.totalesHub().pend, null);
});


test('paid cancellation credits remain visible locally and in remote settlement summaries', () => {
  const state = fixture();
  state.ventas[0].anulada = true;
  state.ventas[0].anuladaEn = '2026-09-20T12:00:00Z';
  state.ajustesComision = [];
  const c = dashboard(state);
  assert.equal(c.datos.liquidaciones[0].stillDue, 0);
  assert.equal(c.totalesHub().pend, 0);
  delete c.datos.payoutObligations;
  assert.equal(c.totalesHub().pend, 0, 'remote per-payee settlement retains a cancellation absent from sale rows');
});

test('historical refund credit appears on its receipt once', () => {
  const state = fixture();
  state.ventas[0].fecha = '2026-08-10T12:00:00Z';
  state.ajustesComision[0].fecha = '2026-09-10T12:00:00Z';
  const c = dashboard(state);
  let receipt = '';
  c.window.open = () => ({ document: { open() {}, write(value) { receipt = value; }, close() {} } });
  c.cmRecibo('rack-1', '2026-09');
  assert.match(receipt, /Net after returns<\/td><td class=n>\$-80\.00/);
  assert.doesNotMatch(receipt, /\$-160\.00/);
});

test('retroactive commissions already included in a sale are never counted twice', () => {
  const state = fixture();
  state.ventas = [state.ventas[1]];
  state.ventas[0].split = null;
  state.ventas[0].modoComision = 'counter';
  state.ajustesComision = [{ id: 'retro-1', tipo: 'recalculo-retroactivo', ventaId: 'sale-2',
    productoId: 'p1', ubicacionId: 'rack-1', fecha: '2026-10-10T12:00:00Z',
    comisionPct: 80, montoBruto: 0, montoComisionSocio: 80, montoNetoDueno: -80 }];
  const c = dashboard(state);
  for (const remote of [false, true]) {
    if (remote) delete c.datos.payoutObligations;
    assert.equal(c.cmFilas('2026-10').length, 1);
    assert.equal(c.cmAgrupar(c.cmFilas('2026-10'), 'producto')[0].socio, 80);
    assert.equal(c.totalesHub().pend, 80);
  }
});

test('hold decisions remain unavailable for payout in local and remote projections', () => {
  const state = fixture();
  state.ventas = [state.ventas[1]];
  state.ajustesComision = [];
  state.configuracion = { retencion: { dias: 30 } };
  const c = dashboard(state);
  assert.equal(c.totalesHub().pend, 0);
  assert.equal(c.datos.liquidaciones[0].held, 80);
  delete c.datos.payoutObligations;
  c.pintarComisiones();
  assert.equal(c.totalesHub().pend, 0);
  assert.match(c.rendered.innerHTML, /On hold/);
  assert.doesNotMatch(c.rendered.innerHTML, /class="pagar"/);
});

test('later product commission settings do not erase frozen no-commission allocation', () => {
  const state = fixture();
  state.ventas = [{ ...state.ventas[1], split: null, noCommission: true }];
  state.ajustesComision = [];
  state.productos[0].comisionistaId = 'new-artist';
  state.productos[0].pctAsociado = 80;
  const c = dashboard(state);
  const result = RM.businessResult({ sales: c.datos.ventas, expenses: [], adjustments: [], month: '2026-10',
    zone: 'America/Guayaquil', coverage: { sales: true, expenses: true, adjustments: true, coherent: true } });
  assert.equal(result.houseAfterExpensesCents, 9000);
});

test('five real historical receipts: recorded retro adjustments replace only empty zero splits, no duplicate monthly payable',()=>{
 const state=fixture();
 state.ventas=Array.from({length:5},(_,i)=>({
   id:'book-'+i,productoId:'p1',ubicacionId:'rack-1',promotoraId:'artist-1',
   fecha:'2026-10-15T12:00:00Z',cantidad:1,precioUnit:15,costoUnit:1,
   split:{montoComisionSocio:i===4?12.75:0,montoNetoDueno:i===4?2.25:15,comisionPct:i===4?85:0,
          reparto:i===4?[{promotoraId:'artist-1',monto:12.75}]:[]}
 }));
 state.ajustesComision=state.ventas.slice(0,4).map(v=>({id:'adj-retro-'+v.id,tipo:'recalculo-retroactivo',
   ventaId:v.id,productoId:'p1',ubicacionId:'rack-1',fecha:v.fecha,montoBruto:0,montoComisionSocio:12.75,
   montoNetoDueno:-12.75,reparto:[{promotoraId:'artist-1',monto:12.75}],comisionPct:85}));
 const original=JSON.stringify(state);
 const history=require('../docs/core/commission-history.js');
 const c=dashboard(state);
 const check=(ctx,due,commission,rows)=>{
   const h=history.project({sales:ctx.datos.ventas,group:'comisionista'});
   assert.equal(h.totals.count,5);assert.equal(h.totals.gross,75);assert.equal(h.totals.commission,commission);
   const r=ctx.cmFilas('2026-10'),g=ctx.cmAgrupar(r,'producto')[0];
   assert.equal(r.length,rows);assert.equal(g.bruto,75);assert.equal(g.socio,commission);
   assert.equal(g.pend,due);assert.equal(ctx.totalesHub().pend,due);
 };
 check(c,63.75,63.75,5);
 assert.equal(JSON.stringify(state),original,'projection never rewrites source facts');
 state.ventas[4].liquidada=true;check(dashboard(state),51,63.75,5);
 state.ventas[4].liquidada=false;state.ajustesComision=[];check(dashboard(state),12.75,12.75,5);
});
