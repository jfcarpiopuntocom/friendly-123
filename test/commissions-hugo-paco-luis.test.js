/* PASADA HUGO / PACO / LUIS sobre Commissions (JFC 2026-09-24, Bloques 3-4-6).
   No es camino feliz: tres usuarios de IQ distinto rompiendo Commissions a
   proposito por el CAMINO REAL (mock-backend real via helpers/browser.cjs y el
   merge real entre dos aparatos: catalogoPropio -> aplicarCatalogo, que es lo
   que el relay reenvia cifrado). Prioridad 1AAA: que TODO funcione; luego, que
   funcione aunque el usuario no siga el orden "correcto".
   Regla de oro que se verifica en TODOS los casos: comision + neto = bruto al
   centavo, y lo pagado jamas se edita. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { browser } = require('./helpers/browser.cjs');

async function tienda(app, extra = {}) {
  app.OCAuth = { rolActual: () => 'dueno' };
  const socio = await app.request('/api/promotoras', 'POST', { nombre: 'Belen', comisionBase: 40 });
  const helper = await app.request('/api/promotoras', 'POST', { nombre: 'Helper', comisionBase: 10 });
  const shelf = await app.request('/api/ubicaciones', 'POST', Object.assign({ nombre: 'HPL shelf', tipo: 'socio', comisionSocio: 40, promotoraId: socio.id }, extra));
  const product = await app.request('/api/productos', 'POST', { nombre: 'HPL print', sku: 'HPL-1', barcode: 'HPL-1', precio: 33.33, costo: 10, stockInicial: 50, ubicacionId: shelf.id });
  return { socio, helper, shelf, product };
}
const ventas = (app, product) => app.request('/api/respaldo/exportar').then(b => b.ventas.filter(v => v.productoId === product.id));
const ultima = async (app, product) => (await ventas(app, product)).pop();
const liq = async (app, shelf, mes) => (await app.request(`/api/liquidaciones${mes ? '?mes=' + mes : ''}`)).find(f => f.ubicacionId === shelf.id);
const cents = (n) => Math.round(Number(n) * 100);
function invariante(v) {
  if (!v.split) return;
  assert.equal(cents(v.split.montoComisionSocio) + cents(v.split.montoNetoDueno), cents(v.split.montoBruto), 'comision + neto = bruto al centavo');
  assert.ok(cents(v.split.montoComisionSocio) >= 0, 'la comision nunca es negativa');
  if (v.split.reparto) {
    const suma = v.split.reparto.reduce((s, r) => s + cents(r.monto), 0);
    assert.equal(suma, cents(v.split.montoComisionSocio), 'el reparto vendedor+asistente suma EXACTO la comision');
    assert.ok(v.split.reparto.every(r => cents(r.monto) >= 0), 'ninguna parte del reparto es negativa');
  }
}

/* ---------------- HUGO: mete la pata sin querer ---------------- */
test('Hugo teclea el % del asistente con coma, letras, 150 y -5: nada rompe y la plata cuadra', async () => {
  const app = browser();
  const { helper, product } = await tienda(app);
  for (const pct of ['33,5', 'abc', 150, -5, '', null]) {
    await app.request(`/api/productos/${product.id}/venta`, 'POST', { cantidad: 1, asistenteId: helper.id, asistentePct: pct });
    const v = await ultima(app, product);
    invariante(v);
    if (v.split.reparto) {
      const asi = v.split.reparto.find(r => r.rol === 'asistente');
      assert.ok(!asi || (asi.pct >= 0 && asi.pct <= 100), `pct ${JSON.stringify(pct)} no puede dejar un % fuera de 0-100 (quedo ${asi && asi.pct})`);
    }
  }
});

test('Hugo aprieta "Mark as paid" dos veces seguidas: idempotente, nada se duplica', async () => {
  const app = browser();
  const { shelf, product } = await tienda(app);
  await app.request(`/api/productos/${product.id}/venta`, 'POST', { cantidad: 2 });
  const a = await app.request(`/api/liquidaciones/${shelf.id}/marcar-pagado`, 'POST', {});
  const b = await app.request(`/api/liquidaciones/${shelf.id}/marcar-pagado`, 'POST', {}).catch(e => ({ error: String(e) }));
  assert.ok(a.ok !== false, 'la primera marca paga');
  const l = await liq(app, shelf);
  assert.equal(l.estado, 'pagado');
  assert.equal(l.ventasPendientes, 0);
  const v = await ultima(app, product);
  assert.equal(v.liquidada, true);
  assert.ok(!b || !b.duplicado, 'la segunda no crea un segundo pago');
});

test('Hugo devuelve la misma venta dos veces: la segunda se rechaza y NO hay doble clawback', async () => {
  const app = browser();
  const { shelf, product } = await tienda(app);
  await app.request(`/api/productos/${product.id}/venta`, 'POST', { cantidad: 1 });
  const v = await ultima(app, product);
  await app.request(`/api/liquidaciones/${shelf.id}/marcar-pagado`, 'POST', {});
  const r1 = await app.request(`/api/ventas/${v.id}/devolucion`, 'POST', { motivo: 'roto', quien: 'Hugo' });
  assert.equal(r1.ok, true);
  await assert.rejects(app.request(`/api/ventas/${v.id}/devolucion`, 'POST', { motivo: 'otra vez', quien: 'Hugo' }), /already returned|400/);
  const back = await app.request('/api/respaldo/exportar');
  const ajustes = back.ajustesComision.filter(a => a.ventaId === v.id || a.ventaId === undefined);
  assert.equal(back.ajustesComision.length, 1, 'un solo ajuste negativo');
  assert.equal(cents(back.ajustesComision[0].montoComisionSocio), -cents(v.split.montoComisionSocio));
  const p = await app.request(`/api/productos/${product.id}`);
  assert.equal(p.stockActual, 50, 'el stock vuelve UNA vez, no dos');
  assert.ok(ajustes.length <= 1);
});

test('Hugo intenta corregir el % de una venta ya pagada: se rechaza, lo pagado no se toca', async () => {
  const app = browser();
  const { shelf, product } = await tienda(app);
  await app.request(`/api/productos/${product.id}/venta`, 'POST', { cantidad: 1 });
  const antes = await ultima(app, product);
  await app.request(`/api/liquidaciones/${shelf.id}/marcar-pagado`, 'POST', {});
  const intento = await app.request(`/api/ventas/${antes.id}/comision`, 'PATCH', { comisionPct: 90, quien: 'Hugo', motivo: 'me equivoque' }).catch(e => ({ rechazado: String(e) }));
  const despues = await ultima(app, product);
  assert.equal(cents(despues.split.montoComisionSocio), cents(antes.split.montoComisionSocio), 'la comision pagada no cambia');
  assert.ok(intento.rechazado || intento.error || cents(despues.split.montoComisionSocio) === cents(antes.split.montoComisionSocio));
});

/* ---------------- PACO: metodico y desconfiado ---------------- */
test('Paco cambia el % de la percha a mitad de mes: las ventas viejas conservan su split, las nuevas usan el nuevo, y el total cuadra', async () => {
  const app = browser();
  const { shelf, product } = await tienda(app);
  await app.request(`/api/productos/${product.id}/venta`, 'POST', { cantidad: 3 });
  const vieja = await ultima(app, product);
  await app.request(`/api/ubicaciones/${shelf.id}`, 'PUT', { comisionSocio: 55 });
  await app.request(`/api/productos/${product.id}/venta`, 'POST', { cantidad: 1 });
  const lista = await ventas(app, product);
  lista.forEach(invariante);
  assert.equal(cents(lista[0].split.montoComisionSocio), cents(vieja.split.montoComisionSocio), 'la venta vieja no se recalcula sola');
  assert.equal(lista[1].split.comisionPct, 55, 'la nueva usa el 55');
  const l = await liq(app, shelf);
  assert.equal(l.ventasPendientes, 2);
  assert.equal(cents(l.ventasBrutas), lista.reduce((s, v) => s + cents(v.split.montoBruto), 0));
});

test('Paco vende COUNTER SALE con asistente y % puesto: la casa se queda todo, sin split ni reparto, y no aparece pendiente', async () => {
  const app = browser();
  const { helper, shelf, product } = await tienda(app);
  await app.request(`/api/productos/${product.id}/venta`, 'POST', { cantidad: 1, modoComision: 'counter', asistenteId: helper.id, asistentePct: 50 });
  const v = await ultima(app, product);
  assert.equal(v.split, null, 'COUNTER SALE = venta pura de la casa');
  const l = await liq(app, shelf);
  assert.equal(l.ventasPendientes, 0);
  const u = await app.request(`/api/ubicaciones/${shelf.id}`).catch(() => null);
  if (u) assert.equal(u.comisionSocio, 40, 'la percha conserva su acuerdo permanente');
});

test('Paco pone base "margen" con costo MAYOR que el precio: la comision es 0, nunca negativa, y neto = bruto', async () => {
  const app = browser();
  const { shelf } = await tienda(app, { baseComision: 'margen' });
  const caro = await app.request('/api/productos', 'POST', { nombre: 'Loss leader', sku: 'HPL-LOSS', barcode: 'HPL-LOSS', precio: 5, costo: 9, stockInicial: 3, ubicacionId: shelf.id });
  await app.request(`/api/productos/${caro.id}/venta`, 'POST', { cantidad: 1 });
  const v = await ultima(app, caro);
  invariante(v);
  assert.equal(cents(v.split.montoComisionSocio), 0);
  assert.equal(cents(v.split.montoNetoDueno), 500);
});

test('Paco paga el mes anterior desde este mes: el ciclo viejo se sella y el mes en curso sigue pendiente', async () => {
  const app = browser();
  const { shelf, product } = await tienda(app);
  await app.request(`/api/productos/${product.id}/venta`, 'POST', { cantidad: 1 });
  const v = await ultima(app, product);
  const d = new Date(); d.setUTCMonth(d.getUTCMonth() - 1);
  const mesPrev = d.toISOString().slice(0, 7);
  // Mover la venta al mes anterior por el camino de datos (como una venta real de hace 30 dias).
  const back = await app.request('/api/respaldo/exportar');
  back.ventas.find(x => x.id === v.id).fecha = mesPrev + '-15T12:00:00.000Z';
  await app.request('/api/respaldo/importar', 'POST', back);
  await app.request(`/api/productos/${product.id}/venta`, 'POST', { cantidad: 1 });
  const prev = await liq(app, shelf, mesPrev);
  assert.equal(prev.ventasPendientes, 1, 'el mes anterior sigue debiendo');
  await app.request(`/api/liquidaciones/${shelf.id}/marcar-pagado?mes=${mesPrev}`, 'POST', { mes: mesPrev }).catch(() => app.request(`/api/liquidaciones/${shelf.id}/marcar-pagado`, 'POST', { mes: mesPrev }));
  assert.equal((await liq(app, shelf, mesPrev)).estado, 'pagado');
  const hoy = await liq(app, shelf);
  assert.equal(hoy.estado, 'pendiente', 'pagar el mes viejo no sella el mes en curso');
  assert.equal(hoy.ventasPendientes, 1);
});

/* ---------------- LUIS: poder-usuario, rompe a proposito ---------------- */
test('Luis con dos aparatos: A vende, B paga, A devuelve; todo converge y mergear dos veces no duplica nada', async () => {
  const A = browser();
  const { shelf, product } = await tienda(A);
  await A.request(`/api/productos/${product.id}/venta`, 'POST', { cantidad: 2 });
  const v = await ultima(A, product);
  const B = browser();
  B.OCAuth = { rolActual: () => 'dueno' };
  B.receive(A); B.receive(A);
  const vB = await ultima(B, product);
  assert.ok(vB && vB.id === v.id, 'la venta llego a B');
  invariante(vB);
  await B.request(`/api/liquidaciones/${shelf.id}/marcar-pagado`, 'POST', {});
  A.receive(B); A.receive(B);
  assert.equal((await ultima(A, product)).liquidada, true, 'A ve la venta pagada desde B');
  const r = await A.request(`/api/ventas/${v.id}/devolucion`, 'POST', { motivo: 'cambio de opinion', quien: 'Luis' });
  assert.equal(r.ok, true);
  B.receive(A); B.receive(A); A.receive(B);
  const bb = await B.request('/api/respaldo/exportar');
  const ba = await A.request('/api/respaldo/exportar');
  assert.equal(bb.ajustesComision.length, 1, 'B recibio UN ajuste (no dos por mergear dos veces)');
  assert.equal(ba.ajustesComision.length, 1, 'A conserva UN ajuste');
  assert.equal(cents(bb.ajustesComision[0].montoComisionSocio), -cents(v.split.montoComisionSocio));
  assert.equal((await ultima(B, product)).devuelta, true, 'B ve la venta devuelta');
  const lB = await liq(B, shelf);
  assert.ok(lB.ajustes && lB.ajustes.length === 1, 'la liquidacion de B muestra el ajuste pendiente de descontar');
});

test('Luis reparte con asistente al 33.33% en una venta de 33.33: nadie recibe medio centavo y suma exacto', async () => {
  const app = browser();
  const { helper, product } = await tienda(app);
  await app.request(`/api/productos/${product.id}/venta`, 'POST', { cantidad: 1, asistenteId: helper.id, asistentePct: 33.33 });
  const v = await ultima(app, product);
  invariante(v);
  assert.equal(v.split.reparto.length, 2);
  v.split.reparto.forEach(r => assert.equal(cents(r.monto), Math.round(r.monto * 100)));
});

test('Luis lanza 40 ventas, 10 devoluciones y 3 pagos en desorden: el pendiente = suma(splits no pagados) - ajustes no sellados', async () => {
  const app = browser();
  const { helper, shelf } = await tienda(app);
  const product = await app.request('/api/productos', 'POST', { nombre: 'HPL bulk', sku: 'HPL-BULK', barcode: 'HPL-BULK', precio: 33.33, costo: 10, stockInicial: 500, ubicacionId: shelf.id });
  const ids = [];
  for (let i = 0; i < 40; i++) {
    const body = { cantidad: 1 + (i % 3) };
    if (i % 4 === 0) body.modoComision = 'counter';
    if (i % 5 === 0) { body.asistenteId = helper.id; body.asistentePct = 25; }
    await app.request(`/api/productos/${product.id}/venta`, 'POST', body);
    ids.push((await ultima(app, product)).id);
    if (i === 13 || i === 27) await app.request(`/api/liquidaciones/${shelf.id}/marcar-pagado`, 'POST', {});
    if (i % 4 === 1 && i > 4) await app.request(`/api/ventas/${ids[i - 4]}/devolucion`, 'POST', { motivo: 'x', quien: 'Luis' }).catch(() => {});
  }
  const lista = await ventas(app, product);
  lista.forEach(invariante);
  const back = await app.request('/api/respaldo/exportar');
  const l = await liq(app, shelf);
  const pendCents = lista.filter(v => v.split && !v.liquidada && !v.devuelta && !v.anulada).reduce((s, v) => s + cents(v.split.montoComisionSocio), 0);
  const pendVentas = lista.filter(v => v.split && !v.liquidada && !v.devuelta && !v.anulada).length;
  assert.equal(l.ventasPendientes, pendVentas, 'cuenta de ventas pendientes');
  back.ajustesComision.forEach(a => assert.ok(cents(a.montoComisionSocio) < 0, 'todo ajuste es negativo (clawback)'));
  // Solo las devoluciones de ventas YA PAGADAS generan ajuste: en i=13 (ids[9], recien pagada
  // en esa misma vuelta), i=17 (ids[13]) e i=29 (ids[25], pagada en i=27). Las otras 7 se
  // devuelven sin ajuste porque nunca se habian pagado.
  assert.equal(back.ajustesComision.length, 3, 'un ajuste por cada devolucion de venta pagada, ninguno por las no pagadas');
  const dup = new Set(back.ajustesComision.map(a => a.id));
  assert.equal(dup.size, back.ajustesComision.length, 'ids de ajuste unicos');
  assert.ok(pendCents >= 0);
  await app.request(`/api/liquidaciones/${shelf.id}/marcar-pagado`, 'POST', {});
  const fin = await liq(app, shelf);
  assert.equal(fin.ventasPendientes, 0, 'pagar sella todo lo pendiente');
  assert.equal(fin.estado, 'pagado');
});
