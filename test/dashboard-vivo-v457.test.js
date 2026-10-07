/* v457 (JFC 2026-10-07, aprobado por la duena):
   (1) "el dashboard refleje en mili segundos un cambio retroactivo en comisiones y en general en cualquier cambio":
       el tablero escucha `storage` y el BroadcastChannel de aislamiento.js y repinta con el camino local, sin recargar.
       Tambien lee las MISMAS claves con sufijo de tienda que escribe la app.
   (2) un admin creado con /api/usuarios entra al tablero (su PIN no esta en el secreto cifrado, solo en f123_admins_pins).
       Un PIN equivocado sigue contando para el bloqueo; el PIN correcto de admin no.
   (3) en local la duena ve su dinero real: Commissions muestra los mismos 4 totales que la app, al centavo.
   (5) el demo sobrante nunca se pinta en el tablero de un negocio con licencia, y no se borra nada.
   Todo en Chromium con red cortada: se abortan los pedidos que no sean file:, y WebSocket es un stub. Datos y licencia sinteticos. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { pathToFileURL } = require('node:url');
const path = require('node:path');

const INDEX = pathToFileURL(path.resolve(__dirname, '../docs/index.html')).href;
const DASH = pathToFileURL(path.resolve(__dirname, '../docs/dashboard.html')).href;
const LIC = 'F123-TEST-0000-0000-00000';

async function contexto(web) {
  const ctx = await web.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.route((u) => !/^(file|data|blob|about):/i.test(String(u)), (r) => r.abort());
  await ctx.addInitScript(() => {
    /* WebSocket de mentira: el tablero jamas toca el relay real. */
    window.WebSocket = class { constructor() { this.readyState = 3; } send() {} close() {} addEventListener() {} removeEventListener() {} };
  });
  return ctx;
}
/* App con un negocio sintetico con licencia, dueno 789. sufijo: tienda unida (clave con sufijo). */
async function abrirApp(ctx, { sufijo = '' } = {}) {
  const app = await ctx.newPage();
  /* El sufijo de tienda lo lee la app UNA vez al cargar: se escribe antes de que cargue (clave nativa con el prefijo f123:: de aislamiento.js). */
  if (sufijo) await app.addInitScript((suf) => { try { localStorage.setItem('f123::f123_tienda_activa', suf); localStorage.setItem('f123::f123_notebook_unificado_v2', '1'); } catch (_) {} }, sufijo);
  await app.goto(INDEX, { waitUntil: 'networkidle' });
  await app.evaluate(async ({ lic }) => {
    window.OCAuth = Object.assign({}, window.OCAuth, { rolActual: () => 'dueno' });
    localStorage.setItem('f123_owned', JSON.stringify({ licenseCode: lic, nombreNegocio: 'Negocio Sintetico' }));
    await window.OCSecure.guardarSecreto('789', ['260'], '357', '');
  }, { lic: LIC });
  return app;
}
const api = (page, u, m = 'GET', b) => page.evaluate(async ({ u, m, b }) => {
  const r = await fetch(u, { method: m, headers: b ? { 'Content-Type': 'application/json' } : undefined, body: b ? JSON.stringify(b) : undefined });
  const j = await r.json(); if (r.status >= 400) throw new Error(m + ' ' + u + ' ' + r.status + ' ' + JSON.stringify(j)); return j;
}, { u, m, b });
async function entrar(ctx, pin) {
  const dash = await ctx.newPage();
  await dash.goto(DASH, { waitUntil: 'load' });
  await dash.fill('#pin', pin);
  await dash.click('#entrar');
  return dash;
}
const tablero = (dash) => dash.waitForFunction(() => getComputedStyle(document.getElementById('tablero')).display !== 'none', null, { timeout: 8000 });
const tiles = (dash) => dash.evaluate(() => Object.fromEntries([...document.querySelectorAll('#cm .cm-k')].map((k) => [k.querySelector('.et').textContent.trim(), k.querySelector('.n').textContent.trim()])));
/* Una percha compartida al 40%, un producto, tres ventas del mes. */
async function negocioDeComisiones(app) {
  const ana = await api(app, '/api/promotoras', 'POST', { nombre: 'Ana Tablero', comisionBase: 40 });
  const rack = await api(app, '/api/ubicaciones', 'POST', { nombre: 'Percha Tablero', tipo: 'socio', comisionSocio: 40 });
  await api(app, '/api/ubicaciones/' + rack.id, 'PUT', { promotoraId: ana.id });
  const prod = await api(app, '/api/productos', 'POST', { nombre: 'Taza Tablero', barcode: 'TAB-001', sku: '1010000', precio: 100, costo: 30, stockInicial: 20, ubicacionId: rack.id });
  for (let i = 0; i < 3; i++) await api(app, `/api/productos/${prod.id}/venta`, 'POST', { cantidad: 1 });
  return { ana, rack, prod };
}

test('(1) dashboard repaints within 500 ms when the app changes the PERSON base commission, without reloading', async () => {
  const web = await chromium.launch({ headless: true });
  try {
    const ctx = await contexto(web);
    const app = await abrirApp(ctx);
    const { ana } = await negocioDeComisiones(app);
    const dash = await entrar(ctx, '789');
    await tablero(dash);
    assert.equal((await tiles(dash))['Still to pay'], '$120.00', 'antes: 3 ventas de $100 al 40% = $120 por pagar');
    await dash.evaluate(() => { window.__marcaSinRecarga = 1; });

    /* v458: ESTA es la ruta que usa el editor "Commission — PERSON".
       El test anterior cambiaba una venta individual y dejaba sin probar el bug real. */
    const t0 = await app.evaluate(async (id) => {
      const r = await fetch('/api/promotoras/' + id, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ comisionBase: 50 }) });
      if (r.status >= 400) throw new Error('PUT ' + r.status + ' ' + JSON.stringify(await r.json()));
      return Date.now();
    }, ana.id);
    /* Las tres ventas pendientes deben pasar de 40% a 50%: $150, sin recargar. */
    const t1 = await dash.evaluate(async () => {
      const lee = () => { const k = [...document.querySelectorAll('#cm .cm-k')].find((x) => /Still to pay/.test(x.textContent)); return k ? k.querySelector('.n').textContent.trim() : ''; };
      const ini = Date.now();
      while (Date.now() - ini < 4000) { if (lee() === '$150.00') return Date.now(); await new Promise((r) => setTimeout(r, 5)); }
      return -1;
    });
    assert.ok(t1 > 0, 'el tablero nunca mostro el cambio de la comision base de la persona');
    const ms = t1 - t0;
    console.log('MEDIDO dashboard person-commission refresh ms =', ms);
    assert.ok(ms <= 500, 'el tablero tardo ' + ms + ' ms (limite 500)');
    assert.equal(await dash.evaluate(() => window.__marcaSinRecarga), 1, 'no hubo recarga de pagina');
  } finally { await web.close(); }
});

test('(1b) dashboard reads the SAME suffixed keys the app writes (joined store)', async () => {
  const web = await chromium.launch({ headless: true });
  try {
    const ctx = await contexto(web);
    const app = await abrirApp(ctx, { sufijo: '::' + LIC });
    await negocioDeComisiones(app);
    const claves = await app.evaluate(() => { const o = []; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (/^f123_estado_v4/.test(k)) o.push(k); } return o; });
    assert.ok(claves.some((k) => k.indexOf('::') > 0), 'la app escribe claves con sufijo: ' + claves.join(','));
    const dash = await entrar(ctx, '789');
    await tablero(dash);
    assert.equal((await tiles(dash))['Still to pay'], '$120.00', 'el tablero leyo el cuaderno con sufijo');
  } finally { await web.close(); }
});

test('(2) an admin created via /api/usuarios enters the dashboard; wrong PINs still count, the right one does not', async () => {
  const web = await chromium.launch({ headless: true });
  try {
    const ctx = await contexto(web);
    const app = await abrirApp(ctx);
    await negocioDeComisiones(app);
    await api(app, '/api/usuarios', 'POST', { nombre: 'Admin Sintetico', pin: '555', rol: 'admin' });
    assert.deepEqual(await app.evaluate(() => JSON.parse(localStorage.getItem('f123_admins_pins') || '[]')), ['555'], 'la app publica el PIN del admin');

    const dash = await ctx.newPage();
    await dash.goto(DASH, { waitUntil: 'load' });
    const restantes = () => dash.evaluate(() => window.OCSecure.intentosRestantes('login'));
    const r0 = await restantes();
    await dash.fill('#pin', '999'); await dash.click('#entrar');
    await dash.waitForFunction(() => /no abre el tablero/i.test(document.getElementById('msg').textContent), null, { timeout: 8000 })
      .catch(async (e) => { throw new Error('msg=' + await dash.evaluate(() => document.getElementById('msg').textContent) + ' / ' + e.message); });
    const r1 = await restantes();
    assert.equal(r1, r0 - 1, 'un PIN equivocado cuenta para el bloqueo');
    await dash.fill('#pin', '555'); await dash.click('#entrar');
    await tablero(dash);
    assert.ok(await restantes() >= r1, 'el PIN correcto de admin no suma fallos');
    assert.match(await dash.evaluate(() => document.getElementById('kpis').textContent), /productos/, 'el admin ve datos');
    assert.equal((await tiles(dash))['Still to pay'], '$120.00', 'y ve lo mismo que el dueno');
  } finally { await web.close(); }
});

test('(3) owner sees real money in local mode: same four totals as the app, to the cent', async () => {
  const web = await chromium.launch({ headless: true });
  try {
    const ctx = await contexto(web);
    const app = await abrirApp(ctx);
    const { rack } = await negocioDeComisiones(app);
    /* una segunda linea con % propio del producto (v457) y una venta con cliente, para que los numeros no sean redondos */
    const p2 = await api(app, '/api/productos', 'POST', { nombre: 'Vaso Tablero', barcode: 'TAB-002', sku: '2010003', precio: 33.33, costo: 10, stockInicial: 9, ubicacionId: rack.id, pctAsociado: 27.5 });
    const cli = await api(app, '/api/clientes', 'POST', { nombre: 'Clienta Tablero' });
    await api(app, `/api/productos/${p2.id}/venta`, 'POST', { cantidad: 2 });
    await api(app, `/api/productos/${p2.id}/venta`, 'POST', { cantidad: 1, clienteId: cli.id });
    const deLaApp = await app.evaluate(async () => {
      document.querySelectorAll('.vista').forEach((v) => v.classList.remove('activa'));
      document.getElementById('vista-comisiones').classList.add('activa');
      await cargarComisiones();
      await new Promise((r) => setTimeout(r, 300));
      const out = {};
      document.querySelectorAll('#comm-panel-product .ventana-estado').forEach((t) => { out[t.querySelector('.rotulo').textContent.trim()] = t.querySelector('.cifra').textContent.trim(); });
      return out;
    });
    const dash = await entrar(ctx, '789');
    await tablero(dash);
    const deElTablero = await tiles(dash);
    for (const k of ['Sales with commission', 'Associates take', 'House keeps', 'Still to pay']) {
      assert.ok(deLaApp[k], 'la app muestra ' + k + ': ' + JSON.stringify(deLaApp));
      assert.equal(deElTablero[k], deLaApp[k], k + ' igual en el tablero y en la app');
    }
    assert.notEqual(deElTablero['Associates take'], '$0.00', 'la duena ve plata real, no $0');
  } finally { await web.close(); }
});

test('(5) dashboard of a licensed business shows ONLY real records; nothing is deleted from storage', async () => {
  const web = await chromium.launch({ headless: true });
  try {
    const ctx = await contexto(web);
    const app = await abrirApp(ctx);
    const { rack } = await negocioDeComisiones(app);
    for (const sku of ['2010003', '8010005', '9010012', '1110004', '2110000']) {
      await api(app, '/api/productos', 'POST', { nombre: 'Real ' + sku, barcode: sku, sku, precio: 50, costo: 20, stockInicial: 4, ubicacionId: rack.id });
    }
    const guardado = () => app.evaluate(() => {
      const ptr = localStorage.getItem('f123_estado_v4_ptr') || 'B';
      const e = JSON.parse(localStorage.getItem('f123_estado_v4_' + ptr));
      return { productos: e.productos.length, clientes: e.clientes.length, ventas: e.ventas.length, ubicaciones: e.ubicaciones.length, promotoras: e.promotoras.length,
        demoP: e.productos.filter((p) => /^p\d\d$/.test(p.id)).length, demoPr: e.promotoras.filter((p) => /\(sample\)/.test(p.nombre)).length };
    });
    const antes = await guardado();
    assert.ok(antes.demoP > 30 && antes.demoPr === 2, 'el cuaderno trae el demo mezclado: ' + JSON.stringify(antes));
    const dash = await entrar(ctx, '789');
    await tablero(dash);
    const kpis = await dash.evaluate(() => document.getElementById('kpis').textContent);
    assert.match(kpis, /6 productos/, 'Inventario cuenta SOLO los 6 reales: ' + kpis);
    const todo = await dash.evaluate(() => document.body.innerText);
    assert.ok(!/ART-OIL-001|Consignment Artist|Event Partner|Sample Gallery|Original oil/.test(todo), 'ningun registro demo en pantalla');
    assert.ok(/Ana Tablero/.test(todo) || /Taza Tablero/.test(todo));
    assert.deepEqual(await guardado(), antes, 'nada se borro del almacenamiento');
  } finally { await web.close(); }
});
