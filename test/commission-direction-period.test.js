const { test } = require('node:test');
const assert = require('node:assert/strict');
const R = require('../docs/core/business-read-model.js');
const sale = (id, direction = 'casaPaga', extra = {}) => ({ id, fecha: '2026-09-10', cantidad: 1, precioUnit: 100, costoUnit: 10, split: { montoComisionSocio: 40, montoNetoDueno: 60 }, direccionComision: direction, ...extra });
const report = (sales, month, adjustments = [], extra = {}) => R.businessResult({ sales, month, adjustments, ...extra });

test('returned commission accrual stays positive in sale month and reverses once in refund month, in both directions', () => {
  const sales = [sale('paid', 'casaPaga', { devuelta: true, fechaDevolucion: '2026-10-11' }), sale('collected', 'asociadoPaga', { devuelta: true, fechaDevolucion: '2026-10-11' })];
  const adjustments = sales.map(s => ({ id: 'refund-' + s.id, ventaId: s.id, fecha: '2026-10-11', tipo: 'devolucion', montoComisionSocio: -40, montoNetoDueno: -60 }));
  const original = report(sales, '2026-09', adjustments), refund = report(sales, '2026-10', adjustments);
  assert.equal(original.commissionPayableCents, 4000); assert.equal(original.commissionReceivableCents, 6000);
  assert.equal(refund.commissionPayableCents, -4000); assert.equal(refund.commissionReceivableCents, -6000);
  const year = report(sales, '', adjustments, { period: { from: '2026-01-01', to: '2026-12-31' } });
  assert.equal(year.commissionPayableCents, 0); assert.equal(year.commissionReceivableCents, 0);
});

test('signed allocation adjustments retain original direction and never count a payout as new earning', () => {
  const sales = [sale('house'), sale('associate', 'asociadoPaga')];
  const adjustments = [{ id: 'a', ventaId: 'house', fecha: '2026-10-10', tipo: 'correction', montoComisionSocio: -10, montoNetoDueno: 10 }, { id: 'b', ventaId: 'associate', fecha: '2026-10-10', tipo: 'correction', montoComisionSocio: 5, montoNetoDueno: -5 }];
  const result = report(sales, '2026-10', adjustments, { payouts: [{ amountCents: 4000 }] });
  assert.equal(result.commissionPayableCents, -1000); assert.equal(result.commissionReceivableCents, -500);
});

test('missing date, split, source direction or financial coverage remain pending', () => {
  const cases = [
    report([sale('a', 'casaPaga', { devuelta: true })], '2026-10'),
    report([sale('a', 'casaPaga', { fecha: '2026-10-01', split: null })], '2026-10'),
    report([], '2026-10', [{ id: 'a', fecha: '2026-10-10', montoComisionSocio: -10, montoNetoDueno: 10 }]),
    report([sale('a')], '2026-09', [], { coverage: { adjustments: false } }),
    report([sale('a')], '2026-09', [], { coverage: { coherent: false } }),
  ];
  for (const result of cases) assert.equal(result.commissionPayableCents, null);
});

test('associate-collected contractual receivable retains included tax while profit excludes it', () => {
  const result = report([sale('a', 'asociadoPaga', { impuesto: { modo: 'incluido', tasa: 15, monto: 15 } })], '2026-09');
  assert.equal(result.commissionReceivableCents, 6000);
  assert.equal(result.houseShareCents, 4500);
});

test('dashboard direction summary displays signed refund accrual instead of dropping the returned sale', () => {
  const fs = require('node:fs'), vm = require('node:vm'), path = require('node:path');
  const html = fs.readFileSync(path.join(__dirname, '../docs/dashboard.html'), 'utf8');
  const source = html.slice(html.indexOf('  function flechaComisionesMesHtml(result) {'), html.indexOf('  function pintarFinanzasFoto() {'));
  const month = R.day(new Date().toISOString(), 'America/Guayaquil').slice(0, 7);
  const data = { ventas: [sale('a', 'casaPaga', { devuelta: true, fecha: '2025-01-10', fechaDevolucion: month + '-10', comisionPct: 40, comisionAsociado: 40, netoCasa: 60 })], ajustesComision: [], cobertura: { ventas: true, ajustesComision: true, finanzasCoherentes: true } };
  const ctx = { window: { OCBusinessReadModel: R }, datos: data, localStorage: { getItem: () => 'en' }, fechaLocalDashboard: d => R.day(d, 'America/Guayaquil'), zonaNegocioDashboard: () => 'America/Guayaquil', money: n => Number(n).toFixed(2), esc: String };
  vm.createContext(ctx); vm.runInContext(source, ctx);
  assert.match(ctx.flechaComisionesMesHtml(), /-40\.00/);
  assert.match(ctx.flechaComisionesMesHtml(), /Accrued|accrued/);
});

test('Expenses renders signed refund commission accrual from the actual financial cut', async () => {
  const { chromium } = require('playwright'), { pathToFileURL } = require('node:url'), path = require('node:path');
  const web = await chromium.launch({ headless: true });
  try {
    const page = await web.newPage();
    await page.goto(pathToFileURL(path.resolve(__dirname, '../docs/index.html')).href, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.OCAuth && typeof cargarGastos === 'function');
    const text = await page.evaluate(async () => {
      OCAuth.rolActual = () => 'dueno'; OCI18n.setLang('en');
      const req = async (url, method = 'GET', body) => {
        const response = await fetch(url, { method, body: body ? JSON.stringify(body) : undefined });
        if (!response.ok) throw Error(await response.text()); return response.json();
      };
      const rack = await req('/api/ubicaciones', 'POST', { nombre: 'Synthetic refund directions', tipo: 'socio', comisionSocio: 40 });
      const product = await req('/api/productos', 'POST', { nombre: 'Synthetic refund item', barcode: 'DIRECTION-REFUND', precio: 100, costo: 10, stockInicial: 5, ubicacionId: rack.id });
      const ids = [];
      for (const direccionComision of ['casaPaga', 'asociadoPaga']) {
        const sale = await req('/api/productos/' + product.id + '/venta', 'POST', { cantidad: 1, direccionComision });
        ids.push(sale.ventaId);
        await req('/api/ventas/' + sale.ventaId + '/devolucion', 'POST', { motivo: 'Synthetic refund' });
      }
      const backup = await req('/api/respaldo/exportar');
      backup.ventas = backup.ventas.filter(v => ids.includes(v.id));
      backup.ventas.forEach(v => { v.fecha = '2025-01-10T15:00:00Z'; });
      backup.ajustesComision = backup.ajustesComision.filter(a => ids.includes(a.ventaId));
      await req('/api/respaldo/importar', 'POST', backup);
      await cargarGastos();
      return document.getElementById('gastosResumen').textContent;
    });
    assert.match(text, /Accrued commissions this month[^\n]*\n\s*-\$40[.,]00/);
    assert.match(text, /Accrued house share this month[^\n]*\n\s*-\$60[.,]00/);
    assert.match(text, /before payments/);
  } finally { await web.close(); }
});
