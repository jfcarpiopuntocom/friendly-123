/* v457 (owner LAW, JFC 2026-10-07, decision (b) "Recalcular al % del producto"): las ventas VIEJAS de un producto que hoy trae
   su % y su asociado, guardadas SIN reparto, se recalculan al % del producto (meses anteriores y ventas ya liquidadas incluidos)
   SIN editar ni borrar la venta original: un ajuste append-only por venta, id determinista adj-retro-<ventaId>, centavos enteros.
   Producto con % pero SIN asociado: no se crea nada y se lista en el reporte. Idempotente. Datos sinteticos, sin red. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { browser } = require('./helpers/browser.cjs');

const PCT = 30;
const mesRelativo = (atras, dia) => { const d = new Date(); const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - atras, dia, 15, 0, 0)); return t.toISOString(); };
const MES = (iso) => iso.slice(0, 7);
const esperadoCent = (v) => Math.round(Math.round(((v.precioUnit * v.cantidad) * 100)) * PCT * 100 / 10000);

/* Cuaderno viejo por la puerta honesta: ventas hechas por la app, dejadas como las guardaba un shell viejo (sin split), importadas,
   y el aparato REINICIADO (browser(ls) = arranque). Devuelve el aparato antes del reinicio y el estado exportado antes de reiniciar. */
async function cuadernoViejo({ conAsociado = true } = {}) {
  const a0 = browser();
  a0.OCAuth = { rolActual: () => 'dueno' };
  const ana = await a0.request('/api/promotoras', 'POST', { nombre: 'Ana Retro', comisionBase: 50 });
  const rack = await a0.request('/api/ubicaciones', 'POST', { nombre: 'Propia Retro', tipo: 'propio' });
  const body = { nombre: 'Taza Retro', barcode: 'RETRO-1', sku: 'RETRO-1', precio: 12.35, costo: 4, stockInicial: 60, ubicacionId: rack.id, pctAsociado: PCT };
  if (conAsociado) body.comisionistaId = ana.id;
  const p = await a0.request('/api/productos', 'POST', body);
  for (const c of [3, 1, 8]) await a0.request(`/api/productos/${p.id}/venta`, 'POST', { cantidad: c });
  const est = await a0.request('/api/respaldo/exportar');
  const fechas = [mesRelativo(2, 15), mesRelativo(1, 12), mesRelativo(0, 2)];
  est.ventas.filter((v) => v.productoId === p.id).forEach((v, i) => {
    v.split = null; v.modoComision = 'counter'; v.promotoraId = null; delete v.canalVenta; v.fecha = fechas[i]; v.liquidada = i === 1; // la del mes 2 ya "liquidada"
  });
  est.ajustesComision = [];
  const ls = a0.localStorage;
  const a1 = browser(ls);
  a1.OCAuth = { rolActual: () => 'dueno' };
  const r = await a1.request('/api/respaldo/importar', 'POST', est);
  assert.ok(!r.error, 'importar: ' + JSON.stringify(r));
  const antes = await a1.request('/api/respaldo/exportar');
  return { ls, antes, ana, rack, p, fechas, a1 };
}
const reiniciar = (ls) => { const w = browser(ls); w.OCAuth = { rolActual: () => 'dueno' }; return w; };
const delProducto = (est, pid) => est.ventas.filter((v) => v.productoId === pid);
const cuadre = (w, mes) => w.request('/api/comisiones/cuadre?mes=' + mes);

test('old sales with no split are recalculated at the product %: 3 adjustments, exact cents, original sales untouched', async () => {
  const { ls, antes, ana, p, a1 } = await cuadernoViejo();
  assert.equal(antes.ajustesComision.length, 0, 'el cuaderno viejo no trae ajustes');
  const ventasAntes = delProducto(antes, p.id);
  assert.equal(ventasAntes.length, 3);
  assert.ok(ventasAntes.every((v) => v.split === null), 'las 3 se guardaron sin reparto');

  /* El demo semilla trae sus propias ventas y comisiones: se mide el DELTA contra el mismo aparato antes de reiniciar. */
  const previo = {}; for (const v of ventasAntes) previo[MES(v.fecha)] = await cuadre(a1, MES(v.fecha));
  const app = reiniciar(ls);
  const est = await app.request('/api/respaldo/exportar');
  const aj = est.ajustesComision;
  assert.equal(aj.length, 3, 'un ajuste por venta: ' + JSON.stringify(aj.map((a) => a.id)));
  for (const v of ventasAntes) {
    const a = aj.find((x) => x.id === 'adj-retro-' + v.id);
    assert.ok(a, 'id determinista adj-retro-<ventaId>');
    assert.equal(a.ventaId, v.id);
    assert.equal(a.motivo, 'recalculo retroactivo al % del producto');
    assert.equal(a.reparto.length, 1);
    assert.equal(a.reparto[0].promotoraId, ana.id, 'el cobrador es el asociado del PRODUCTO');
    assert.equal(Math.round(a.reparto[0].monto * 100), esperadoCent(v), 'centavos exactos al ' + PCT + '%');
    assert.equal(MES(a.fecha), MES(v.fecha), 'cae en el mes de la venta');
    assert.equal(a.liquidada, false);
  }
  assert.deepEqual(delProducto(est, p.id), ventasAntes, 'las ventas originales no se editan ni se borran');

  /* Ledger: ganado y por pagar suben EXACTAMENTE el 30% de cada venta, tambien la ya liquidada. */
  const PL = app.OCPayoutLedger;
  for (const v of ventasAntes) {
    const mes = MES(v.fecha);
    const rows = PL.balancesByPayee({ sales: est.ventas.filter((x) => !x.anulada), adjustments: est.ajustesComision, locations: est.ubicaciones, payouts: est.payouts || [], month: mes })
      .filter((r) => r.payeeId === ana.id);
    assert.equal(rows.length, 1, 'ledger mes ' + mes);
    assert.equal(rows[0].earnedCents, esperadoCent(v), 'earned ' + mes);
    assert.equal(rows[0].dueCents, esperadoCent(v), 'still due ' + mes + (v.liquidada ? ' (venta ya liquidada: pasa a nuevo Still due)' : ''));
    const c = await cuadre(app, mes);
    const q = previo[mes];
    assert.equal(Math.round(c.comisionAsociados * 100) - Math.round(q.comisionAsociados * 100), esperadoCent(v), 'Commissions (cuadre) earned sube el ' + PCT + '% ' + mes);
    assert.equal(Math.round(c.porPagar * 100) - Math.round(q.porPagar * 100), esperadoCent(v), 'Commissions (cuadre) por pagar sube el ' + PCT + '% ' + mes);
  }
});

test('running it again creates nothing new (restart x2 and explicit call)', async () => {
  const { ls, p } = await cuadernoViejo();
  const a2 = reiniciar(ls);
  const e2 = await a2.request('/api/respaldo/exportar');
  assert.equal(e2.ajustesComision.length, 3);
  const r = a2.OCComisionRetro.aplicar();
  assert.equal(r.creados, 0, 'llamada explicita: nada nuevo');
  const a3 = reiniciar(ls);
  const e3 = await a3.request('/api/respaldo/exportar');
  assert.equal(e3.ajustesComision.length, 3, 'tras otro arranque siguen 3');
  assert.deepEqual(e3.ajustesComision.map((a) => a.id).sort(), delProducto(e3, p.id).map((v) => 'adj-retro-' + v.id).sort());
});

test('no double count: sales that already carry a split are never adjusted', async () => {
  const { ls, p, ana } = await cuadernoViejo();
  const a1 = reiniciar(ls);
  /* una venta nueva por la app trae su reparto: no recibe ajuste */
  await a1.request('/api/productos/' + p.id + '/venta', 'POST', { cantidad: 2 });
  const r = a1.OCComisionRetro.aplicar();
  assert.equal(r.creados, 0);
  const e = await a1.request('/api/respaldo/exportar');
  const nueva = delProducto(e, p.id).pop();
  assert.ok(nueva.split && nueva.split.montoComisionSocio > 0, 'la venta nueva ya comisiona por si sola');
  assert.ok(!e.ajustesComision.some((a) => a.ventaId === nueva.id));
  assert.ok(ana.id);
});

test('product with a % but NO associate: nothing created, the sales are listed in the report', async () => {
  const { ls, antes, p } = await cuadernoViejo({ conAsociado: false });
  const app = reiniciar(ls);
  const est = await app.request('/api/respaldo/exportar');
  assert.equal(est.ajustesComision.length, 0, 'sin asociado no se crea nada');
  const rep = JSON.parse(JSON.stringify(app.OCComisionRetro.reporte())); // cruza el contexto vm
  assert.deepEqual(rep.map((x) => x.ventaId).sort(), delProducto(antes, p.id).map((v) => v.id).sort(), 'las 3 ventas quedan listadas');
  assert.ok(rep.every((x) => x.productoId === p.id && x.pct === PCT));
});

test('setting the associate later (product edit) triggers the recalculation offline', async () => {
  const { ls, p, ana } = await cuadernoViejo({ conAsociado: false });
  const app = reiniciar(ls);
  assert.equal((await app.request('/api/respaldo/exportar')).ajustesComision.length, 0);
  await app.request('/api/productos/' + p.id, 'PATCH', { comisionistaId: ana.id });
  const e = await app.request('/api/respaldo/exportar');
  assert.equal(e.ajustesComision.length, 3, 'al fijar el asociado se recalculan las 3');
  assert.equal(app.OCComisionRetro.reporte().length, 0);
  await app.request('/api/productos/' + p.id, 'PATCH', { pctAsociado: 30 });
  assert.equal((await app.request('/api/respaldo/exportar')).ajustesComision.length, 3, 'idempotente tambien por el camino de edicion');
});
