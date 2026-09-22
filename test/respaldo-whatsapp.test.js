/* Import/Export por WhatsApp (Forma B) — viaje completo (JFC 2026-09-22).

   POR QUÉ IMPORTA MÁS QUE UN TEST NORMAL: importar REEMPLAZA todo el negocio.
   No agrega, no mezcla: borra productos, ventas, clientes e inventario y pone
   los del archivo. Es la operación más destructiva que tiene la app, y hasta
   hoy no había ni una prueba de que (a) el viaje conserve realmente los datos
   ni (b) un archivo malo NO pueda dejar a un negocio real sin nada.

   Se prueba el par CASADO tal como lo arma el botón: el paquete Forma B es
   {schemaVersion, datos, fotosPerchas, fotosIDB} y el import manda `datos` a
   /respaldo/importar. Las fotos tienen su propia prueba en backup-fotos.test.js
   (el agujero que se cerró en v334); aquí se cubre todo lo demás. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { browser } = require('./helpers/browser.cjs');

// Arma un negocio con datos en TODAS las colecciones que viajan, para que el
// round-trip no pase por tener poco que perder.
async function negocioPoblado() {
  const a = browser();
  const percha = await a.request('/api/ubicaciones', 'POST', { nombre: 'Percha viajera', tipo: 'socio', comisionSocio: 40 });
  const prom = await a.request('/api/promotoras', 'POST', { nombre: 'Comisionista viajera', comisionBase: 25 });
  await a.request(`/api/ubicaciones/${percha.id}`, 'PUT', { promotoraId: prom.id });
  const cli = await a.request('/api/clientes', 'POST', { nombre: 'Cliente viajero', telefono: '0999000111' });
  const prod = await a.request('/api/productos', 'POST', {
    nombre: 'Producto viajero', barcode: 'FIXTURE-VIAJERO-1', precio: 10, costo: 4,
    stockActual: 7, ubicacionId: percha.id,
  });
  // Un producto nuevo nace con stock 0 a propósito (el stock es físico de cada
  // percha), así que se carga por el ajuste, que es la vía real de la app.
  await a.request(`/api/productos/${prod.id}/ajustar`, 'POST', { delta: 7, motivo: 'Carga fixture' });
  await a.request(`/api/productos/${prod.id}/venta`, 'POST', { cantidad: 2, clienteId: cli.id });
  return { a, percha, prom, cli, prod };
}

// Envoltorio Forma B, igual que lo arma el botón "Export via WhatsApp".
async function paqueteFormaB(dispositivo) {
  const datos = await dispositivo.request('/api/respaldo/exportar');
  return JSON.parse(JSON.stringify({
    schemaVersion: 2, fecha: new Date().toISOString(), _formaB: true,
    datos, fotosPerchas: {}, fotosIDB: {},
  }));
}

test('the whole business survives the WhatsApp round-trip into a clean device', async () => {
  const { a, percha, prom, cli, prod } = await negocioPoblado();
  const paquete = await paqueteFormaB(a);

  // Aparato nuevo, con su propia semilla: el import tiene que REEMPLAZARLA.
  const b = browser();
  const r = await b.request('/api/respaldo/importar', 'POST', paquete.datos);
  assert.equal(r.ok, true);

  const estado = await b.request('/api/respaldo/exportar');
  const prodB = estado.productos.find(p => p.id === prod.id);
  assert.ok(prodB, 'el producto viajó');
  assert.equal(prodB.nombre, 'Producto viajero');
  assert.equal(prodB.stockActual, 5, 'y con su stock DESPUÉS de la venta, no el original');

  const perchaB = estado.ubicaciones.find(u => u.id === percha.id);
  assert.ok(perchaB, 'la percha viajó');
  assert.equal(perchaB.promotoraId, prom.id, 'con su comisionista asignado');
  assert.equal(perchaB.comisionSocio, 40, 'y su porcentaje: el dinero no se pierde en el viaje');

  assert.ok(estado.promotoras.find(p => p.id === prom.id), 'el comisionista viajó');
  assert.ok(estado.clientes.find(c => c.id === cli.id), 'el cliente viajó');
  // Fidelidad del viaje: el destino tiene EXACTAMENTE las ventas del archivo,
  // ni una menos (pérdida) ni una más (mezcla con lo que ya tenía el aparato).
  assert.equal(estado.ventas.length, paquete.datos.ventas.length, 'llegaron todas las ventas, sin mezclar');
  const miVenta = estado.ventas.find(v => v.productoId === prod.id);
  assert.ok(miVenta, 'incluida la venta recién hecha');
  assert.equal(miVenta.cantidad, 2);

  // La semilla del aparato nuevo NO debe sobrevivir mezclada con lo importado:
  // un import es un reemplazo, y una mezcla silenciosa daría inventario falso.
  assert.equal(estado.ubicaciones.length, paquete.datos.ubicaciones.length,
    'no quedaron perchas de la semilla anterior mezcladas');
});

test('per-shelf monthly expenses survive too, not just the headline collections', async () => {
  const { a, percha } = await negocioPoblado();
  await a.request(`/api/ubicaciones/${percha.id}/gasto-mensual`, 'PUT', { monto: 125 })
    .catch(async () => { await a.request(`/api/ubicaciones/${percha.id}`, 'PUT', { gastoMensual: 125 }); });

  const paquete = await paqueteFormaB(a);
  const enviado = paquete.datos.configuracion && paquete.datos.configuracion.gastosMensuales;
  assert.ok(enviado && typeof enviado === 'object', 'el respaldo lleva la configuración de gastos mensuales');

  const b = browser();
  await b.request('/api/respaldo/importar', 'POST', paquete.datos);
  const estado = await b.request('/api/respaldo/exportar');
  assert.deepEqual(estado.configuracion.gastosMensuales, enviado,
    'y se restauran: viajaban en el archivo pero nadie probaba que llegaran');
});

test('a corrupt file is REJECTED and the existing business is left untouched', async () => {
  // Este es el escenario que no puede fallar nunca: importar reemplaza TODO,
  // así que un archivo malo que pase la validación deja a un negocio real sin
  // sus datos.
  const { a, prod } = await negocioPoblado();
  const antes = await a.request('/api/respaldo/exportar');

  const basura = [
    { caso: 'no es un respaldo', cuerpo: { cualquier: 'cosa' } },
    { caso: 'productos no es lista', cuerpo: { productos: 'no-es-lista', ubicaciones: [] } },
    { caso: 'producto con stock negativo', cuerpo: {
        productos: [{ id: 'p1', nombre: 'Malo', precio: 1, costo: 1, stockActual: -5, ubicacionId: 'u1' }],
        ubicaciones: [{ id: 'u1', nombre: 'U' }] } },
    { caso: 'producto apunta a percha inexistente', cuerpo: {
        productos: [{ id: 'p1', nombre: 'Huerfano', precio: 1, costo: 1, stockActual: 1, ubicacionId: 'no-existe' }],
        ubicaciones: [{ id: 'u1', nombre: 'U' }] } },
    { caso: 'ids de producto duplicados', cuerpo: {
        productos: [
          { id: 'dup', nombre: 'A', precio: 1, costo: 1, stockActual: 1, ubicacionId: 'u1' },
          { id: 'dup', nombre: 'B', precio: 1, costo: 1, stockActual: 1, ubicacionId: 'u1' }],
        ubicaciones: [{ id: 'u1', nombre: 'U' }] } },
  ];

  for (const { caso, cuerpo } of basura) {
    await assert.rejects(() => a.request('/api/respaldo/importar', 'POST', cuerpo), /400/, `debe rechazar: ${caso}`);
  }

  const despues = await a.request('/api/respaldo/exportar');
  assert.equal(despues.productos.length, antes.productos.length, 'ningún rechazo tocó el inventario');
  assert.ok(despues.productos.find(p => p.id === prod.id), 'el producto real sigue ahí');
  assert.equal(despues.ventas.length, antes.ventas.length, 'ni las ventas');
});

test('a good import leaves an undo snapshot, because replacing everything deserves a way back', async () => {
  const { a } = await negocioPoblado();
  const original = await a.request('/api/respaldo/exportar');

  const otro = browser();
  const paqueteAjeno = await paqueteFormaB(otro);
  await a.request('/api/respaldo/importar', 'POST', paqueteAjeno.datos);

  // Red de seguridad: la app guarda el estado PREVIO antes de reemplazarlo.
  const clave = [...a.localStorage ? [] : []]; // (el fixture expone el storage abajo)
  let encontrada = null;
  for (let i = 0; i < a.localStorage.length; i++) {
    const k = a.localStorage.key(i);
    if (k && k.endsWith('_preimport')) encontrada = k;
  }
  assert.ok(encontrada, 'quedó un snapshot previo al import');
  const previo = JSON.parse(a.localStorage.getItem(encontrada));
  assert.equal(previo.productos.length, original.productos.length,
    'y contiene el negocio de ANTES: un archivo equivocado se puede deshacer');
  assert.equal(clave.length, 0);
});
