const { test } = require('node:test');
const assert = require('node:assert/strict');
const { browser } = require('./helpers/browser.cjs');

// Reproduced in real browsers: the first device to join saw 5/6/7, the next ones 0/0/0 for good, because the old relay
// checkpoint delivered the product at 0 before Yjs and the stockTs tie then kept that 0.
async function montar(extra) {
  const source = browser(), dest = browser();
  const fixture = await source.request('/api/respaldo/exportar');
  const shelf = { ...fixture.ubicaciones[0], id: 'shelf-frio', nombre: 'Shelf' };
  const product = { ...fixture.productos[0], id: 'prod-frio', nombre: 'Frio', sku: 'FRIO', barcode: 'FRIO-1', ubicacionId: shelf.id, stockActual: 5, stockEpochId: 'stock-epoch-frio', stockTs: 0, stockBase: null, stockPN: null, ...extra };
  await dest.request('/api/instancia/activar', 'POST', { instanceId: 'fixture-dest-frio', vaciar: true });
  dest.OCSync.aplicarCheckpoint({ ubicaciones: [{ id: shelf.id, nombre: shelf.nombre, activa: true }], productos: [{ id: product.id, nombre: product.nombre, sku: product.sku, barcode: product.barcode, ubicacionId: shelf.id, stockActual: 0 }], clientes: [] });
  const stock = async () => (await dest.request('/api/respaldo/exportar')).productos.find(p => p.id === product.id);
  assert.equal((await stock()).stockActual, 0, 'precondition: the checkpoint left it at 0');
  return { dest, stock, shelf, product };
}
const llega = (dest, shelf, product, cambios) => dest.OCSync.aplicarCatalogo({ ubicaciones: [shelf], productos: [{ ...product, ...cambios }], actividad: [] }, null);

test('a product that came at 0 from the checkpoint takes the shared stock on a stamp tie', async () => {
  const { dest, stock, shelf, product } = await montar();
  llega(dest, shelf, product);
  assert.equal((await stock()).stockActual, 5);
});

test('the old checkpoint waits while Yjs recovers, and then adds nothing at 0 over what Yjs brought', async () => {
  const { dest, stock, shelf, product } = await montar();
  llega(dest, shelf, product);
  const nuevo = { id: 'prod-espera', nombre: 'Espera', sku: 'ESP', barcode: 'ESP-1', ubicacionId: shelf.id, stockActual: 3 };
  dest.OCYjs = { canal: { recuperando: true } };
  const r = dest.OCSync.aplicarCheckpoint({ ubicaciones: [], productos: [nuevo], clientes: [] });
  assert.deepEqual([r.ok, r.motivo], [false, 'esperando-recuperacion']);
  assert.equal((await dest.request('/api/respaldo/exportar')).productos.some(p => p.id === nuevo.id), false, 'nothing enters while waiting');
  dest.OCYjs.canal.recuperando = false;
  assert.equal(dest.OCSync.aplicarCheckpoint({ ubicaciones: [], productos: [nuevo], clientes: [] }, 1).ok, true, 'recovered: it applies');
  assert.equal((await dest.request('/api/respaldo/exportar')).productos.some(p => p.id === nuevo.id), true);
  assert.equal((await stock()).stockActual, 5);
});

test('fallback: with Yjs stuck, the checkpoint still applies after its last wait', async () => {
  const { dest, shelf } = await montar();
  dest.OCYjs = { canal: { recuperando: true } };
  const nuevo = { id: 'prod-tope', nombre: 'Tope', sku: 'TOPE', barcode: 'TOPE-1', ubicacionId: shelf.id, stockActual: 3 };
  assert.equal(dest.OCSync.aplicarCheckpoint({ ubicaciones: [], productos: [nuevo], clientes: [] }, 30).ok, true);
  assert.equal((await dest.request('/api/respaldo/exportar')).productos.some(p => p.id === nuevo.id), true);
});

test('v646: demo-seed sales do not make a joining device take the compact photo at stock 0', async () => {
  const dest = browser();
  const snap = { ubicaciones: [{ id: 'real-shelf', nombre: 'Real shelf', activa: true }], productos: [{ id: 'foto-1', nombre: 'Spray', sku: 'S', barcode: 'S-1', ubicacionId: 'real-shelf', stockActual: 5 }], clientes: [] };
  const ventasAntes = (await dest.request('/api/respaldo/exportar')).ventas.length;
  assert.ok(ventasAntes > 0, 'precondition: the fresh visit holds the demo seed sales');
  assert.equal(dest.OCSync.aplicarCheckpoint(snap).ok, true);
  assert.equal((await dest.request('/api/respaldo/exportar')).productos.find(p => p.id === 'foto-1').stockActual, 5);
});

async function conVentaReal() {
  const dest = browser();
  const real = await dest.request('/api/respaldo/exportar');
  real.ventas = [{ ...real.ventas[0], id: 'venta-real', total: Number(real.ventas[0].total) + 1 }];
  await dest.request('/api/respaldo/importar', 'POST', real);
  const shelf = real.ubicaciones[0].id, base = { nombre: 'Otro', sku: 'O', barcode: 'O-1', ubicacionId: shelf };
  const leer = async id => (await dest.request('/api/respaldo/exportar')).productos.find(p => p.id === id);
  return { dest, base, leer, foto: (...productos) => dest.OCSync.aplicarCheckpoint({ ubicaciones: [], productos, clientes: [] }) };
}

test('v649: a strict save waits for this device\'s own save in flight instead of a false NOT saved', async () => {
  const dest = browser();
  await dest.request('/api/instancia/activar', 'POST', { instanceId: 'fixture-espera-idb', vaciar: true });
  let rev = 0, escrituras = 0;
  dest.OCEstadoIDB = { soportado: true,
    guardar: async c => { await new Promise(r => setTimeout(r, 40)); rev = Number(c._rev) || rev; escrituras++; return true; },
    guardarConRevision: async (c, esperada) => { if (esperada !== rev) return false; rev = Number(c._rev) || rev; escrituras++; return true; },
    cargar: async () => null, leer: async () => null };
  const c1 = dest.request('/api/clientes', 'POST', { nombre: 'En segundo plano', telefono: '1' });
  const c2 = dest.request('/api/clientes', 'POST', { nombre: 'Enseguida', telefono: '2' });
  const r = await Promise.allSettled([c1, c2]);
  assert.deepEqual(r.map(x => x.status), ['fulfilled', 'fulfilled'], JSON.stringify(r.filter(x => x.status !== 'fulfilled').map(x => String(x.reason))));
});

test('v649: by design, a photo with a newer rev updates the product as Yjs would; an older one changes nothing', async () => {
  const { base, leer, foto, dest } = await conVentaReal();
  dest.OCSync.aplicarCatalogo({ ubicaciones: [], productos: [{ ...base, id: 'foto-11', nombre: 'Medio', precio: 10, stockActual: 3, rev: { c: 5, d: 'm' } }] }, null);
  foto({ ...base, id: 'foto-11', nombre: 'Viejo', precio: 1, stockActual: 3, rev: { c: 2, d: 'a' } });
  assert.equal((await leer('foto-11')).nombre, 'Medio');
  foto({ ...base, id: 'foto-11', nombre: 'Nuevo', precio: 20, stockActual: 3, rev: { c: 9, d: 'a' } });
  assert.equal((await leer('foto-11')).nombre, 'Nuevo');
});

test('Codex: a device adopts a photo with an epoch, a later sale of that epoch lands, and it survives a reload', async () => {
  const dest = browser();
  dest.localStorage.setItem('f123_owned', JSON.stringify({ instanceId: 'fixture-recarga-foto', licenseCode: 'F123-REAL-FIXTURE' }));
  await dest.request('/api/instancia/activar', 'POST', { instanceId: 'fixture-recarga-foto', vaciar: true });
  const u = await dest.request('/api/ubicaciones', 'POST', { nombre: 'Shelf', tipo: 'propio' });
  const base = { nombre: 'Otro', sku: 'O', barcode: 'O-1', ubicacionId: u.id, precio: 10, costo: 5 };
  const leer = async id => (await dest.request('/api/respaldo/exportar')).productos.find(p => p.id === id);
  const foto = (...productos) => dest.OCSync.aplicarCheckpoint({ ubicaciones: [], productos, clientes: [] });
  foto({ ...base, id: 'foto-12', stockActual: 0 });
  const ep = { stockBase: 7, stockPN: {}, stockTs: 5000, stockEpochId: 'ep-foto' };
  foto({ ...base, id: 'foto-12', stockActual: 7, ...ep });
  let p = await leer('foto-12');
  assert.deepEqual([p.stockActual, p.stockEpochId, p.stockBase], [7, 'ep-foto', 7], 'adopts stock with its epoch and base together');
  dest.OCSync.aplicarCatalogo({ ubicaciones: [], productos: [{ ...base, id: 'foto-12', stockActual: 6, stockBase: 7, stockPN: { otro: { add: 0, sub: 1 } }, stockTs: 6000, stockEpochId: 'ep-foto' }] }, null);
  assert.equal((await leer('foto-12')).stockActual, 6, 'the sale of that epoch lands');
  const ajuste = await dest.request('/api/productos/foto-12/ajustar', 'POST', { delta: -1, motivo: 'fuerza guardado estricto' });
  assert.ok(ajuste, 'the strict save answered');
  const tras = browser(dest.localStorage);
  await new Promise(r => setTimeout(r, 50));
  const r = (await tras.request('/api/respaldo/exportar')).productos.find(x => x.id === 'foto-12');
  assert.ok(r, 'the product must exist after reload');
  assert.deepEqual([r.stockActual, r.stockBase, r.stockEpochId], [5, 7, 'ep-foto'], 'stock, base and epoch persist');
});

test('Codex: a strict save behind a slow own save persists both, in order, and the last state is on disk', async () => {
  const dest = browser();
  dest.setTimeout = setTimeout; dest.clearTimeout = clearTimeout;
  await dest.request('/api/instancia/activar', 'POST', { instanceId: 'fixture-tardio', vaciar: true });
  let rev = 0, disco = null, soltar;
  const lento = new Promise(r => { soltar = r; });
  dest.OCEstadoIDB = { soportado: true,
    guardar: async c => { await lento; rev = Number(c._rev) || rev; disco = JSON.parse(JSON.stringify(c)); return true; },
    guardarConRevision: async (c, esperada) => { if (esperada !== rev) return false; rev = Number(c._rev) || rev; disco = JSON.parse(JSON.stringify(c)); return true; },
    cargar: async () => null, leer: async () => null };
  const f = await dest.request('/api/respaldo/exportar'), uid = f.ubicaciones[0] ? f.ubicaciones[0].id : 'u1';
  dest.OCSync.aplicarCatalogo({ ubicaciones: f.ubicaciones[0] ? [] : [{ id: 'u1', nombre: 'U', activa: true }], productos: [{ id: 'tard-1', nombre: 'Tardio', sku: 'T', barcode: 'T-1', ubicacionId: uid, stockActual: 5, precio: 1 }] }, null);
  await dest.request('/api/clientes', 'POST', { nombre: 'Fondo', telefono: '1' });
  const ajuste = dest.request('/api/productos/tard-1/ajustar', 'POST', { delta: 1, motivo: 'prueba' }).then(() => 'ok', e => String(e.message || e));
  await new Promise(r => setTimeout(r, 200));
  soltar();
  const r = await ajuste;
  await new Promise(r2 => setTimeout(r2, 50));
  assert.equal(r, 'ok', 'a slow own save that finishes must not cost a false NOT saved: ' + r);
  assert.equal(disco.productos.find(x => x.id === 'tard-1').stockActual, 6, 'the confirmed adjustment is what is on disk');
});

test('Codex: two strict saves against hung storage both answer, and none confirms what was not persisted', async () => {
  const dest = browser();
  dest.setTimeout = setTimeout; dest.clearTimeout = clearTimeout; // the helper mutes timers; the 4 s fallback needs a real one
  await dest.request('/api/instancia/activar', 'POST', { instanceId: 'fixture-dos-estrictos', vaciar: true });
  let rev = 0, persistidas = 0;
  dest.OCEstadoIDB = { soportado: true, guardar: () => new Promise(() => {}),
    guardarConRevision: async (c, esperada) => { if (esperada !== rev) return false; rev = Number(c._rev) || rev; persistidas++; return true; },
    cargar: async () => null, leer: async () => null };
  const fixture = await dest.request('/api/respaldo/exportar');
  const uid = fixture.ubicaciones[0] && fixture.ubicaciones[0].id;
  dest.OCSync.aplicarCatalogo({ ubicaciones: uid ? [] : [{ id: 'u1', nombre: 'U', activa: true }], productos: [{ id: 'dos-1', nombre: 'Dos', sku: 'D', barcode: 'D-1', ubicacionId: uid || 'u1', stockActual: 5, precio: 1 }] }, null);
  const ajuste = () => dest.request('/api/productos/dos-1/ajustar', 'POST', { delta: 1, motivo: 'prueba' }).then(() => 'ok', e => String(e.message || e));
  const r = await Promise.race([Promise.all([ajuste(), ajuste()]), new Promise(s => setTimeout(() => s('colgado'), 11000))]);
  assert.notEqual(r, 'colgado', 'both must answer');
  const confirmadas = r.filter(x => x === 'ok').length;
  assert.ok(confirmadas <= persistidas, `confirmed ${confirmadas}, persisted ${persistidas}: ${JSON.stringify(r)}`);
});

test('v651: a product new to this device keeps an epoch only together with its base', async () => {
  const { base, leer, foto } = await conVentaReal();
  foto({ ...base, id: 'foto-13', stockActual: 5, stockEpochId: 'sin-base' });
  assert.ok(!(await leer('foto-13')).stockEpochId);
  foto({ ...base, id: 'foto-14', stockActual: 5, stockBase: 5, stockPN: {}, stockTs: 10, stockEpochId: 'con-base' });
  assert.equal((await leer('foto-14')).stockEpochId, 'con-base');
});

test('v649: a 0 with its own stamp is a fact: an old photo cannot bring it back', async () => {
  const { base, leer, foto, dest } = await conVentaReal();
  dest.OCSync.aplicarCatalogo({ ubicaciones: [], productos: [{ ...base, id: 'foto-10', stockActual: 0, stockTs: 5000 }] }, null);
  foto({ ...base, id: 'foto-10', stockActual: 7 });
  assert.equal((await leer('foto-10')).stockActual, 0);
});

test('v649: with storage hung, a strict save still answers within 5 s instead of freezing the sale', async () => {
  const dest = browser();
  await dest.request('/api/instancia/activar', 'POST', { instanceId: 'fixture-idb-colgado', vaciar: true });
  dest.OCEstadoIDB = { soportado: true, guardar: () => new Promise(() => {}), guardarConRevision: async () => true, cargar: async () => null, leer: async () => null };
  dest.request('/api/clientes', 'POST', { nombre: 'En vuelo', telefono: '1' }).catch(() => {});
  await new Promise(r => setTimeout(r, 20));
  const t0 = Date.now();
  const fin = await Promise.race([dest.request('/api/clientes', 'POST', { nombre: 'Siguiente', telefono: '2' }).then(() => 'respondio', () => 'respondio'), new Promise(r => setTimeout(() => r('colgado'), 5000))]);
  assert.equal(fin, 'respondio', 'deadlock: no answer in 5 s');
  assert.ok(Date.now() - t0 < 5000);
});

test('v649: an old photo with borrado cannot delete a live product, and an archived one stays archived', async () => {
  const { base, leer, foto, dest } = await conVentaReal();
  dest.OCSync.aplicarCatalogo({ ubicaciones: [], productos: [{ ...base, id: 'foto-7', stockActual: 3, rev: { c: 50, d: 'z' } }] }, null);
  foto({ ...base, id: 'foto-7', stockActual: 3, borrado: true, rev: { c: 2, d: 'a' } });
  assert.notEqual((await leer('foto-7')).borrado, true);
  foto({ ...base, id: 'foto-8', stockActual: 49, archivado: true, rev: { c: 3, d: 'a' } });
  assert.equal((await leer('foto-8')).archivado, true);
  const lista = await dest.request('/api/productos');
  assert.equal((Array.isArray(lista) ? lista : lista.productos).some(p => p.id === 'foto-8'), false, 'it does not show in the grid');
});

test('v649: rereading an old photo does not revert a newer physical count', async () => {
  const { base, leer, foto, dest } = await conVentaReal();
  const vieja = { ...base, id: 'foto-9', stockActual: 18, stockBase: 18, stockPN: {}, stockTs: 1000, stockEpochId: 'ep-vieja' };
  foto(vieja);
  dest.OCSync.aplicarCatalogo({ ubicaciones: [], productos: [{ ...base, id: 'foto-9', stockActual: 7, stockBase: 7, stockPN: {}, stockTs: 5000, stockEpochId: 'ep-nueva' }] }, null);
  assert.equal((await leer('foto-9')).stockActual, 7);
  foto(vieja);
  assert.equal((await leer('foto-9')).stockActual, 7);
});

test('v649: the photo carries deletions and rev decides', async () => {
  const { base, leer, foto, dest } = await conVentaReal();
  dest.OCSync.aplicarCatalogo({ ubicaciones: [], productos: [{ ...base, id: 'foto-6', stockActual: 3, rev: { c: 1, d: 'a' } }] }, null);
  foto({ ...base, id: 'foto-6', stockActual: 3, borrado: true, rev: { c: 9, d: 'b' } });
  assert.equal((await leer('foto-6')).borrado, true);
  foto({ ...base, id: 'foto-6', stockActual: 3, borrado: false, rev: { c: 2, d: 'b' } });
  assert.equal((await leer('foto-6')).borrado, true, 'an older photo cannot resurrect it');
});

test('v648: a device with real sales takes the photo stock for a product it did not know', async () => {
  const { base, leer, foto } = await conVentaReal();
  foto({ ...base, id: 'foto-2', stockActual: 5 });
  assert.equal((await leer('foto-2')).stockActual, 5);
});

test('v648: a 0 with no base here takes the photo; a real count of 0 with a base is kept', async () => {
  const { base, leer, foto, dest } = await conVentaReal();
  foto({ ...base, id: 'foto-3', stockActual: 0 });
  foto({ ...base, id: 'foto-3', stockActual: 7 });
  assert.equal((await leer('foto-3')).stockActual, 7);
  dest.OCSync.aplicarCatalogo({ ubicaciones: [], productos: [{ ...base, id: 'foto-4', stockActual: 0, stockBase: 0, stockPN: {}, stockTs: 3000 }] }, null);
  foto({ ...base, id: 'foto-4', stockActual: 7 });
  assert.equal((await leer('foto-4')).stockActual, 0);
});

test('v648: a photo with a newer physical base wins over this device, an older one does not', async () => {
  const { base, leer, foto, dest } = await conVentaReal();
  dest.OCSync.aplicarCatalogo({ ubicaciones: [], productos: [{ ...base, id: 'foto-5', stockActual: 11, stockBase: 6, stockPN: { a: { add: 5, sub: 0 } }, stockTs: 2000 }] }, null);
  foto({ ...base, id: 'foto-5', stockActual: 7, stockBase: 7, stockPN: {}, stockTs: 3000 });
  assert.equal((await leer('foto-5')).stockActual, 7);
  foto({ ...base, id: 'foto-5', stockActual: 2, stockBase: 2, stockPN: {}, stockTs: 1000 });
  assert.equal((await leer('foto-5')).stockActual, 7);
});

test('a real count of 0 here is kept: it created a base, so it is a fact', async () => {
  const { dest, stock, shelf, product } = await montar();
  const p = await stock();
  await dest.request(`/api/productos/${p.id}/stock`, 'PATCH', { stockActual: 0 }).catch(() => {});
  dest.OCSync.aplicarCatalogo({ ubicaciones: [shelf], productos: [{ ...product, stockBase: 5, stockPN: { other: { add: 0, sub: 5 } }, stockActual: 0, stockTs: 1 }], actividad: [] }, null);
  assert.equal((await stock()).stockActual, 0);
});

test('a remote stamp older than the local one does not win', async () => {
  const { dest, stock, shelf, product } = await montar();
  llega(dest, shelf, product, { stockEpochId: '', stockActual: 0, stockTs: 2000 });
  assert.equal(Number((await stock()).stockTs), 2000, 'precondition: the local stamp is now 2000');
  llega(dest, shelf, product, { stockEpochId: '', stockActual: 5, stockTs: 1000 });
  assert.equal((await stock()).stockActual, 0);
});

test('a positive local stock is not touched by this path', async () => {
  const { dest, stock, shelf, product } = await montar();
  llega(dest, shelf, product);
  llega(dest, shelf, product, { stockActual: 9 });
  assert.equal((await stock()).stockActual, 5);
});

test('v651: a device with its own epoch adopts a newer count that has none, and keeps its number against an older one', async () => {
  const { dest, stock, shelf, product } = await montar();
  llega(dest, shelf, product, { stockActual: 7, stockBase: 7, stockPN: {}, stockTs: 5000, stockEpochId: 'ep-local' });
  assert.equal((await stock()).stockActual, 7);
  llega(dest, shelf, product, { stockActual: 3, stockBase: 3, stockPN: {}, stockTs: 4000, stockEpochId: '' });
  assert.equal((await stock()).stockActual, 7, 'an older count changes nothing');
  llega(dest, shelf, product, { stockActual: 33, stockBase: 33, stockPN: {}, stockTs: 6000, stockEpochId: '' });
  assert.equal((await stock()).stockActual, 33, 'the latest count wins');
});

test('v651: fichas merge with the catalog rule and create what this device lacks; the photo carries the product image', async () => {
  const { dest, stock, shelf, product } = await montar();
  dest.OCSync.aplicarFichas({ productos: [{ ...product, stockActual: 33, stockBase: 33, stockPN: {}, stockTs: 7000, stockEpochId: 'ep-x', fotoHash: 'a'.repeat(64) }] });
  assert.equal((await stock()).stockActual, 33);
  dest.OCSync.aplicarFichas({ productos: [{ ...product, id: 'prod-nuevo-ficha', barcode: 'N-1', sku: 'N', stockActual: 4, stockBase: 4, stockPN: {}, stockTs: 7000 }] });
  const todos = (await dest.request('/api/respaldo/exportar')).productos;
  assert.equal(todos.find(p => p.id === 'prod-nuevo-ficha').stockActual, 4);
  const foto = dest.OCSync.estadoParaCheckpoint().productos.find(p => p.id === product.id);
  assert.equal(foto.fotoHash, 'a'.repeat(64));
});

test('v651: the latest explicit owner PIN change is adopted from the photo; the factory PIN or an older change never replaces it', async () => {
  const b = browser();
  await b.OCSecure.asegurarSecretoInicial?.();
  if (!b.OCSecure.leerPinsVisibles?.()) await b.OCSecure.fijarOwnerPin?.('789');
  const s = JSON.parse(b.localStorage.getItem('f123_secure') || 'null');
  if (!s) return; // this harness has no credential store
  s.ownerPinTs = 1000; b.localStorage.setItem('f123_secure', JSON.stringify(s));
  const antes = b.OCSecure.leerPinsVisibles().owner;
  assert.equal(await b.OCSecure.adoptarPinOwnerDeFoto('789', 9000), false);
  assert.equal(await b.OCSecure.adoptarPinOwnerDeFoto('641', 500), false);
  assert.equal(b.OCSecure.leerPinsVisibles().owner, antes);
  assert.equal(await b.OCSecure.adoptarPinOwnerDeFoto('641', 9000), true);
  assert.equal(b.OCSecure.leerPinsVisibles().owner, '641');
  assert.equal(b.OCSecure.ownerPinTs(), 9000);
});
