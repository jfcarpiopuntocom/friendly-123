/* El demo (PIN 456) muestra de lo que es capaz Commissions (JFC 2026-09-24,
   shell 372: "rellenar el demo para display lo buena que es la app"). Antes toda
   venta demo tenia split:null y Commissions salia vacia en el demo.
   Si alguien toca la semilla, esto tiene que seguir cierto:
   - tres meses con comision; el mes pasado con saldo pendiente (aviso rojo);
   - el mes en curso por pagar; los meses viejos pagados;
   - los tramos por meta de la artista se ven (% efectivo > base);
   - hay una COUNTER SALE de la casa en una percha que comparte comision;
   - invariante de dinero: comision + neto = bruto, al centavo, en cada venta. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { browser } = require('./helpers/browser.cjs');

test('demo seed shows commissions across months, tiers and COUNTER SALE', async () => {
  const app = browser();
  const meses = await app.request('/api/liquidaciones/meses');
  assert.ok(meses.length >= 3, 'al menos tres meses con comision');
  assert.ok(meses[0].actual && meses[0].pendiente > 0, 'mes en curso con comision por pagar');
  assert.ok(meses[1].pendiente > 0 && meses[1].pendiente < meses[1].comision, 'mes pasado: parte pagada, parte pendiente');
  assert.ok(meses.slice(2).every(m => m.pendiente === 0), 'meses viejos pagados');

  const liq = await app.request('/api/liquidaciones');
  const artista = liq.find(f => f.ubicacionId === 'consigna');
  assert.ok(artista.pctEfectivo > artista.pctBase, 'los tramos por meta suben el % de la artista');

  const filas = await app.request('/api/ventas/todas?ubicacionId=todas');
  assert.ok(filas.some(v => v.modoComision === 'counter' && v.ubicacionTipo && v.ubicacionTipo !== 'propio'),
    'hay COUNTER SALE en una percha que comparte comision');

  const backup = await app.request('/api/respaldo/exportar');
  const conSplit = backup.ventas.filter(v => v.split);
  assert.ok(conSplit.length >= 10);
  for (const v of conSplit) {
    const s = v.split;
    assert.equal(+(s.montoComisionSocio + s.montoNetoDueno).toFixed(2), +s.montoBruto.toFixed(2), `invariante en ${v.id}`);
  }
});
