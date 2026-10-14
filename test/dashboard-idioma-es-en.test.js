// Oct14fixes 6b (JFC 2026-10-14): el tablero mezclaba espanol e ingles ("Entró hoy" junto a
// "Stock / cost pending", "Still to pay", "Restock", "Ventas pendientes"...). Debe seguir el
// idioma elegido en la app (f123_lang), igual que la app.
// Prueba: con datos sinteticos se recorren todas las vistas del tablero en Chromium y WebKit.
// Con ES no puede quedar texto visible en ingles; con EN, ninguno en espanol.
// Se detecta con listas de palabras propias de cada idioma, independientes del diccionario del
// tablero (sin las que existen en los dos: real, plan, capital, ranking, log, sale) (si la prueba usara el mismo diccionario, pasaria sola).
// Exentos a proposito: la etiqueta "Dashboard vNNN" (identidad del shell, la exige
// dashboard-identidad-version.test.js) y el log tecnico del periscopio (codigos crudos del
// registro de la app, no textos de pantalla). Nombres de prueba neutros: no son palabras de
// ningun idioma.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium, webkit } = require('playwright');

const DOCS = path.resolve(__dirname, '../docs');
const ORIGIN = 'http://localhost:18511';
const TIPOS = { '.html': 'text/html', '.js': 'application/javascript', '.json': 'application/json', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' };

const SOLO_EN = new Set(('the your you and of to with for from this that is are not still pay paid pending sales ' +
  'commission commissions customer customers product products price cost margin date today home team alerts tools ' +
  'restock search refresh print who when house takes sold rack shelf deal month people collected profit buyers last ' +
  'description category amount units order reorder transfers phone age country detail device owner receipt goal tiers ' +
  'payments support inventory value events expenses monthly copy report history got how we handle data see my ' +
  'business board waiting snapshot finance status type event associate associates seller none each where goes ' +
  'earned most adjust record full partial unit broken lost selling freight shipping taxes customs other received ' +
  'healthy opportunity urgent dormant running low connected live instant access activity check accountant ago').split(/\s+/));
const SOLO_ES = new Set(('de la el los las que en por para con sin del hoy ventas venta clientes cliente producto productos ' +
  'percha perchas pendiente pendientes equipo dispositivo dispositivos tu tus ningún todavía entró ganancia inventario ' +
  'dormido sano oportunidad urgente acaba cuaderno lienzo tablero cargando comisionista comisionistas comisión ' +
  'comisiones pagos casa mes rojo vendido cómo datos tratamos desde hasta todas todo historial medio registrado netas ' +
  'efectivo fiado otros devoluciones precio importe vivo instante conectado conexión aparato después costo movimiento ' +
  'unidades vendibles ganas cada una escribe cuánto pagaste liquidar quienes cobran queda ver persona misma puede ser ' +
  'artista distintos cosas ciertas vez alta formulario sincronizan aparatos negocio reponer cero filtro deja juntos ' +
  'compró hace compras monto matriz comportamiento contar cuotas ahí mismo dueño soporte herramientas inicio alertas').split(/\s+/));

function palabrasAjenas(textos, lang) {
  const malas = [];
  const lista = lang === 'es' ? SOLO_EN : SOLO_ES;
  for (const t of textos) {
    /* Palabras sueltas; un token con cifras es un id o un codigo (v9de12b44...), no texto. */
    const ws = t.toLowerCase().split(/[^0-9a-záéíóúñü]+/i).filter((w) => w && !/\d/.test(w));
    const hit = ws.filter((w) => lista.has(w));
    if (lang === 'en' && /[áéíóúñ¿¡]/i.test(t)) hit.push('(acento)');
    if (hit.length) malas.push(t.slice(0, 120) + '  <- ' + hit.join(','));
  }
  return malas;
}

async function textosVisibles(page) {
  return page.evaluate(() => {
    const res = [];
    const exento = (e) => e.closest('#dashboard-version, #oc-log-tabla, #oc-log-sync');
    const vis = (e) => { for (let x = e; x && x.nodeType === 1; x = x.parentElement) { const cs = getComputedStyle(x); if (cs.display === 'none' || cs.visibility === 'hidden') return false; } return true; };
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = w.nextNode())) {
      const p = n.parentElement; const s = n.nodeValue.replace(/\s+/g, ' ').trim();
      if (!s || !p || /^(SCRIPT|STYLE)$/.test(p.tagName) || exento(p) || !vis(p)) continue;
      res.push(s);
    }
    document.querySelectorAll('[placeholder],[title],[aria-label]').forEach((e) => {
      if (exento(e) || !vis(e)) return;
      ['placeholder', 'title', 'aria-label'].forEach((a) => { const v = e.getAttribute(a); if (v) res.push(v); });
    });
    return res;
  });
}

async function recorrer(engine, lang) {
  const browser = await engine.launch({ headless: true });
  try {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' });
    await ctx.route('**/*', async (route) => {
      const u = new URL(route.request().url());
      if (u.origin !== ORIGIN) return route.abort();
      const file = path.resolve(DOCS, u.pathname.slice(1));
      if (!file.startsWith(DOCS + path.sep)) return route.abort();
      try { await route.fulfill({ status: 200, contentType: TIPOS[path.extname(file)] || 'application/octet-stream', body: fs.readFileSync(file) }); }
      catch (_) { await route.fulfill({ status: 404, body: 'fixture asset absent' }); }
    });
    await ctx.addInitScript(() => { window.WebSocket = class { constructor() { this.readyState = 3; } send() {} close() {} addEventListener() {} removeEventListener() {} }; });
    const app = await ctx.newPage();
    await app.goto(ORIGIN + '/index.html');
    await app.waitForFunction(() => window.OCAuth && window.OCSecure);
    await app.evaluate(async (lang) => {
      OCAuth.rolActual = () => 'dueno';
      localStorage.setItem('f123_owned', JSON.stringify({ licenseCode: 'F123-TEST-0000-0000-00000', nombreNegocio: 'Zeta' }));
      localStorage.setItem('f123_lang', lang);
      await OCSecure.guardarSecreto('789', ['260'], '357', '');
      const api = async (u, m, b) => (await fetch(u, { method: m || 'GET', headers: b ? { 'Content-Type': 'application/json' } : undefined, body: b ? JSON.stringify(b) : undefined })).json();
      const mika = await api('/api/promotoras', 'POST', { nombre: 'Mika Zed', comisionBase: 40 });
      const rack = await api('/api/ubicaciones', 'POST', { nombre: 'Mora 7', tipo: 'socio', comisionSocio: 40 });
      await api('/api/ubicaciones/' + rack.id, 'PUT', { promotoraId: mika.id });
      const prod = await api('/api/productos', 'POST', { nombre: 'Kilo 7', barcode: 'K-007', sku: '1010000', precio: 100, costo: 30, stockInicial: 2, ubicacionId: rack.id });
      await api('/api/productos', 'POST', { nombre: 'Kilo 8', barcode: 'K-008', sku: '1010001', precio: 50, stockInicial: 5, ubicacionId: rack.id });
      for (let i = 0; i < 2; i++) await api(`/api/productos/${prod.id}/venta`, 'POST', { cantidad: 1 });
    }, lang);

    const dash = await ctx.newPage();
    await dash.goto(ORIGIN + '/dashboard.html');
    const vistos = [];
    const tomar = async (donde) => { await dash.waitForTimeout(250); (await textosVisibles(dash)).forEach((t) => vistos.push(donde + ' | ' + t)); };
    await tomar('puerta');
    await dash.fill('#pin', '789');
    await dash.click('#entrar');
    await dash.waitForFunction(() => getComputedStyle(document.getElementById('tablero')).display !== 'none' && document.getElementById('kpis').children.length, null, { timeout: 10000 });
    await tomar('inicio');
    for (const r of ['hoy', 'comisiones', 'inventario', 'clientes', 'equipo', 'alertas', 'herramientas']) {
      await dash.evaluate((x) => { location.hash = '#/' + x; }, r);
      await dash.waitForFunction((x) => document.documentElement.getAttribute('data-hub-ruta') === x, r);
      await tomar(r);
      const tabs = await dash.evaluate(() => [...document.querySelectorAll('#tabsel button')].filter((b) => !b.hidden && b.offsetWidth).map((b) => b.getAttribute('data-v')));
      for (const k of tabs) { await dash.click(`#tabsel [data-v="${k}"]`); await tomar(r + '/' + k); }
      if (r === 'comisiones') for (const v of ['percha', 'producto']) { const b = await dash.$(`[data-cm-vista="${v}"]`); if (b) { await b.click(); await tomar(r + '/' + v); } }
      if (r === 'herramientas') { await dash.fill('#cu-total', '100'); await dash.fill('#cu-unid', '10'); await dash.fill('#cu-precio', '20'); await tomar('calculadora'); }
      if (r === 'equipo') for (const b of await dash.$$('#avz-sel button')) { await b.click(); await tomar('avanzado'); }
    }
    await dash.evaluate(() => { location.hash = '#/'; document.getElementById('isla-cab').click(); });
    await tomar('isla');
    await dash.evaluate(() => document.getElementById('ver-politica').click());
    await tomar('politica');
    return [...new Set(vistos)];
  } finally { await browser.close(); }
}

for (const [nombre, engine] of [['Chromium', chromium], ['WebKit', webkit]]) {
  for (const lang of ['es', 'en']) {
    test(`tablero en ${lang.toUpperCase()} sin textos del otro idioma (${nombre})`, async () => {
      const vistos = await recorrer(engine, lang);
      assert.ok(vistos.length > 80, 'se recorrio el tablero: ' + vistos.length + ' textos');
      const malas = palabrasAjenas(vistos.map((v) => v.split(' | ').slice(1).join(' | ')), lang);
      assert.deepEqual(malas, [], 'textos en el otro idioma:\n' + malas.join('\n'));
    });
  }
}
