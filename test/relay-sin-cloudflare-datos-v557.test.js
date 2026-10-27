'use strict';
// Business bytes stay off Cloudflare/Supabase; Cloudflare may coordinate SDP/ICE and clock metadata.
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
  assert.deepEqual(donde(/new\s+WS\s*\(/), ['peer-sync.js'], 'only the peer adapter may open the metadata socket');
});

test('estatico: los localizadores legacy solo llegan al adaptador directo y su socket usa /signal/', () => {
  const esperados = ['dashboard-main.min.js', 'sync-realtime.js', 'sync-yjs.js'];
  assert.deepEqual(donde(/friendly123-sync-relay/), [...esperados, 'peer-sync.js'].sort());
  for (const nombre of esperados) {
    const src = nombre === 'dashboard-main.min.js'
      ? fs.readFileSync(path.resolve(DOCS, '../src/dashboard/dashboard-main.js'), 'utf8')
      : archivos.find(a => a.rel === nombre).src;
    // /sala/ remains a local locator; the adapter never opens it as a network destination.
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
  const peer = archivos.find(a => a.rel === 'peer-sync.js').src;
  assert.match(peer, /signalURL\s*=.*wss:\/\/friendly123-sync-relay\.jfcarpio\.workers\.dev\/signal\//);
  assert.match(peer, /new WS\(signalURL \+ this\.room \+ '\?peer='/);
  assert.doesNotMatch(peer, /supabase|resolveRoute|f123_relay_command/);
});

test('estatico: app y dashboard cargan el adaptador directo sin inicializar Supabase', () => {
  for (const name of ['dashboard.html', 'index.html']) {
    const src = archivos.find(a => a.rel === name).src;
    assert.match(src, /<script\b[^>]*\bsrc="\.\/peer-sync\.js"[^>]*><\/script>/);
    assert.doesNotMatch(src, /supabase-relay\.min\.js|supabase\.co|f123_relay_command/);
  }
});

test('estatico: workers.dev queda limitado a licencias y senalizacion, nunca negocio central', () => {
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
  assert.deepEqual([...hosts.get('friendly123-sync-relay')].sort(), ['dashboard-main.min.js', 'peer-sync.js', 'sync-realtime.js', 'sync-yjs.js']);
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

test('frontera real del Worker: solo metadatos SDP/ICE/reloj; negocio y binarios no se reenvian', async () => {
  const src = fs.readFileSync(path.resolve(DOCS, '../cloudflare-sync-relay/worker.js'), 'utf8');
  const { validSignal, SignalRoom } = await import('data:text/javascript;base64,' + Buffer.from(src).toString('base64'));
  const to = 'b'.repeat(32);
  const ice = { v: 1, k: 'ice', to, data: { candidate: 'candidate:1 1 UDP 2122260223 192.0.2.1 50000 typ host', sdpMid: '0', sdpMLineIndex: 0 } };
  assert.equal(validSignal(ice), true, 'known connection metadata is permitted');
  assert.equal(validSignal({ v: 1, k: 'clock', t0: 1 }), true);
  const bad = [
    { k: 'op', ack: 1, id: 'synthetic-op', c: 'synthetic-ciphertext' },
    { k: 'ckpt', ack: 1, id: 'synthetic-checkpoint', c: 'synthetic-ciphertext' },
    { v: 1, k: 'binary', to, data: 'synthetic-business' },
    { ...ice, business: { stock: 7 } },
    { ...ice, data: { ...ice.data, candidate: 'candidate: synthetic business amount 100' } },
    { v: 1, k: 'offer', to, data: { type: 'offer', sdp: 'v=0\na=msid-semantic: WMS {"business":"synthetic"}' } },
    { ...ice, data: { ...ice.data, candidate: 'candidate:1 1 UDP 2122260223 192.0.2.1 50000 typ relay' } },
  ];
  for (const frame of [...bad.map(value => JSON.stringify(value)), new Uint8Array([1, 2])]) {
    const forwarded = [], closed = [];
    const source = { readyState: 1, close: (...args) => closed.push(args) };
    const target = { readyState: 1, deserializeAttachment: () => ({ peer: to }), send: value => forwarded.push(value) };
    const room = new SignalRoom({ getWebSockets: () => [source, target], get storage() { throw Error('signal boundary must not use business storage'); } });
    room.webSocketMessage(source, frame);
    assert.equal(closed[0]?.[0], 1008, 'reject invalid/business frame at the actual server boundary');
    assert.deepEqual(forwarded, [], 'no rejected business bytes reach another socket');
  }
});

// ---------- Parte 2: navegador real ----------
let server, base, web;
before(async () => { ({ srv: server, base } = await startServer()); web = await chromium.launch(); });
after(async () => { await web.close(); await new Promise(r => server.close(r)); });

const api = (page, url, method = 'GET', body) => page.evaluate(async ([u, m, b]) => {
  const r = await fetch(u, { method: m, body: b === undefined ? undefined : JSON.stringify(b) }); return r.json();
}, [url, method, body]);

test('navegador: acciones de negocio solo permiten WS /signal, nunca /sala ni Supabase', async () => {
  const porAccion = {}; let accion = 'carga';
  const mirar = (tipo, url) => {
    if (!url || url.startsWith('data:') || url.startsWith('blob:') || url.startsWith(base)) return;
    // Preserve the full path/query: a hostname alone cannot distinguish metadata from business relay routes.
    let destino; try { destino = new URL(url).href; } catch (_) { destino = url; }
    (porAccion[accion] ||= new Set()).add(tipo + ' ' + destino);
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

  // These are attempted endpoints: the stub aborts sockets before messages exist.
  // Actual SDP/ICE-only traffic and durable RTC delivery are checked by peer-sync-browser.test.js.
  const tabla = Object.fromEntries(Object.entries(porAccion).map(([k, v2]) => [k, [...v2].sort()]));
  console.log('DESTINOS POR ACCION ' + JSON.stringify(tabla, null, 1));
  const todo = Object.values(tabla).flat();
  // Permit the exact metadata route, not every WebSocket on the sync hostname.
  for (const s of todo) {
    const split = s.indexOf(' '), tipo = s.slice(0, split), u = new URL(s.slice(split + 1));
    assert.ok(!/(^|\.)supabase\.co$/i.test(u.hostname) && !/f123_relay_command/.test(u.pathname), 'negocio central Supabase contactado: ' + s);
    if (u.hostname === 'friendly123-sync-relay.jfcarpio.workers.dev') {
      assert.equal(tipo, 'WS', 'sync coordinator must not accept HTTP business traffic');
      assert.equal(u.protocol, 'wss:');
      assert.match(u.pathname, /^\/signal\/[a-f0-9]{40}$/);
      assert.deepEqual([...u.searchParams.keys()], ['peer']);
      assert.match(u.searchParams.get('peer'), /^[a-f0-9]{32}$/);
      assert.equal(u.hash, '');
    } else {
      assert.notEqual(tipo, 'WS', 'unexpected external socket: ' + s);
      if (/\.workers\.dev$/i.test(u.hostname)) assert.equal(u.hostname, 'friendly123-licencias.jfcarpio.workers.dev');
    }
  }
  assert.deepEqual(errores.filter(e => /Cloudflare data connection/.test(e)), []);
});
