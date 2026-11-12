'use strict';
// P0 v737 (revision Fable 5.2 de la PR #698): las rutas viejas tambien siguen
// "vender siempre": deshacer cancelacion, cierre del dia, subir cantidad al
// editar, e historial al reponer con faltante. Las TRANSFERENCIAS siguen
// rechazando por stock (no se tocan). Fixtures sinteticos, sin red.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { browser } = require('./helpers/browser.cjs');

const dueno = (w) => { w.OCAuth = Object.assign(w.OCAuth || {}, { rolActual: () => 'dueno', esDemo: () => false }); return w; };
const exportar = (w) => w.request('/api/respaldo/exportar');
const prodDe = async (w, id) => (await exportar(w)).productos.find((p) => p.id === id);
async function conSocio(w, stock, sku) {
  const a = await w.request('/api/promotoras', 'POST', { nombre: 'Socia sintetica', comisionBase: 40 });
  const r = await w.request('/api/ubicaciones', 'POST', { nombre: 'Percha sintetica', tipo: 'socio' });
  await w.request('/api/ubicaciones/' + r.id, 'PUT', { promotoraId: a.id });
  const p = await w.request('/api/productos', 'POST', { nombre: 'Prod sintetico', sku, barcode: sku, precio: 100, costo: 20, stockInicial: stock, ubicacionId: r.id });
  return { a, r, p };
}
const debida = async (w, rid) => (await w.request('/api/liquidaciones')).find((x) => x.ubicacionId === rid).stillDue;

test('DESHACER CANCELACION: sin stock se recupera la venta con su comision y el faltante', async () => {
  const w = dueno(browser());
  const { r, p } = await conSocio(w, 1, 'V737-R1');
  const v = await w.request(`/api/productos/${p.id}/venta`, 'POST', { cantidad: 3 });
  await w.request(`/api/ventas/${v.ventaId}/cancelar`, 'POST', { motivo: 'prueba' });
  let pr = await prodDe(w, p.id);
  assert.equal(pr.stockActual, 1);
  assert.equal(pr.stockDeficit, 0);
  assert.equal(await debida(w, r.id), 0);
  const u = await w.request(`/api/ventas/${v.ventaId}/deshacer-cancelacion`, 'POST', {});
  assert.ok(u.ok, 'la app deja recuperar la venta: ' + JSON.stringify(u));
  pr = await prodDe(w, p.id);
  assert.equal(pr.stockActual, 0);
  assert.equal(pr.stockDeficit, 2);
  assert.equal(await debida(w, r.id), 120, 'comision del 40% sobre 300');
});

test('CIERRE DEL DIA: un producto sin stock registra la venta con faltante, nada se pierde', async () => {
  const w = dueno(browser());
  const { r, p } = await conSocio(w, 1, 'V737-R2');
  const res = await w.request('/api/ventas/cierre', 'POST', { items: [{ productoId: p.id, cantidad: 4 }] });
  assert.equal(res.aplicadas, 4);
  assert.deepEqual(res.errores, []);
  const e = await exportar(w);
  const pr = e.productos.find((x) => x.id === p.id);
  assert.equal(pr.stockActual, 0);
  assert.equal(pr.stockDeficit, 3);
  assert.equal(e.ventas.filter((x) => x.productoId === p.id).length, 1, 'la venta existe');
  assert.equal(pr.stockPN && Object.values(pr.stockPN).reduce((s, c) => s + c.sub, 0), 4);
  assert.equal(await debida(w, r.id), 160);
});

test('EDITAR VENTA: subir la cantidad sin stock procede y suma al faltante', async () => {
  const w = dueno(browser());
  const { r, p } = await conSocio(w, 2, 'V737-R3');
  const v = await w.request(`/api/productos/${p.id}/venta`, 'POST', { cantidad: 2 });
  const ed = await w.request(`/api/ventas/${v.ventaId}`, 'PATCH', { cantidad: 5 });
  assert.ok(!ed.error, 'la edicion se acepta: ' + JSON.stringify(ed));
  const pr = await prodDe(w, p.id);
  assert.equal(pr.stockActual, 0);
  assert.equal(pr.stockDeficit, 3);
  assert.equal(await debida(w, r.id), 200);
});

test('HISTORIAL: reponer con faltante anota el stock resultante que la percha muestra', async () => {
  const w = dueno(browser());
  const { p } = await conSocio(w, 1, 'V737-R4');
  await w.request(`/api/productos/${p.id}/venta`, 'POST', { cantidad: 3 }); // faltan 2
  await w.request(`/api/productos/${p.id}/ajustar`, 'POST', { delta: 5, motivo: 'Reposicion sintetica' });
  const e = await exportar(w);
  assert.equal(e.productos.find((x) => x.id === p.id).stockActual, 3);
  const m = e.movimientos.filter((x) => x.tipo === 'ajuste').pop();
  assert.equal(m.detalle.stockResultante, 3);
});

test('TRANSFERENCIAS: siguen rechazando por stock', async () => {
  const w = dueno(browser());
  const { p } = await conSocio(w, 1, 'V737-R5');
  const r2 = await w.request('/api/ubicaciones', 'POST', { nombre: 'Destino sintetico', tipo: 'socio' });
  const d = await w.request('/api/productos', 'POST', { nombre: 'Prod sintetico', sku: 'V737-R5', barcode: 'V737-R5B', precio: 100, costo: 20, stockInicial: 0, ubicacionId: r2.id });
  const t = await w.request('/api/transferencias', 'POST', { productoOrigenId: p.id, productoDestinoId: d.id, cantidad: 5 }).catch((e) => ({ error: String(e.message) }));
  assert.ok(t && t.error, 'transferir mas de lo que hay se rechaza');
});
