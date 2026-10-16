const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');
const fx = require('./helpers/dashboard-comisiones-fixture.cjs');

for (const originalMonth of [fx.mes, fx.prev]) {
  test('unknown returned commission remains pending in its return month (sale ' + originalMonth + ')', async () => {
    const web = await chromium.launch({ headless: true });
    try {
      const page = await web.newPage();
      await page.goto(pathToFileURL(path.resolve(__dirname, '../docs/dashboard.html')).href, { waitUntil: 'load' });
      const result = await page.evaluate(({ month, originalMonth }) => {
        const sale = { id: 'synthetic-unknown', productoId: 'synthetic-product', productoNombre: 'Synthetic imported sale',
          ubicacionId: 'synthetic-rack', ubicacionNombre: 'Synthetic rack', ubicacionTipo: 'socio',
          fecha: originalMonth + '-10T12:00:00Z', mes: originalMonth, cantidad: 1, precioUnit: 100,
          comisionPct: null, comisionAsociado: null, noCommission: false, devuelta: true,
          fechaDevolucion: month + '-11T12:00:00Z' };
        window.OCDashComisiones.pintarConDatos({ ventas: [sale], liquidaciones: [],
          ajustesComision: [{ id: 'synthetic-return', tipo: 'devolucion', ventaId: sale.id,
            ubicacionId: sale.ubicacionId, productoId: sale.productoId, fecha: sale.fechaDevolucion,
            cantidad: 1, montoBruto: -100, montoComisionSocio: null, montoNetoDueno: null }] });
        const views = [];
        for (const view of ['producto', 'percha']) {
          document.querySelector('[data-cm-vista="' + view + '"]').click();
          views.push({ text: document.getElementById('cm').innerText,
            pay: !!document.querySelector('#cm a.pagar'), none: !!document.querySelector('#cm .cm-chip.none'),
            pending: !!document.querySelector('#cm .cm-chip.pend') });
        }
        let receipt = '';
        window.open = () => ({ document: { open() {}, write(html) { receipt = html; }, close() {} }, focus() {}, print() {} });
        document.querySelector('[data-cm-recibo]').click();
        return { views, receipt };
      }, { month: fx.mes, originalMonth });
      assert.match(result.receipt, /Total commission<\/td><td class=n>pending/);
      for (const view of result.views) {
        assert.match(view.text, /Synthetic imported sale|Synthetic rack/);
        assert.match(view.text, /pending/i);
        assert.doesNotMatch(view.text, /House sale \(no commission\)/);
        assert.equal(view.pay, false);
        assert.equal(view.none, false);
        assert.equal(view.pending, true);
      }
    } finally { await web.close(); }
  });
}

test('older remote snapshots preserve partial, credit and held residuals without inventing a split allocation', async () => {
  const web = await chromium.launch({ headless: true });
  try {
    const page = await web.newPage();
    await page.goto(pathToFileURL(path.resolve(__dirname, '../docs/dashboard.html')).href, { waitUntil: 'load' });
    const scenarios = await page.evaluate(month => {
      return [
        { due: 10, held: 0 }, { due: -10, held: 0 }, { due: 0, held: 40 },
        { due: 10, held: 20 }, { due: 10, held: 0, reparto: [{ promotoraId: 'a', monto: 20 }, { promotoraId: 'b', monto: 20 }] },
        { due: 10, held: 0, cobertura: { ventas: false, liquidaciones: false } }
      ].map(s => {
        const v = { id: 'synthetic-sale', productoId: 'synthetic-product', productoNombre: 'Synthetic commission',
          ubicacionId: 'synthetic-rack', ubicacionNombre: 'Synthetic rack', ubicacionTipo: 'socio',
          fecha: month + '-10T12:00:00Z', mes: month, cantidad: 1, precioUnit: 100,
          comisionPct: 40, comisionAsociado: 40, netoCasa: 60, liquidada: false,
          comisionPendiente: s.due, comisionRetenida: s.held, reparto: s.reparto };
        window.OCDashComisiones.pintarConDatos({ ventas: [v], ajustesComision: [], liquidaciones: [], payouts: [], payoutConflicts: [], cobertura: s.cobertura });
        document.querySelector('[data-cm-vista="producto"]').click();
        const card = [...document.querySelectorAll('#cm .cm-card')].find(el => el.querySelector('.cm-h'));
        return { text: card.innerText, pay: !!card.querySelector('a.pagar') };
      });
    }, fx.mes);
    assert.match(scenarios[0].text, /Still to pay\s*\$10\.00/); assert.equal(scenarios[0].pay, true);
    assert.match(scenarios[1].text, /Credit balance\s*\$-10\.00|Credit balance\s*-\$10\.00/); assert.equal(scenarios[1].pay, false);
    assert.match(scenarios[2].text, /On hold\s*\$40\.00/); assert.equal(scenarios[2].pay, false);
    assert.match(scenarios[3].text, /Still to pay\s*\$10\.00/); assert.match(scenarios[3].text, /On hold\s*\$20\.00/);
    assert.equal(scenarios[5].pay, true, 'transient coverage cannot hide a known payable amount');
    assert.match(scenarios[5].text, /Still to pay\s*\$10\.00/);
    assert.equal(scenarios[4].pay, false); assert.match(scenarios[4].text, /pending/); assert.doesNotMatch(scenarios[4].text, /Still to pay/);
  } finally { await web.close(); }
});
