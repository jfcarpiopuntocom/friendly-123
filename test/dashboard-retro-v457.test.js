/* v457 (owner LAW, JFC 2026-10-07, decision (b)): el recalculo retroactivo al % del producto se ve IGUAL en Commissions (app)
   y en el tablero, mes por mes, porque ambos leen el ledger (nada de cuentas en la vista). Chromium con red cortada
   (todo lo que no sea file: se aborta, WebSocket de mentira). Datos y licencia sinteticos. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { pathToFileURL } = require('node:url');
const path = require('node:path');

const INDEX = pathToFileURL(path.resolve(__dirname, '../docs/index.html')).href;
const DASH = pathToFileURL(path.resolve(__dirname, '../docs/dashboard.html')).href;
const LIC = 'F123-TEST-0000-0000-00000';
const mesRel = (atras) => { const d = new Date(); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - atras, 15, 15, 0, 0)); };
const MES = (d) => d.toISOString().slice(0, 7);
const usd = (n) => '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

async function contexto(web) {
  const ctx = await web.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.route((u) => !/^(file|data|blob|about):/i.test(String(u)), (r) => r.abort());
  await ctx.addInitScript(() => { window.WebSocket = class { constructor() { this.readyState = 3; } send() {} close() {} addEventListener() {} removeEventListener() {} }; });
  return ctx;
}
const api = (page, u, m = 'GET', b) => page.evaluate(async ({ u, m, b }) => {
  const r = await fetch(u, { method: m, headers: b ? { 'Content-Type': 'application/json' } : undefined, body: b ? JSON.stringify(b) : undefined });
  const j = await r.json(); if (r.status >= 400) throw new Error(m + ' ' + u + ' ' + r.status + ' ' + JSON.stringify(j)); return j;
}, { u, m, b });

test('Commissions (app) and dashboard show identical retroactive totals for the 3 months, original sales untouched', async () => {
  const web = await chromium.launch({ headless: true });
  try {
    const ctx = await contexto(web);
    const app = await ctx.newPage();
    await app.goto(INDEX, { waitUntil: 'networkidle' });
    await app.evaluate(async ({ lic }) => {
      window.OCAuth = Object.assign({}, window.OCAuth, { rolActual: () => 'dueno' });
      localStorage.setItem('f123_owned', JSON.stringify({ licenseCode: lic, nombreNegocio: 'Negocio Sintetico' }));
      await window.OCSecure.guardarSecreto('789', ['260'], '357', '');
    }, { lic: LIC });
    const ana = await api(app, '/api/promotoras', 'POST', { nombre: 'Ana Retro', comisionBase: 50 });
    const rack = await api(app, '/api/ubicaciones', 'POST', { nombre: 'Propia Retro', tipo: 'propio' });
    const prod = await api(app, '/api/productos', 'POST', { nombre: 'Taza Retro', barcode: 'RT-1', sku: 'RT-1', precio: 12.35, costo: 4, stockInicial: 60, ubicacionId: rack.id, pctAsociado: 30, comisionistaId: ana.id });
    for (const c of [3, 1, 8]) await api(app, `/api/productos/${prod.id}/venta`, 'POST', { cantidad: c });
    const est = await api(app, '/api/respaldo/exportar');
    const meses = [mesRel(2), mesRel(1), mesRel(0)];
    const mias = est.ventas.filter((v) => v.productoId === prod.id);
    mias.forEach((v, i) => { v.split = null; v.modoComision = 'counter'; v.promotoraId = null; delete v.canalVenta; v.fecha = meses[i].toISOString(); v.liquidada = i === 1; });
    est.ajustesComision = [];
    await api(app, '/api/respaldo/importar', 'POST', est);
    const ventasAntes = JSON.stringify((await api(app, '/api/respaldo/exportar')).ventas.filter((v) => v.productoId === prod.id));
    const base = {}; for (const d of meses) base[MES(d)] = await api(app, '/api/comisiones/cuadre?mes=' + MES(d));

    await app.reload({ waitUntil: 'networkidle' });          // ARRANQUE: corre el recalculo retroactivo
    await app.evaluate(() => { window.OCAuth = Object.assign({}, window.OCAuth, { rolActual: () => 'dueno' }); });
    const despues = await api(app, '/api/respaldo/exportar');
    assert.equal(despues.ajustesComision.length, 3, 'tres ajustes tras el arranque');
    assert.equal(JSON.stringify(despues.ventas.filter((v) => v.productoId === prod.id)), ventasAntes, 'ventas originales intactas');

    const dash = await ctx.newPage();
    await dash.goto(DASH, { waitUntil: 'load' });
    await dash.fill('#pin', '789'); await dash.click('#entrar');
    await dash.waitForFunction(() => getComputedStyle(document.getElementById('tablero')).display !== 'none', null, { timeout: 8000 });
    /* v462: el tablero abre en el inicio del hub; Commissions vive en su tarjeta. Mismas aserciones de abajo. */
    await dash.click('[data-tile="comisiones"]');
    const tiles = () => dash.evaluate(() => Object.fromEntries([...document.querySelectorAll('#cm .cm-k')].map((k) => [k.querySelector('.et').textContent.trim(), k.querySelector('.n').textContent.trim()])));

    for (const d of meses) {
      const mes = MES(d);
      const c = await api(app, '/api/comisiones/cuadre?mes=' + mes);
      const subeGanado = Math.round(c.comisionAsociados * 100) - Math.round(base[mes].comisionAsociados * 100);
      const subePorPagar = Math.round(c.porPagar * 100) - Math.round(base[mes].porPagar * 100);
      assert.ok(subeGanado > 0 && subeGanado === subePorPagar, `${mes}: la app sube ganado y por pagar lo mismo (${subeGanado}/${subePorPagar})`);
      assert.ok(await dash.$(`#cm-mes option[value="${mes}"]`), `${mes}: el tablero ofrece el mes`);
      await dash.selectOption('#cm-mes', mes);
      const t = await tiles();
      assert.equal(t['Associates take'], usd(c.comisionAsociados), `${mes}: Associates take igual en app y tablero`);
      assert.equal(t['Still to pay'], usd(c.porPagar), `${mes}: Still to pay igual en app y tablero`);
    }
  } finally { await web.close(); }
});
