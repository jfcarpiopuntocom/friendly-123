/* Commissions en una tienda real: las perchas con ventas propias deben aparecer
   tanto por rack como por producto, sin inventar un reparto de comisiones. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const html = fs.readFileSync(path.join(__dirname, '../docs/index.html'), 'utf8');
const i18n = fs.readFileSync(path.join(__dirname, '../docs/i18n.js'), 'utf8');

test('racks with no sales this month are folded, not painted as $0 cards', () => {
  // 2026-09-24 ("nada fuera de vista"): una percha que solo vendio de la casa (COUNTER SALES)
  // SI tuvo ventas; las que no vendieron nada siguen plegadas.
  assert.match(html, /const _tuvoVentas = \(f\) => f\.estado !== "sin ventas" \|\| \(f\.ventasCasa && f\.ventasCasa\.ventas > 0\);/);
  assert.match(html, /const conVentas = filas\.filter\(_tuvoVentas\);/);
  assert.match(html, /const sinVentas = filas\.filter\(f => !_tuvoVentas\(f\)\);/);
  assert.match(html, /data-commissions-idle/, 'bloque plegado de perchas sin ventas');
});

test('old demo seed racks are labeled, never deleted', () => {
  assert.match(html, /PERCHAS_SEMILLA_VIEJA = \["bookshelf", "fairbooth", "smokeshop"\]/);
  assert.match(html, /comm\.sampleRack/);
  assert.doesNotMatch(html, /PERCHAS_SEMILLA_VIEJA[\s\S]{0,400}(DELETE|splice)/, 'no se borra nada');
});

test('by-product view labels own sales separately in EN and ES', () => {
  assert.match(html, /agruparVentasPorProducto\(ventasTodas, true, _ocMesComisiones, true\)/);
  for (const k of ['comm.productTotal', 'comm.productOwn', 'comm.productHouse', 'comm.sampleRack', 'comm.idleRacks', 'comm.idleRacksNote']) {
    assert.equal((i18n.match(new RegExp(`"${k.replace(/\./g, '\.')}":`, 'g')) || []).length, 2, `${k} EN+ES`);
  }
});

test('product summary includes own and shared house sales without creating commission', () => {
  const start = html.indexOf('function agruparVentasPorProducto(');
  const end = html.indexOf('function selectorVistaComisionesHtml(', start);
  assert.ok(start > 0 && end > start);
  const agrupar = new Function(`${html.slice(start, end)}; return agruparVentasPorProducto;`)();
  const base = { productoId: 'p1', productoNombre: 'Real product', sku: 'SKU-1', mes: '2026-09', delMesActual: true, cantidad: 1 };
  const rows = [
    { ...base, ubicacionNombre: 'Bar', ubicacionTipo: 'propio', precioUnit: 10, comisionPct: null },
    { ...base, ubicacionNombre: 'Shared', ubicacionTipo: 'socio', precioUnit: 20, comisionPct: null },
    { ...base, ubicacionNombre: 'Shared', ubicacionTipo: 'socio', precioUnit: 30, comisionPct: 40, comisionAsociado: 12, netoCasa: 18, liquidada: false },
    { ...base, mes: '2026-08', precioUnit: 40, ubicacionTipo: 'propio', comisionPct: null },
  ];
  const [d] = agrupar(rows, true, '2026-09', true);
  assert.equal(d.total, 60);
  assert.equal(d.totalUnid, 3);
  assert.equal(d.propiasMonto, 10);
  assert.equal(d.counterMonto, 20);
  assert.equal(d.bruto, 30);
  assert.equal(d.socio, 12);
  assert.equal(d.pendSocio, 12);
  assert.equal(agrupar(rows, true, '2026-09')[0].total, 50, 'commission-only callers retain their scope');
});

test('a month with only own-rack sales renders product cards, not the empty message', () => {
  const a = html.indexOf('function resumenComisionPorProductoHtml(');
  const b = html.indexOf('async function cargarComisiones(', a);
  const render = new Function('t', 'fmtMoney', 'escHtml', 'cuadreMesHtml', '_ocMesComisiones', '_ocMesEtiqueta',
    `${html.slice(a, b)}; return resumenComisionPorProductoHtml;`)(
      (key) => key, (n) => '$' + Number(n).toFixed(2), String, () => '', '2026-09', (m) => m);
  const output = render([{ producto: 'Artesanía', sku: 'A1', perchas: new Set(['Bar']), asociados: new Set(),
    unid: 0, bruto: 0, socio: 0, casa: 0, pendSocio: 0, counterUnid: 0, counterMonto: 0,
    propiasUnid: 2, propiasMonto: 26, totalUnid: 2, total: 26 }], null);
  assert.match(output, /Artesanía/);
  assert.match(output, /comm\.productOwn/);
  assert.match(output, /\$26\.00/);
  assert.doesNotMatch(output, /comm\.byProductEmpty/);
});
