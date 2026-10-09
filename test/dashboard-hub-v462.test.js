/* v462 (JFC 2026-10-07): el dashboard pasa a ser un hub, fase 1.
   Isla viva arriba, inicio con tarjetas, rutas por hash, barra inferior (movil) y lateral (escritorio).
   Nada de lo que ya estaba en dashboard.html puede desaparecer: cada seccion vieja vive ahora en una tarjeta.
   Chromium con red cortada (solo file:/data:/blob:), WebSocket de mentira, datos y licencia sinteticos. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const INDEX = pathToFileURL(path.resolve(__dirname, '../docs/index.html')).href;
const DASH = pathToFileURL(path.resolve(__dirname, '../docs/dashboard.html')).href;
const LIC = 'F123-TEST-0000-0000-00000';
const SHOTS = path.join(os.tmpdir(), 'f123hub');
try { fs.mkdirSync(SHOTS, { recursive: true }); } catch (_) {}
const foto = (page, nombre) => page.screenshot({ path: path.join(SHOTS, nombre + '.png') }).catch(() => {});

async function contexto(web, opts = {}) {
  const ctx = await web.newContext(Object.assign({ viewport: { width: 1280, height: 900 } }, opts));
  await ctx.route((u) => !/^(file|data|blob|about):/i.test(String(u)), (r) => r.abort());
  await ctx.addInitScript(() => {
    /* WebSocket de mentira: el tablero jamas toca el relay real. */
    window.WebSocket = class { constructor() { this.readyState = 3; } send() {} close() {} addEventListener() {} removeEventListener() {} };
  });
  return ctx;
}
async function abrirApp(ctx) {
  const app = await ctx.newPage();
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
/* Una percha compartida al 40%, un producto, tres ventas de $100: $300 entran hoy, $120 por pagar. */
async function negocio(app) {
  const ana = await api(app, '/api/promotoras', 'POST', { nombre: 'Ana Hub', comisionBase: 40 });
  const rack = await api(app, '/api/ubicaciones', 'POST', { nombre: 'Percha Hub', tipo: 'socio', comisionSocio: 40 });
  await api(app, '/api/ubicaciones/' + rack.id, 'PUT', { promotoraId: ana.id });
  const prod = await api(app, '/api/productos', 'POST', { nombre: 'Taza Hub', barcode: 'HUB-001', sku: '1010000', precio: 100, costo: 30, stockInicial: 20, ubicacionId: rack.id });
  for (let i = 0; i < 3; i++) await api(app, `/api/productos/${prod.id}/venta`, 'POST', { cantidad: 1 });
  return { ana, rack, prod };
}
async function entrar(ctx, pin, hash) {
  const dash = await ctx.newPage();
  await dash.goto(DASH + (hash || ''), { waitUntil: 'load' });
  await dash.fill('#pin', pin);
  await dash.click('#entrar');
  await dash.waitForFunction(() => getComputedStyle(document.getElementById('tablero')).display !== 'none' && document.getElementById('kpis').children.length, null, { timeout: 8000 });
  return dash;
}
const visible = (page, sel) => page.evaluate((s) => {
  const e = document.querySelector(s); if (!e) return false;
  const r = e.getBoundingClientRect(), cs = getComputedStyle(e);
  return r.width > 0 && r.height > 0 && cs.display !== 'none' && cs.visibility !== 'hidden';
}, sel);
const ruta = (page) => page.evaluate(() => document.documentElement.getAttribute('data-hub-ruta'));
/* hashchange es asincrono: se espera a que la ruta cambie antes de mirar la pantalla. */
const esperaRuta = (page, r) => page.waitForFunction((x) => document.documentElement.getAttribute('data-hub-ruta') === x, r, { timeout: 5000 });

/* Las 11 vistas de tabla que tenia el tablero, por tarjeta. */
const TABLAS = {
  hoy: ['ventas', 'eventos', 'gastos', 'gastoMensual'],
  comisiones: ['comisiones', 'comisionistas'],
  inventario: ['productos', 'reposicion'],
  clientes: ['clientes', 'transferencias', 'hechosFinancieros'],
};
/* Secciones sueltas por tarjeta (selector que antes estaba apilado en la pagina). */
const SECCIONES = {
  hoy: ['#kpis', '#finanzas-foto', '#datos'],
  comisiones: ['#cm', '#datos'],
  inventario: ['#datos'],
  clientes: ['#datos'],
  equipo: ['#micelio', '#avz', '#acceso'],
  herramientas: ['#costo-unit', '#soporte', '#oc-log-tablero'],
  alertas: ['#alertas-lista'],
};

test('(a) every section the dashboard had is reachable from a tile and from the bar', async () => {
  const web = await chromium.launch({ headless: true });
  try {
    const ctx = await contexto(web);
    const app = await abrirApp(ctx); const fixture = await negocio(app);
    const dash = await entrar(ctx, '789');
    assert.equal(await ruta(dash), 'inicio', 'el tablero abre en el inicio del hub');
    for (const t of ['hoy', 'comisiones', 'inventario', 'clientes', 'equipo', 'alertas', 'herramientas']) assert.ok(await visible(dash, `[data-tile="${t}"]`), 'tarjeta ' + t);
    assert.ok(!(await visible(dash, '#cm')), 'en el inicio no se apila todo');
    await foto(dash, 'hub-inicio-1280');

    const vistos = new Set();
    for (const [r, secs] of Object.entries(SECCIONES)) {
      await dash.click('[data-ruta="inicio"]');
      await esperaRuta(dash, 'inicio');
      await dash.click(`[data-tile="${r}"]`);
      await esperaRuta(dash, r);
      for (const s of secs) assert.ok(await visible(dash, s), `${r}: ${s} visible`);
      assert.ok(await visible(dash, '#vista-cab'), 'Atras y titulo');
      for (const k of (TABLAS[r] || [])) {
        await dash.click(`#tabsel [data-v="${k}"]`);
        const txt = await dash.evaluate(() => document.getElementById('tabla').innerText.trim());
        assert.ok(txt.length > 0, `${r}/${k}: la tabla pinta`);
        assert.ok(await dash.evaluate((x) => document.querySelector(`#tabsel [data-v="${x}"]`).classList.contains('on'), k), 'pestana activa');
        vistos.add(k);
      }
      /* Solo las pestanas de esta tarjeta. */
      if (TABLAS[r]) {
        const pestanas = await dash.evaluate(() => [...document.querySelectorAll('#tabsel button')].filter((b) => !b.hidden).map((b) => b.getAttribute('data-v')));
        assert.deepEqual(pestanas.sort(), TABLAS[r].slice().sort(), r + ': pestanas de la tarjeta');
      }
      await foto(dash, 'hub-' + r + '-1280');
    }
    assert.equal(vistos.size, 11, 'las 11 vistas de tabla alcanzables: ' + [...vistos].join(','));
    /* Commissions conserva Pay in the app (deep-link a la app). */
    await dash.click('[data-ruta="comisiones"]');
    await esperaRuta(dash, 'comisiones');
    assert.ok(await visible(dash, '#cm a.pagar'), 'Pay in the app visible en Commissions');
    assert.equal(await dash.evaluate(() => document.querySelector('#cm a.pagar').getAttribute('href')), 'index.html#editar=comisionproducto:' + encodeURIComponent(fixture.prod.id) + '&mes=' + new Date().toISOString().slice(0, 7));
    await dash.click('[data-cm-vista="percha"]');
    assert.ok(await visible(dash, '#cm a.pagar'), 'grouped rack payment stays reachable');
    assert.match(await dash.evaluate(() => document.querySelector('#cm a.pagar').getAttribute('href')), /index\.html#editar=comisiones:/);
    /* Herramientas: la calculadora sigue calculando. */
    await dash.click('[data-ruta="herramientas"]');
    await esperaRuta(dash, 'herramientas');
    await dash.fill('#cu-total', '100'); await dash.fill('#cu-unid', '10');
    assert.match(await dash.evaluate(() => document.getElementById('cu-out').innerText), /10\.00/, 'calculadora de costo unitario');
    /* Barra de escritorio: los 8 destinos, uno por ruta. */
    const lado = await dash.evaluate(() => [...document.querySelectorAll('#nav-hub a')].filter((a) => a.getBoundingClientRect().width > 0).map((a) => a.getAttribute('data-ruta')));
    assert.deepEqual(lado, ['inicio', 'hoy', 'comisiones', 'inventario', 'clientes', 'equipo', 'alertas', 'herramientas']);
    /* Un enlace #/ruta directo (tambien el boton Atras) cambia de vista. */
    await dash.evaluate(() => { location.hash = '#/equipo'; });
    await dash.waitForFunction(() => document.documentElement.getAttribute('data-hub-ruta') === 'equipo');
    await dash.goBack();
    await dash.waitForFunction(() => document.documentElement.getAttribute('data-hub-ruta') !== 'equipo');
  } finally { await web.close(); }
});

test('(a2) phone: the bottom bar has 5 destinations and reaches their views', async () => {
  const web = await chromium.launch({ headless: true });
  try {
    const ctx = await contexto(web, { viewport: { width: 375, height: 800 } });
    const app = await abrirApp(ctx); await negocio(app);
    const dash = await entrar(ctx, '789');
    const barra = await dash.evaluate(() => [...document.querySelectorAll('#nav-hub a')].filter((a) => a.getBoundingClientRect().width > 0).map((a) => a.getAttribute('data-ruta')));
    assert.deepEqual(barra, ['inicio', 'hoy', 'comisiones', 'inventario', 'equipo']);
    const pos = await dash.evaluate(() => { const r = document.getElementById('nav-hub').getBoundingClientRect(); return { abajo: Math.round(r.bottom), alto: Math.round(innerHeight), h: Math.round(r.height) }; });
    assert.equal(pos.abajo, pos.alto, 'la barra va pegada abajo');
    assert.ok(pos.h >= 56, 'barra de al menos 56 px');
    for (const r of ['hoy', 'comisiones', 'inventario', 'equipo', 'inicio']) {
      await dash.click(`#nav-hub [data-ruta="${r}"]`);
      await esperaRuta(dash, r);
      assert.equal(await dash.evaluate((x) => document.querySelector(`#nav-hub [data-ruta="${x}"]`).getAttribute('aria-current'), r), 'page');
    }
    /* Clientes, Alertas y Herramientas se alcanzan desde las tarjetas. */
    for (const r of ['clientes', 'alertas', 'herramientas']) {
      await dash.click('[data-ruta="inicio"]'); await esperaRuta(dash, 'inicio'); await dash.click(`[data-tile="${r}"]`);
      await esperaRuta(dash, r);
    }
    await foto(dash, 'hub-herramientas-375');
  } finally { await web.close(); }
});

test('(b) island resting money equals the Today KPI; alerts stay until tapped', async () => {
  const web = await chromium.launch({ headless: true });
  try {
    const ctx = await contexto(web);
    const app = await abrirApp(ctx); await negocio(app);
    const dash = await entrar(ctx, '789');
    const est = () => dash.evaluate(() => document.getElementById('isla').getAttribute('data-estado'));
    /* Hay $120 por pagar: la alerta aparece y NO se va sola. */
    assert.equal(await est(), 'alerta', 'alerta pendiente al entrar');
    await dash.waitForTimeout(4600);
    assert.equal(await est(), 'alerta', 'la alerta sigue pasados los 4 s');
    assert.match(await dash.evaluate(() => document.getElementById('isla-txt').textContent), /Alerts · \d/);
    await foto(dash, 'isla-alerta-1280');
    /* Tocar expande: 4 filas que llevan a su tarjeta. */
    await dash.click('#isla-cab');
    assert.equal(await est(), 'expandida');
    const filas = await dash.evaluate(() => [...document.querySelectorAll('#isla-filas a')].map((a) => [a.querySelector('.isla-et').textContent, a.getAttribute('href')]));
    assert.deepEqual(filas, [['Sync', '#/equipo'], ['Last sale', '#/hoy'], ['Payments', '#/comisiones'], ['Alerts', '#/alertas']]);
    assert.match(await dash.evaluate(() => document.getElementById('isla-v-venta').textContent), /Taza Hub/);
    assert.equal(await dash.evaluate(() => document.getElementById('isla-v-pagos').textContent), '$120.00');
    assert.equal(await dash.evaluate(() => document.getElementById('isla-cab').getAttribute('aria-expanded')), 'true');
    await dash.waitForTimeout(400);
    await foto(dash, 'isla-expandida-1280');
    /* Cada fila lleva a su tarjeta y cierra la isla. */
    await dash.click('#isla-filas [data-fila="pagos"]');
    await esperaRuta(dash, 'comisiones');
    assert.notEqual(await est(), 'expandida');
    /* Ya tocada, la misma alerta no vuelve: reposo = dinero de hoy. */
    await dash.waitForFunction(() => document.getElementById('isla').getAttribute('data-estado') === 'reposo');
    const dinero = await dash.evaluate(() => document.getElementById('isla-dinero').textContent.trim());
    const kpi = await dash.evaluate(() => document.querySelector('#kpis .kpi .n').textContent.trim());
    assert.equal(dinero, '$300.00');
    assert.equal(dinero, kpi, 'la isla en reposo dice lo mismo que el KPI Entro hoy');
    assert.equal(await dash.evaluate(() => document.getElementById('t-hoy-n').textContent.trim()), kpi, 'y la tarjeta Today');
    await foto(dash, 'isla-reposo-1280');
    /* Escape cierra la expandida. */
    await dash.click('#isla-cab'); assert.equal(await est(), 'expandida');
    await dash.keyboard.press('Escape'); assert.equal(await est(), 'reposo');
  } finally { await web.close(); }
});

test('(c) a sale made in the app shows on the island within 500 ms, for 4 s, with no reload', async () => {
  const web = await chromium.launch({ headless: true });
  try {
    const ctx = await contexto(web);
    const app = await abrirApp(ctx);
    const { prod } = await negocio(app);
    const dash = await entrar(ctx, '789');
    /* Se toca la alerta primero para que el reposo sea limpio. */
    await dash.click('#isla-cab'); await dash.click('#isla-cab');
    await dash.evaluate(() => { window.__sinRecarga = 1; });
    const t0 = await app.evaluate(async (id) => {
      const r = await fetch(`/api/productos/${id}/venta`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cantidad: 2 }) });
      if (r.status >= 400) throw new Error('venta ' + r.status);
      return Date.now();
    }, prod.id);
    const r = await dash.evaluate(async () => {
      const ini = Date.now();
      while (Date.now() - ini < 4000) {
        const el = document.getElementById('isla');
        if (el.getAttribute('data-estado') === 'evento') return { t: Date.now(), txt: document.getElementById('isla-txt').textContent, dinero: document.getElementById('isla-dinero').textContent };
        await new Promise((x) => setTimeout(x, 5));
      }
      return null;
    });
    assert.ok(r, 'la isla nunca anuncio la venta');
    const ms = r.t - t0;
    console.log('MEDIDO isla venta nueva ms =', ms);
    assert.ok(ms <= 500, 'la isla tardo ' + ms + ' ms (limite 500)');
    assert.match(r.txt, /2× Taza Hub · \$200\.00/);
    assert.equal(await dash.evaluate(() => window.__sinRecarga), 1, 'sin recargar');
    await dash.waitForTimeout(350);
    await foto(dash, 'isla-evento-1280');
    /* A los 4 s vuelve a reposo con el dinero nuevo. */
    await dash.waitForFunction(() => document.getElementById('isla').getAttribute('data-estado') === 'reposo', null, { timeout: 7000 });
    assert.equal(await dash.evaluate(() => document.getElementById('isla-dinero').textContent.trim()), '$500.00');
    assert.equal(await dash.evaluate(() => document.querySelector('#kpis .kpi .n').textContent.trim()), '$500.00');
  } finally { await web.close(); }
});

test('(d) owner and admin both enter the hub and see every card', async () => {
  const web = await chromium.launch({ headless: true });
  try {
    const ctx = await contexto(web);
    const app = await abrirApp(ctx); await negocio(app);
    await api(app, '/api/usuarios', 'POST', { nombre: 'Admin Hub', pin: '555', rol: 'admin' });
    for (const pin of ['789', '555']) {
      const dash = await entrar(ctx, pin);
      assert.ok(await visible(dash, '#isla'), pin + ': isla');
      for (const t of ['hoy', 'comisiones', 'inventario', 'clientes', 'equipo', 'alertas', 'herramientas']) assert.ok(await visible(dash, `[data-tile="${t}"]`), `${pin}: tarjeta ${t}`);
      assert.equal(await dash.evaluate(() => document.getElementById('isla-dinero').textContent.trim()), '$300.00', pin + ': mismo dinero');
      await dash.close();
    }
  } finally { await web.close(); }
});

for (const ancho of [375, 1280]) {
  test(`(e) no horizontal scroll at ${ancho}px on the home or any card`, async () => {
    const web = await chromium.launch({ headless: true });
    try {
      const ctx = await contexto(web, { viewport: { width: ancho, height: 800 } });
      const app = await abrirApp(ctx); await negocio(app);
      const dash = await entrar(ctx, '789');
      for (const r of ['inicio', 'hoy', 'comisiones', 'inventario', 'clientes', 'equipo', 'alertas', 'herramientas']) {
        await dash.evaluate((x) => { location.hash = x === 'inicio' ? '#/' : '#/' + x; }, r);
        await dash.waitForFunction((x) => document.documentElement.getAttribute('data-hub-ruta') === x, r);
        const over = await dash.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: innerWidth }));
        assert.ok(over.sw <= over.iw, `${ancho}px ${r}: scrollWidth ${over.sw} > ${over.iw}`);
      }
      await dash.click('#isla-cab'); await dash.waitForTimeout(400);
      const over = await dash.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: innerWidth }));
      assert.ok(over.sw <= over.iw, 'isla expandida sin scroll horizontal');
      await foto(dash, 'hub-isla-expandida-' + ancho);
      await dash.click('#isla-cab');
      await dash.evaluate(() => { location.hash = '#/'; });
      await dash.waitForTimeout(400);
      await foto(dash, 'hub-inicio-' + ancho);
    } finally { await web.close(); }
  });
}

test('(f) with prefers-reduced-motion everything still renders and the island does not animate', async () => {
  const web = await chromium.launch({ headless: true });
  try {
    const ctx = await contexto(web, { reducedMotion: 'reduce' });
    const app = await abrirApp(ctx); await negocio(app);
    const dash = await entrar(ctx, '789');
    for (const s of ['#isla', '#isla-cab', '#nav-hub', '[data-tile="hoy"]', '[data-tile="inventario"]', '[data-tile="herramientas"]']) assert.ok(await visible(dash, s), s);
    const dur = await dash.evaluate(() => parseFloat(getComputedStyle(document.getElementById('isla')).transitionDuration));
    assert.ok(dur <= 0.001, 'transicion de la isla: ' + dur);
    await dash.click('#isla-cab');
    assert.equal(await dash.evaluate(() => document.getElementById('isla').getAttribute('data-estado')), 'expandida');
    assert.ok(await visible(dash, '#isla-filas a'), 'filas visibles sin esperar animacion');
    await dash.click('#isla-cab');
  } finally { await web.close(); }
});

test('(g) JFC visual rules on the new pieces: nothing under 12px, solid text, no opacity on text containers, 44px targets', async () => {
  const web = await chromium.launch({ headless: true });
  try {
    for (const ancho of [375, 1280]) {
      const ctx = await contexto(web, { viewport: { width: ancho, height: 800 } });
      const app = await abrirApp(ctx); await negocio(app);
      const dash = await entrar(ctx, '789');
      await dash.click('#isla-cab'); await dash.waitForTimeout(400);
      const r = await dash.evaluate(() => {
        const malos = [], chicos = [];
        const zonas = ['#isla', '#nav-hub', '#hub', '#vista-cab'];
        zonas.forEach((z) => document.querySelectorAll(z + ', ' + z + ' *').forEach((e) => {
          const cs = getComputedStyle(e), r = e.getBoundingClientRect();
          if (!r.width || !r.height || cs.display === 'none') return;
          if (e.childNodes.length && [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) {
            if (parseFloat(cs.fontSize) < 12) malos.push(['size', z, e.className, cs.fontSize]);
            if (/rgba\([^)]*,\s*0?\.\d+\)/.test(cs.color) || /rgba?\(.*\/\s*0?\.\d+\)/.test(cs.color)) malos.push(['alpha', e.className, cs.color]);
            let p = e; while (p && p !== document.body) { if (parseFloat(getComputedStyle(p).opacity) < 1) { malos.push(['opacity', p.className]); break; } p = p.parentElement; }
          }
          if (e.matches('a, button') && (r.height < 44 - 0.5)) chicos.push([e.className || e.tagName, Math.round(r.height)]);
        }));
        return { malos, chicos };
      });
      assert.deepEqual(r.malos, [], ancho + 'px reglas de texto');
      assert.deepEqual(r.chicos, [], ancho + 'px targets de 44px');
      await ctx.close();
    }
  } finally { await web.close(); }
});
