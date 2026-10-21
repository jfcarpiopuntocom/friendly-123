'use strict';
// v557 audit, TASK A: ningun dato de cliente toca el relay viejo de Cloudflare ni KV.
// Parte 1 (estatica): recorre docs/ (sin vendor ni demo) y clasifica cada destino de red.
// Parte 2 (navegador real): abre la app en Chromium con licencia sintetica, registra CADA
// pedido y CADA WebSocket (sin bloquear a ciegas) mientras se crea producto, venta, fiado,
// gasto, cliente y se abren Perchas y dashboard.html. Solo datos sinteticos, cero produccion
// (test/helpers/sin-red-produccion.cjs ademas aborta *.workers.dev si algo lo intentara).
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startServer, openDevice, enterAs, go, chromium } = require('./helpers/e2e-app.cjs');

const DOCS = path.resolve(__dirname, '..', 'docs');
function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) { if (e.name !== 'vendor' && e.name !== 'demo') walk(path.join(dir, e.name), out); }
    else if (/\.(js|mjs|html)$/.test(e.name)) out.push(path.join(dir, e.name));
  }
  return out;
}
const archivos = walk(DOCS).map(f => ({ rel: path.relative(DOCS, f).replace(/\\/g, '/'), src: fs.readFileSync(f, 'utf8') }));
// Los respaldos "swbackup ..." de sw.js no se cargan; se cuentan igual para no esconder nada.
const donde = re => archivos.filter(a => re.test(a.src)).map(a => a.rel).sort();

// ---------- Parte 1: estatica ----------
test('estatico: ningun archivo de docs/ abre un socket o canal crudo (WebSocket/EventSource/sendBeacon/XHR)', () => {
  for (const re of [/new\s+WebSocket\s*\(/, /new\s+EventSource\s*\(/, /sendBeacon\s*\(/, /new\s+XMLHttpRequest\s*\(/]) {
    assert.deepEqual(donde(re), [], 'destino de red crudo: ' + re);
  }
});

test('estatico: la cadena del relay viejo solo existe como localizador de sala en 3 archivos', () => {
  const esperados = ['dashboard.html', 'sync-realtime.js', 'sync-yjs.js'];
  assert.deepEqual(donde(/friendly123-sync-relay/), esperados);
  for (const nombre of esperados) {
    const src = archivos.find(a => a.rel === nombre).src;
    // Siempre wss:// + /sala/ (localizador que el gateway convierte a Supabase), nunca https:// ni fetch.
    for (const m of src.matchAll(/wss?:\/\/friendly123-sync-relay[^\s"'`]*/g)) assert.match(m[0], /^wss:\/\/friendly123-sync-relay\.jfcarpio\.workers\.dev\/sala\/$/);
    assert.ok(!/https?:\/\/friendly123-sync-relay/.test(src), nombre + ': el relay viejo no se usa por HTTP');
    // RELAY_URL solo se consume a traves del adaptador F123Relay.connect (nunca new WebSocket).
    const usos = [...src.matchAll(/RELAY_URL/g)].length;
    const viaAdaptador = [...src.matchAll(/F123Relay\.connect\(\s*RELAY_URL|(?:var|const|let)\s+url\s*=\s*RELAY_URL/g)].length;
    assert.ok(/F123Relay\.connect\(/.test(src), nombre + ': conecta por F123Relay.connect');
    assert.equal(usos, 1 + viaAdaptador, nombre + ': RELAY_URL = 1 definicion + usos que terminan en el adaptador');
    // Sin adaptador nativo, el codigo lanza y reintenta; no cae a un socket crudo.
    assert.match(src, /F123Relay/);
    assert.match(src, /(native relay unavailable|Native sync adapter unavailable)/);
  }
});

test('estatico: los 3 archivos de sync cargan el adaptador Supabase (vendor/supabase-relay) antes de usarlo', () => {
  assert.match(archivos.find(a => a.rel === 'dashboard.html').src, /vendor\/supabase-relay\.min\.js/);
  assert.match(archivos.find(a => a.rel === 'index.html').src, /vendor\/supabase-relay\.min\.js/);
});

test('estatico: el unico host workers.dev que es destino real de red es el de LICENCIAS', () => {
  const hosts = new Map();
  for (const a of archivos) for (const m of a.src.matchAll(/([a-z0-9-]+)\.[a-z0-9-]+\.workers\.dev/gi)) {
    if (!hosts.has(m[1])) hosts.set(m[1], new Set()); hosts.get(m[1]).add(a.rel);
  }
  // 'amigable-licencias' solo aparece en un comentario historico de auth-ui.js (el nombre viejo del Worker).
  assert.deepEqual([...hosts.keys()].sort(), ['amigable-licencias', 'friendly123-licencias', 'friendly123-sync-relay']);
  assert.deepEqual([...hosts.get('amigable-licencias')], ['auth-ui.js']);
  assert.match(archivos.find(a => a.rel === 'auth-ui.js').src, /\/\*[^]*?amigable-licencias\.jfcarpio\.workers\.dev[^]*?\*\//);
  // Licencias: referencias permitidas (panel de JFC, verificacion maestra, comentarios de auth-ui).
  const lic = [...hosts.get('friendly123-licencias')].sort();
  assert.deepEqual(lic, ['auth-ui.js', 'crypto-store.js', 'panel.html']);
  // Rutas que el cliente pide al Worker de licencias: solo licencia, latido, canario y maestro. Nada de datos.
  const rutas = new Set();
  for (const a of archivos) for (const m of a.src.matchAll(/workerUrl\(\)[^;]{0,200}?["'`](\/[a-z\-]+)/gi)) rutas.add(m[1]);
  for (const r of rutas) assert.match(r, /^\/(checkin|canario|licencias|maestro|rescate|recover|pin|panel|api)/, 'ruta de worker inesperada: ' + r);
});

test('estatico: nada en docs/ nombra KV de Cloudflare ni su API', () => {
  assert.deepEqual(donde(/api\.cloudflare\.com|kv_namespaces|\bKVNamespace\b|\.LICENCIAS\.(get|put|list|delete)\b/), []);
});

test('estatico: toda llamada fetch/cliente a hosts externos esta clasificada', () => {
  // Telemetria (solo https y fuera de localhost): Sentry + PostHog en canarios.js
  assert.deepEqual(donde(/ingest\.us\.sentry\.io/), ['canarios.js']);
  assert.deepEqual(donde(/us\.i\.posthog\.com/), ['canarios.js']);
  // Geolocalizacion opcional (no es dato de negocio): geo-ping.js
  assert.deepEqual(donde(/ipapi\.co|ip-api\.com/), ['geo-ping.js']);
  // Ningun fetch() apunta a un host de datos de Cloudflare o Supabase escrito a mano.
  assert.deepEqual(donde(/fetch\(\s*["'`]https?:\/\/[^"'`]*(sync-relay[^"'`]*workers\.dev|supabase\.co)/), []);
  // crypto-store.js llama a /maestro/verificar del Worker de LICENCIAS (clave maestra), no es dato de negocio.
  assert.deepEqual(donde(/fetch\(\s*["'`]https?:\/\/friendly123-licencias/), ['crypto-store.js']);
});

// ---------- Parte 2: navegador real ----------
let server, base, web;
before(async () => { ({ srv: server, base } = await startServer()); web = await chromium.launch(); });
after(async () => { await web.close(); await new Promise(r => server.close(r)); });

const api = (page, url, method = 'GET', body) => page.evaluate(async ([u, m, b]) => {
  const r = await fetch(u, { method: m, body: b === undefined ? undefined : JSON.stringify(b) }); return r.json();
}, [url, method, body]);

test('navegador: durante producto, venta, fiado, gasto, cliente, perchas y dashboard no hay pedido ni socket a un relay de datos de Cloudflare', async () => {
  const porAccion = {}; let accion = 'carga';
  const mirar = (tipo, url) => {
    if (!url || url.startsWith('data:') || url.startsWith('blob:') || url.startsWith(base)) return;
    let host; try { host = new URL(url).host; } catch (_) { host = url; }
    (porAccion[accion] ||= new Set()).add(tipo + ' ' + host);
  };
  // Dispositivo propio (no openDevice) para poder registrar sin bloquear a ciegas: el WebSocket
  // se envuelve para anotar la URL y luego lanzar; los pedidos HTTP externos se anotan y se abortan.
  const ctx = await web.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  await ctx.exposeBinding('__logWs', (_s, url) => mirar('WS', String(url)));
  await ctx.addInitScript(() => {
    try { if (!localStorage.getItem('f123_owned')) localStorage.setItem('f123_owned', JSON.stringify({ licenseCode: 'F123-SYNTHETIC-AUDIT-ONLY' })); } catch (_) {}
    window.WebSocket = class { constructor(u) { try { window.__logWs(String(u)); } catch (_) {} throw new Error('no network in audit'); } };
  });
  ctx.on('request', r => mirar('HTTP', r.url()));
  await ctx.route(u => !u.href.startsWith(base) && !u.href.startsWith('data:') && !u.href.startsWith('blob:'), r => r.abort());
  const page = await ctx.newPage(); const errores = [];
  page.on('pageerror', e => errores.push(e.message));
  await page.goto(base + '/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.OCAuth && window.OCSync && window.OCYjs && window.cargarHoy);
  await enterAs(page, 'dueno');
  await page.waitForFunction(() => OCYjs.estado === 'activo');
  // Una sala sintetica obliga a la app a pedir su conexion de sync (la ruta que se audita).
  await page.evaluate(() => { try { localStorage.setItem('f123_sync_room', JSON.stringify({ codigo: 'SYNTHETICAUDIT' })); } catch (_) {} });

  accion = 'producto';
  const p = await api(page, '/api/productos', 'POST', { nombre: 'Prod sintetico', barcode: 'SYN-A1', stockInicial: 5, precio: 20, costo: 8 });
  assert.ok(p.id);
  await page.waitForTimeout(600);

  accion = 'venta';
  await api(page, '/api/productos/' + p.id + '/venta', 'POST', { cantidad: 1 });
  await page.waitForTimeout(600);

  accion = 'cliente';
  const c = await api(page, '/api/clientes', 'POST', { nombre: 'Cliente Sintetico' });
  assert.ok(c.id, 'cliente creado');
  await page.waitForTimeout(600);

  accion = 'fiado';
  const v = await api(page, '/api/productos/' + p.id + '/venta', 'POST', { cantidad: 1, clienteId: c.id, info: { formaPago: 'fiado' } });
  assert.ok(v, 'venta fiada registrada');
  await api(page, '/api/clientes/' + c.id + '/abonar', 'POST', { monto: 1 }).catch(() => {});
  await page.waitForTimeout(600);

  accion = 'gasto';
  await api(page, '/api/gastos', 'POST', { concepto: 'Gasto sintetico', monto: 12.5, fecha: new Date().toISOString() });
  await page.waitForTimeout(600);

  accion = 'perchas';
  await go(page, 'perchas'); await page.waitForTimeout(600);

  accion = 'dashboard';
  const dash = await ctx.newPage();
  dash.on('pageerror', e => errores.push('dashboard: ' + e.message));
  await dash.goto(base + '/dashboard.html', { waitUntil: 'domcontentloaded' });
  await dash.waitForTimeout(1500);
  await ctx.close();

  // Tabla por accion (queda en la salida de la prueba como evidencia).
  const tabla = Object.fromEntries(Object.entries(porAccion).map(([k, v2]) => [k, [...v2].sort()]));
  console.log('HOSTS POR ACCION ' + JSON.stringify(tabla, null, 1));
  const todo = Object.values(tabla).flat();
  // Veredicto: ni HTTP ni WebSocket a un relay de datos viejo; workers.dev solo para LICENCIAS.
  for (const s of todo) {
    assert.ok(!/sync-relay/.test(s), 'relay viejo contactado: ' + s);
    if (/workers\.dev/.test(s)) assert.match(s, /friendly123-licencias\./, 'workers.dev que no es licencias: ' + s);
  }
  assert.ok(!todo.some(s => /^WS .*workers\.dev/.test(s)), 'ningun WebSocket a workers.dev');
  // Las acciones de datos (producto/venta/fiado/gasto/cliente/perchas) jamas hablan con Cloudflare por datos.
  for (const a of ['producto', 'venta', 'cliente', 'fiado', 'gasto', 'perchas', 'dashboard'])
    for (const s of (tabla[a] || [])) assert.ok(!/sync-relay/.test(s) && !(/^WS /.test(s) && /workers\.dev/.test(s)), a + ': ' + s);
  assert.deepEqual(errores.filter(e => /Cloudflare data connection/.test(e)), []);
});
