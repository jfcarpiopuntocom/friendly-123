/* Prueba de 30 días de friendly (decisión JFC 2026-09-22): uso completo al
   activar con 789; al vencer sin licencia pagada, SOLO LECTURA.

   Las cuatro primeras pruebas son las que protegen a clientes reales y NO
   pueden fallar nunca: un cliente que pagó, el demo, un aparato sin activar y
   un módulo que no cargó jamás quedan en solo lectura. Las demás prueban que
   la prueba vencida bloquea solo lo que escribe negocio, y deja ver, exportar
   y escanear. Fixtures sintéticos: sin red y sin datos de clientes. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { browser } = require('./helpers/browser.cjs');

const DIA = 24 * 60 * 60 * 1000;
const moduloPrueba = fs.readFileSync(path.join(__dirname, '..', 'docs', 'licencia-prueba.js'), 'utf8');

function aparato({ activado = true, estado = 'minima', diasDesdeInicio = 0, demo = false, conModulo = true } = {}) {
  const w = browser();
  if (activado) {
    w.localStorage.setItem('f123_owned', JSON.stringify({
      instanceId: 'fixture-inst', licenseCode: 'F123-FIXTURE-PRUEBA', licenseEstado: estado,
    }));
    if (diasDesdeInicio) w.localStorage.setItem('f123_prueba_inicio', String(Date.now() - diasDesdeInicio * DIA));
  }
  w.OCAuth = { esDemo: () => demo };
  if (conModulo) vm.runInContext(moduloPrueba, w);
  return w;
}

async function productoConStock(w) {
  const u = await w.request('/api/ubicaciones', 'POST', { nombre: 'Percha fixture prueba' });
  const p = await w.request('/api/productos', 'POST', {
    nombre: 'Producto fixture prueba', barcode: 'FIX-PRUEBA-' + Math.random().toString(36).slice(2, 8),
    precio: 10, costo: 4, ubicacionId: u.id,
  });
  await w.request(`/api/productos/${p.id}/ajustar`, 'POST', { delta: 5, motivo: 'Carga fixture' });
  return p;
}

// Registrar el stock ANTES de vencer la prueba (con la prueba vencida no se
// podría ni cargar el producto: eso es justamente lo que se prueba).
async function vencer(w) { w.localStorage.setItem('f123_prueba_inicio', String(Date.now() - 31 * DIA)); }

test('a PAID license is never blocked, even long after the trial clock ran out', async () => {
  const w = aparato({ estado: 'full' });
  const p = await productoConStock(w);
  await vencer(w);
  const r = await w.request(`/api/productos/${p.id}/venta`, 'POST', { cantidad: 1 });
  assert.ok(r.ventaId, 'un cliente que pagó sigue vendiendo aunque el reloj diga vencido');
});

test('the demo is never blocked', async () => {
  const w = aparato({ demo: true });
  const p = await productoConStock(w);
  await vencer(w);
  const r = await w.request(`/api/productos/${p.id}/venta`, 'POST', { cantidad: 1 });
  assert.ok(r.ventaId, 'el demo (PIN 456) nunca vence');
});

test('an unactivated device is never touched by the trial clock', async () => {
  const w = aparato({ activado: false });
  assert.equal(w.OCPrueba.estado().aplica, false);
  assert.equal(w.OCPrueba.bloquea('/api/ventas/x'), false);
});

test('if the trial module fails to load, nothing is ever blocked (fail-open)', async () => {
  const w = aparato({ conModulo: false });
  const p = await productoConStock(w);
  await vencer(w);
  const r = await w.request(`/api/productos/${p.id}/venta`, 'POST', { cantidad: 1 });
  assert.ok(r.ventaId, 'sin el módulo la app funciona igual que antes: jamás bloquea por error');
});

test('within the trial an unpaid activated device has full use', async () => {
  const w = aparato({ diasDesdeInicio: 10 });
  const p = await productoConStock(w);
  const r = await w.request(`/api/productos/${p.id}/venta`, 'POST', { cantidad: 1 });
  assert.ok(r.ventaId);
  const e = w.OCPrueba.estado();
  assert.equal(e.vencida, false);
  assert.equal(e.diasRestantes, w.OCPrueba.PRUEBA_DIAS - 10);
});

test('an expired unpaid trial blocks new sales and leaves stock untouched', async () => {
  const w = aparato();
  const p = await productoConStock(w);
  await vencer(w);
  let avisos = 0;
  w.addEventListener('oc-prueba-vencida', () => { avisos++; });
  await assert.rejects(() => w.request(`/api/productos/${p.id}/venta`, 'POST', { cantidad: 1 }), /402.*PRUEBA_VENCIDA/);
  const estado = await w.request('/api/respaldo/exportar');
  assert.equal(estado.productos.find(x => x.id === p.id).stockActual, 5, 'el stock no se tocó');
  assert.ok(avisos >= 1, 'el rechazo dispara el aviso que abre el modal de compra');
});

test('an expired trial still lets the owner view, export and scan', async () => {
  const w = aparato();
  const p = await productoConStock(w);
  await vencer(w);
  // Ver y exportar: su información siempre es suya.
  const exp = await w.request('/api/respaldo/exportar');
  assert.ok(exp.productos.find(x => x.id === p.id), 'exportar sigue funcionando');
  // Escanear es POST pero solo BUSCA: consultar un producto tiene que seguir andando.
  const ficha = await w.request('/api/escanear', 'POST', { codigo: exp.productos.find(x => x.id === p.id).barcode });
  assert.equal(ficha.id, p.id, 'el escáner encuentra el producto con la prueba vencida');
});

test('devices activated before this change start their clock today, not at their old activation', async () => {
  const w = aparato();
  // Aparato activado hace 2 meses, sin clave de reloj: la decisión de JFC es
  // contar desde HOY para los que ya estaban activados.
  const o = JSON.parse(w.localStorage.getItem('f123_owned'));
  o.activatedAt = Date.now() - 60 * DIA;
  w.localStorage.setItem('f123_owned', JSON.stringify(o));
  const e = w.OCPrueba.estado();
  assert.equal(e.vencida, false, 'no nace vencido por una activación vieja');
  assert.equal(e.diasRestantes, w.OCPrueba.PRUEBA_DIAS);
});

test('#5 a license paid while the app is open unlocks writes without a new login', async () => {
  /* v347, auditoría Codex #5. El Worker se simula: revalidarLicencia hace lo
     mismo que el heartbeat real (escribe licenseEstado en f123_owned). La
     primera escritura con la prueba vencida se rechaza y dispara la
     revalidación; la siguiente pasa sin volver a entrar. */
  const w = aparato();
  const p = await productoConStock(w);
  await vencer(w);
  let llamadas = 0;
  w.OCAuth.revalidarLicencia = async () => {
    llamadas++;
    const o = JSON.parse(w.localStorage.getItem('f123_owned'));
    o.licenseEstado = 'full';
    w.localStorage.setItem('f123_owned', JSON.stringify(o));
  };
  const antes = await w.fetch(`/api/productos/${p.id}/venta`, { method: 'POST', body: JSON.stringify({ cantidad: 1 }) });
  assert.equal(antes.ok, false, 'con la prueba vencida y sin revalidar, se rechaza');
  await new Promise(res => setImmediate(res));
  assert.equal(llamadas, 1, 'el rechazo disparó una revalidación');
  const r = await w.request(`/api/productos/${p.id}/venta`, 'POST', { cantidad: 1 });
  assert.ok(r.ventaId, 'tras el pago, vende sin nuevo login');
});
