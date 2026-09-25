/* Commissions en una tienda REAL (Belen, 2026-09-24): "by rack sale con info de
   relleno" y "by product no hay nada". Causas: (1) perchas de la semilla VIEJA
   del demo (bookshelf "Ink & Pages", fairbooth, smokeshop) quedaron en su tienda
   y se pintaban como tarjetas completas en $0; (2) la vista por producto solo
   cuenta ventas con comision y no explicaba por que estaba vacia.
   Reglas: nunca se borra nada de la clienta; las perchas sin ventas del mes van
   plegadas; las de la semilla vieja se rotulan; el vacio explica y orienta. */
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

test('empty by-product view explains own-rack sales in EN and ES', () => {
  assert.match(html, /comm\.byProductOwnSales/);
  for (const k of ['comm.byProductOwnSales', 'comm.sampleRack', 'comm.idleRacks', 'comm.idleRacksNote']) {
    assert.equal((i18n.match(new RegExp(`"${k.replace(/\./g, '\.')}":`, 'g')) || []).length, 2, `${k} EN+ES`);
  }
});
