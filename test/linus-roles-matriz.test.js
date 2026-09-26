// Revision nivel Linus, Bloque 3 (JFC 2026-09-25): permisos del EMPLEADO aplicados en el
// BACKEND, no solo escondidos en la interfaz. Rojo en v405: el empleado podia todo.
// Criterio de JFC: legal > operativo > mejores practicas (cajero de Square/Shopify/Lightspeed).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { browser } = require('./helpers/browser.cjs');

async function tienda() {
  const w = browser();
  let rol = 'dueno';
  w.OCAuth = { rolActual: () => rol };
  const pr = await w.request('/api/promotoras', 'POST', { nombre: 'Matriz', comisionBase: 20 });
  const u = await w.request('/api/ubicaciones', 'POST', { nombre: 'M', tipo: 'socio' });
  await w.request(`/api/ubicaciones/${u.id}`, 'PUT', { promotoraId: pr.id });
  const p = await w.request('/api/productos', 'POST', { nombre: 'M1', barcode: 'M-1', precio: 10, costo: 4, stockInicial: 9, ubicacionId: u.id });
  const { ventaId } = await w.request(`/api/productos/${p.id}/venta`, 'POST', { cantidad: 1, modoComision: 'associate', promotoraId: pr.id });
  return { w, p, pr, ventaId, como: (r) => { rol = r; } };
}
// El ayudante lanza ante un 4xx: se convierte en { error } para medirlo igual.
const negado = (res) => !!(res && res.error && /employee cannot/.test(res.error));
const intenta = async (p) => { try { return await p; } catch (e) { return { error: String(e && e.message) }; } };

test('empleado: no anula, no cambia precio/costo, no borra, no ve comisiones, no crea comisionistas', async () => {
  const t = await tienda();
  t.como('empleado');
  assert.ok(negado(await intenta(t.w.request('/api/liquidaciones'))), 'liquidaciones');
  assert.ok(negado(await intenta(t.w.request('/api/comisiones/cuadre'))), 'cuadre');
  assert.ok(negado(await intenta(t.w.request('/api/promotores/desempeno'))), 'ranking');
  assert.ok(negado(await intenta(t.w.request(`/api/ventas/${t.ventaId}/anular`, 'POST', {}))), 'anular');
  assert.ok(negado(await intenta(t.w.request(`/api/productos/${t.p.id}`, 'PUT', { precio: 1 }))), 'precio');
  assert.ok(negado(await intenta(t.w.request(`/api/productos/${t.p.id}`, 'PUT', { costo: 1 }))), 'costo');
  assert.ok(negado(await intenta(t.w.request(`/api/productos/${t.p.id}`, 'DELETE'))), 'borrar');
  assert.ok(negado(await intenta(t.w.request('/api/promotoras', 'POST', { nombre: 'X', comisionBase: 90 }))), 'crear comisionista');
  // Lo operativo sigue: vender, ver comisionistas para elegir en la venta, editar nombre sin tocar precio.
  const v = await t.w.request(`/api/productos/${t.p.id}/venta`, 'POST', { cantidad: 1 });
  assert.ok(v && v.ventaId, 'el empleado vende');
  assert.ok(Array.isArray(await t.w.request('/api/promotoras')), 'lista de comisionistas para la venta');
  const ed = await t.w.request(`/api/productos/${t.p.id}`, 'PUT', { nombre: 'M1 renamed', precio: 10 });
  assert.ok(!negado(ed), 'editar nombre con el mismo precio no se niega');
  // Nada cambio en el dinero por los intentos negados.
  t.como('dueno');
  const prod = (await t.w.request('/api/productos')).find((x) => x.id === t.p.id);
  assert.equal(prod.precio, 10); assert.equal(prod.costo, 4);
  assert.ok((await t.w.request('/api/ventas/todas')).some((x) => x.id === t.ventaId), 'la venta sigue viva');
});

test('admin y dueno siguen pudiendo todo eso (FIJACION)', async () => {
  for (const rol of ['admin', 'dueno']) {
    const t = await tienda();
    t.como(rol);
    assert.ok(!negado(await intenta(t.w.request('/api/liquidaciones'))), rol + ' liquidaciones');
    assert.ok(!negado(await intenta(t.w.request(`/api/productos/${t.p.id}`, 'PUT', { precio: 12 }))), rol + ' precio');
    const an = await t.w.request(`/api/ventas/${t.ventaId}/anular`, 'POST', {});
    assert.ok(!negado(an), rol + ' anula');
  }
});

test('respaldo: dueno completo; admin y empleado PARCIAL sin clientes ni costos; importar solo dueno', async () => {
  const t = await tienda();
  await t.w.request('/api/clientes', 'POST', { nombre: 'Cliente Secreto', telefono: '0999999999' }).catch(() => {});
  const completo = await t.w.request('/api/respaldo/exportar');
  assert.ok(!completo.parcial, 'dueno: completo');
  for (const rol of ['admin', 'empleado']) {
    t.como(rol);
    const r = await t.w.request('/api/respaldo/exportar');
    const txt = JSON.stringify(r);
    assert.equal(r.parcial, true, rol + ': parcial');
    assert.ok(!txt.includes('Cliente Secreto') && !txt.includes('0999999999'), rol + ': sin clientes');
    assert.ok(!/"costo"/.test(txt), rol + ': sin costos');
    assert.ok(r.ventas.some((v) => v.id === t.ventaId && v.split && v.split.montoComisionSocio === 2), rol + ': su venta y comision');
    const imp = await intenta(t.w.request('/api/respaldo/importar', 'POST', completo));
    assert.ok(imp && imp.error && /Only the owner/.test(imp.error), rol + ': no importa');
  }
});
