// Benchmark #6 (JFC 2026-09-24): el artista/comisionista carga sus piezas en SU
// percha con su propio PIN. Pruebas de permisos por rol escritas ANTES del
// codigo (PLAN-ARTISTA-CARGA-SU-PERCHA-2026-09-24.md). Tienen que salir rojas
// en shell v394 y verdes con el cambio. La ultima es de FIJACION (roles que ya
// funcionaban) y se rotula como tal.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { browser } = require('./helpers/browser.cjs');

async function tienda({ acceso = true } = {}) {
  const w = browser();
  w.OCAuth = { rolActual: () => 'dueno' };
  const ana = await w.request('/api/promotoras', 'POST', { nombre: 'Ana artista', comisionBase: 70 });
  const beto = await w.request('/api/promotoras', 'POST', { nombre: 'Beto artista', comisionBase: 70 });
  const rackAna = await w.request('/api/ubicaciones', 'POST', { nombre: 'Rack Ana' });
  const rackBeto = await w.request('/api/ubicaciones', 'POST', { nombre: 'Rack Beto' });
  await w.request(`/api/ubicaciones/${rackAna.id}`, 'PUT', { promotoraId: ana.id });
  await w.request(`/api/ubicaciones/${rackBeto.id}`, 'PUT', { promotoraId: beto.id });
  const pAna = await w.request('/api/productos', 'POST', { nombre: 'Taza Ana', barcode: 'ANA-1', precio: 20, costo: 7, stockInicial: 3, ubicacionId: rackAna.id, umbralRojo: 1, umbralAmarillo: 2 });
  const pBeto = await w.request('/api/productos', 'POST', { nombre: 'Cuadro Beto', barcode: 'BETO-1', precio: 90, costo: 30, stockInicial: 1, ubicacionId: rackBeto.id, umbralRojo: 1, umbralAmarillo: 2 });
  if (acceso) await w.request(`/api/promotoras/${ana.id}/acceso`, 'PUT', { pin: '614', activo: true });
  return { w, ana, beto, rackAna, rackBeto, pAna, pBeto };
}
function comoArtista(w, prom) {
  w.OCAuth.rolActual = () => 'artista';
  w.OCCurrentUser = null;
  w.OCCurrentArtista = { id: prom.id, nombre: prom.nombre };
}
const pieza = (extra = {}) => ({ nombre: 'Pieza nueva', barcode: 'NEW-' + Math.random().toString(36).slice(2, 8), precio: 45, stockInicial: 2, umbralRojo: 1, umbralAmarillo: 2, ...extra });

test('1. deny-by-default: an artist cannot reach any route outside the whitelist', async () => {
  const { w, ana, pAna } = await tienda();
  comoArtista(w, ana);
  const cerradas = [
    ['/api/ventas/hoy'], ['/api/ventas/todas'], ['/api/clientes'], ['/api/liquidaciones'],
    ['/api/dashboard'], ['/api/usuarios'], ['/api/gastos'], ['/api/movimientos'],
    ['/api/actividad'], ['/api/promotoras'], ['/api/reportes/pl'], ['/api/respaldo/exportar'],
    ['/api/directorio'], ['/api/inventario/bcg'], ['/api/lealtad'],
    ['/api/gastos', 'POST', { concepto: 'x', monto: 5 }],
    ['/api/clientes', 'POST', { nombre: 'x' }],
    ['/api/ubicaciones', 'POST', { nombre: 'Mi rack nuevo' }],
    ['/api/usuarios', 'POST', { nombre: 'x', pin: '615' }],
    [`/api/productos/${pAna.id}/venta`, 'POST', { cantidad: 1 }],
    [`/api/productos/${pAna.id}/ajustar`, 'POST', { cantidad: 5 }],
    ['/api/ruta-que-aun-no-existe'],
  ];
  for (const [url, method = 'GET', body] of cerradas) {
    await assert.rejects(() => w.request(url, method, body), /403/, `${method} ${url} must be closed to an artist`);
  }
});

test('2. an artist lists ONLY the pieces on their own rack, without cost', async () => {
  const { w, ana, pAna } = await tienda();
  comoArtista(w, ana);
  const lista = await w.request('/api/productos');
  assert.deepEqual(lista.map((p) => p.id), [pAna.id]);
  assert.equal(Object.hasOwn(lista[0], 'costo'), false);
  const racks = await w.request('/api/ubicaciones');
  assert.deepEqual(racks.map((u) => u.nombre), ['Rack Ana']);
});

test('3. a new piece is forced onto the artist rack and tied to the artist', async () => {
  const { w, ana, rackAna, rackBeto } = await tienda();
  comoArtista(w, ana);
  await assert.rejects(() => w.request('/api/productos', 'POST', pieza({ ubicacionId: rackBeto.id })), /403/);
  const p = await w.request('/api/productos', 'POST', pieza({ comisionistaId: 'otra-persona' }));
  w.OCAuth.rolActual = () => 'dueno';
  const guardado = (await w.request('/api/productos')).find((x) => x.id === p.id);
  assert.equal(guardado.ubicacionId, rackAna.id);
  assert.equal(w.catalog().productos.find((x) => x.id === p.id).comisionistaId, ana.id);
});

test('4. an artist with no rack assigned cannot add pieces', async () => {
  const { w, beto, rackBeto } = await tienda();
  await w.request(`/api/promotoras/${beto.id}/acceso`, 'PUT', { pin: '616', activo: true });
  await w.request(`/api/ubicaciones/${rackBeto.id}`, 'PUT', { promotoraId: null });
  comoArtista(w, beto);
  await assert.rejects(() => w.request('/api/productos', 'POST', pieza()), /ARTISTA_SIN_PERCHA/);
});

test('5. an artist cannot edit, archive or delete pieces, not even their own', async () => {
  const { w, ana, pAna } = await tienda();
  comoArtista(w, ana);
  await assert.rejects(() => w.request(`/api/productos/${pAna.id}`, 'PUT', { precio: 1 }), /403/);
  await assert.rejects(() => w.request(`/api/productos/${pAna.id}`, 'PATCH', { archivado: true }), /403/);
  await assert.rejects(() => w.request(`/api/productos/${pAna.id}`, 'DELETE', {}), /403/);
  await assert.rejects(() => w.request(`/api/productos/${pAna.id}/estrella`, 'POST', {}), /403/);
});

test('5b. an artist prints labels only for their own pieces', async () => {
  const { w, ana, pAna, pBeto } = await tienda();
  comoArtista(w, ana);
  const et = await w.request(`/api/productos/${pAna.id}/etiqueta`);
  assert.equal(et.producto.nombre, 'Taza Ana');
  await assert.rejects(() => w.request(`/api/productos/${pBeto.id}/etiqueta`), /403/);
});

test('6. the artist PIN is never returned by the associates list', async () => {
  const { w, ana } = await tienda();
  for (const rol of ['dueno', 'admin', 'empleado']) {
    w.OCAuth.rolActual = () => rol;
    const lista = await w.request('/api/promotoras');
    const a = lista.find((p) => p.id === ana.id);
    assert.equal(JSON.stringify(a).includes('614'), false, `${rol} must not see the artist PIN`);
    assert.equal(a.tieneAccesoArtista, true);
  }
});

test('7. only the owner or an admin sets or removes artist access', async () => {
  const { w, beto } = await tienda();
  for (const rol of ['empleado', 'contador', 'artista', '']) {
    w.OCAuth.rolActual = () => rol;
    await assert.rejects(() => w.request(`/api/promotoras/${beto.id}/acceso`, 'PUT', { pin: '617', activo: true }), /403/, rol);
  }
  w.OCAuth.rolActual = () => 'admin';
  await w.request(`/api/promotoras/${beto.id}/acceso`, 'PUT', { pin: '617', activo: true });
  assert.equal((await w.request('/api/artistas/verificar', 'POST', { pin: '617' })).id, beto.id);
  await w.request(`/api/promotoras/${beto.id}/acceso`, 'PUT', { activo: false });
  await assert.rejects(() => w.request('/api/artistas/verificar', 'POST', { pin: '617' }), /401/);
});

test('8. artist and team PINs never collide, in both directions', async () => {
  const { w, beto } = await tienda();
  const staff = await w.request('/api/usuarios', 'POST', { nombre: 'Staff', pin: '620' });
  // Artist PIN vs team, other artist, reserved app PINs.
  for (const pin of ['620', '614', '456', '789', '260', '357', '12', 'abc']) {
    await assert.rejects(() => w.request(`/api/promotoras/${beto.id}/acceso`, 'PUT', { pin, activo: true }), /40[09]/, pin);
  }
  // Team vs artist: new member and edited PIN.
  await assert.rejects(() => w.request('/api/usuarios', 'POST', { nombre: 'Clash', pin: '614' }), /40[09]/);
  await assert.rejects(() => w.request(`/api/usuarios/${staff.id}`, 'PATCH', { pin: '614' }), /40[09]/);
});

test('8b. an artist PIN that clashes with a built-in PIN does not open (fails closed)', async () => {
  const { w } = await tienda();
  w.OCSecure.coincidePin = async (pin) => pin === '614';
  await assert.rejects(() => w.request('/api/artistas/verificar', 'POST', { pin: '614' }), /ARTISTA_PIN_CONFLICTO/);
});

test('9. two devices: access set on A opens on B; removed on A closes on B; an old catalog keeps it', async () => {
  const { w: a, ana } = await tienda();
  const b = browser();
  b.OCAuth = { rolActual: () => '' };
  b.receive(a);
  assert.equal((await b.request('/api/artistas/verificar', 'POST', { pin: '614' })).id, ana.id);
  // A catalog from a device that does not know artists: no accesoArtista field, newer rev.
  const viejo = a.catalog();
  viejo.promotoras.forEach((p) => { delete p.accesoArtista; });
  a.OCAuth.rolActual = () => 'dueno';
  await a.request(`/api/promotoras/${ana.id}`, 'PUT', { notas: 'edited on an old phone' });
  const viejoNuevo = a.catalog();
  viejoNuevo.promotoras.forEach((p) => { delete p.accesoArtista; });
  b.OCSync.aplicarCatalogo(viejoNuevo, null);
  assert.equal((await b.request('/api/artistas/verificar', 'POST', { pin: '614' })).id, ana.id);
  await a.request(`/api/promotoras/${ana.id}/acceso`, 'PUT', { activo: false });
  b.receive(a);
  await assert.rejects(() => b.request('/api/artistas/verificar', 'POST', { pin: '614' }), /401/);
});

test('10. PINNING (not a fix): owner, admin and staff keep today\'s access', async () => {
  const { w, pAna, pBeto } = await tienda({ acceso: false });
  for (const rol of ['dueno', 'admin', 'empleado']) {
    w.OCAuth.rolActual = () => rol;
    const ids = (await w.request('/api/productos')).map((p) => p.id);
    assert.ok(ids.includes(pAna.id) && ids.includes(pBeto.id), rol);
    assert.ok(await w.request('/api/ventas/hoy'), rol);
    assert.ok(await w.request(`/api/productos/${pBeto.id}/etiqueta`), rol);
  }
});
