// COMISION POR PERSONA (auditoria JFC 2026-09-26: "que en Commissions todo cuadre y salga
// as promised"). Promesa: en cada venta se elige a la persona, y cobra ELLA, no la persona
// fija de la percha. Hallazgo: la venta si guardaba a la persona (asociadoNombre, ranking),
// pero la LIQUIDACION de la percha no repartia por persona (repartoPersonas vacio) y el
// ESTADO DE CUENTA sumaba todas las ventas de la percha a nombre de la persona fija.
// Ejemplo real: percha de Ana (40 %); una venta de Ana (40) y una con Beto elegido (20).
// Commissions decia "Ana: 60" y el estado de cuenta de Ana cobraba los 20 de Beto.
// Pruebas escritas antes del arreglo: rojas en v414.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { browser } = require('./helpers/browser.cjs');
const { chromium } = require('playwright');
const { pathToFileURL } = require('node:url');
const path = require('node:path');

async function escenario(req) {
  const ana = await req('/api/promotoras', 'POST', { nombre: 'Ana Rack', comisionBase: 40 });
  const beto = await req('/api/promotoras', 'POST', { nombre: 'Beto Libre', comisionBase: 20 });
  const rack = await req('/api/ubicaciones', 'POST', { nombre: 'Rack Ana', tipo: 'socio' });
  await req(`/api/ubicaciones/${rack.id}`, 'PUT', { promotoraId: ana.id });
  const p = await req('/api/productos', 'POST', { nombre: 'Jarron', barcode: 'JAR-' + Math.random().toString(36).slice(2, 7), precio: 100, costo: 30, stockInicial: 10, ubicacionId: rack.id });
  await req(`/api/productos/${p.id}/venta`, 'POST', { cantidad: 1 });
  const vb = await req(`/api/productos/${p.id}/venta`, 'POST', { cantidad: 1, modoComision: 'associate', promotoraId: beto.id });
  return { ana, beto, rack, p, ventaBeto: vb.ventaId };
}
const reparto = (l) => Object.fromEntries((l.repartoPersonas || []).map((r) => [r.nombre, r.monto]));

test('1. Commissions splits the rack by the person chosen on each sale', async () => {
  const w = browser(); w.OCAuth = { rolActual: () => 'dueno' };
  const t = await escenario((u, m, b) => w.request(u, m, b));
  const l = (await w.request('/api/liquidaciones')).find((x) => x.ubicacionId === t.rack.id);
  assert.equal(l.comisionSocio, 60, 'rack total unchanged');
  assert.deepEqual(reparto(l), { 'Ana Rack': 40, 'Beto Libre': 20 });
});

test('2. a return of Beto\'s paid sale comes off Beto, not Ana', async () => {
  const w = browser(); w.OCAuth = { rolActual: () => 'dueno' };
  const t = await escenario((u, m, b) => w.request(u, m, b));
  await w.request(`/api/liquidaciones/${t.rack.id}/marcar-pagado`, 'POST', {});
  await w.request(`/api/ventas/${t.ventaBeto}/devolucion`, 'POST', { motivo: 'danado', quien: 'Hugo' });
  const l = (await w.request('/api/liquidaciones')).find((x) => x.ubicacionId === t.rack.id);
  assert.deepEqual(reparto(l), { 'Ana Rack': 40, 'Beto Libre': 0 });
});

test('3. each person\'s statement carries only their own sales', async () => {
  const web = await chromium.launch({ headless: true });
  try {
    const page = await web.newPage();
    await page.goto(pathToFileURL(path.resolve(__dirname, '../docs/index.html')).href, { waitUntil: 'networkidle' });
    const r = await page.evaluate(async (escSrc) => {
      window.OCAuth.rolActual = () => 'dueno';
      const req = async (u, m = 'GET', b) => (await fetch(u, { method: m, headers: b ? { 'Content-Type': 'application/json' } : undefined, body: b ? JSON.stringify(b) : undefined })).json();
      const t = await (new Function('return ' + escSrc))()(req);
      const capturas = [];
      window.OCEstado.cifrar = async (datos) => { capturas.push(datos); return 'x'; };
      window._ocModalMostrar = async () => 7;
      window.open = () => ({});
      await enviarEstadoComisionista(t.rack.id);
      await enviarEstadoComisionista(t.rack.id, t.beto.id);
      return capturas.map((c) => ({ nombre: c.nombre, total: c.totalComision, lineas: c.lineas.length }));
    }, escenario.toString());
    assert.deepEqual(r[0], { nombre: 'Ana', total: 40, lineas: 1 }, 'Ana: only her sale');
    assert.deepEqual(r[1], { nombre: 'Beto', total: 20, lineas: 1 }, 'Beto gets his own statement');
  } finally { await web.close(); }
});

test('4. UI: Beto chosen on the OWN counter gets a Send statement button', async () => {
  const web = await chromium.launch({ headless: true });
  try {
    const page = await web.newPage({ viewport: { width: 390, height: 844 } });
    await page.goto(pathToFileURL(path.resolve(__dirname, '../docs/index.html')).href, { waitUntil: 'networkidle' });
    const r = await page.evaluate(async () => {
      window.OCAuth.rolActual = () => 'dueno';
      const req = async (u, m = 'GET', b) => (await fetch(u, { method: m, headers: b ? { 'Content-Type': 'application/json' } : undefined, body: b ? JSON.stringify(b) : undefined })).json();
      const beto = await req('/api/promotoras', 'POST', { nombre: 'Beto Mostrador', comisionBase: 20 });
      const own = await req('/api/ubicaciones', 'POST', { nombre: 'Mostrador propio', tipo: 'propio' });
      const p = await req('/api/productos', 'POST', { nombre: 'Vela', barcode: 'VELA-1', precio: 50, stockInicial: 5, ubicacionId: own.id });
      await req(`/api/productos/${p.id}/venta`, 'POST', { cantidad: 1, modoComision: 'associate', promotoraId: beto.id });
      await cargarComisiones();
      return !!document.querySelector(`[data-est-p="${beto.id}"]`);
    });
    assert.ok(r, 'a person chosen on an own counter can be sent a statement');
  } finally { await web.close(); }
});
