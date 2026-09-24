/* cargador.test.js — Bloque P fase A (JFC 2026-09-24).
   Prueba de FEATURE NUEVA (no de un bug): el cargador de codigo carga la lista
   en orden, usa el origen remoto solo cuando hay uno, y CAE A github.io si el
   remoto falla o tarda (falla abierta). Tambien fija el cableado de index.html:
   cargador.js en el SHELL, la lista en el SHELL, sin doble carga. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const DOCS = path.join(__dirname, '../docs');
const src = fs.readFileSync(path.join(DOCS, 'cargador.js'), 'utf8');

/* DOM minimo: cada <script> insertado "carga" o "falla" segun su src. */
function armar({ meta = '', canario = null, falla = () => false, cuelga = () => false } = {}) {
  const insertados = [];
  const head = { appendChild(s) { insertados.push(s); s.parentNode = head;
    if (cuelga(s.src)) return;
    setImmediate(() => { falla(s.src) ? s.onerror() : s.onload(); }); },
    removeChild(s) { s.parentNode = null; } };
  const store = new Map(); if (canario !== null) store.set('f123_origen_codigo', canario);
  const ctx = {
    document: { head, createElement: () => ({}), querySelector: (q) => q.includes('oc-origen-codigo') ? { getAttribute: () => meta } : null,
      dispatchEvent() {} },
    localStorage: { getItem: (k) => store.has(k) ? store.get(k) : null, setItem: (k, v) => store.set(k, v), removeItem: (k) => store.delete(k) },
    setTimeout, clearTimeout, setImmediate, Date, Promise, console: { info() {} }, CustomEvent: function () {}
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(src, ctx);
  return { ctx, insertados, store };
}
const LISTA = ['./a.js', './b.js', './c.js'];

test('sin origen: carga local, en orden, sin crossorigin', async () => {
  const { ctx, insertados } = armar();
  const e = await ctx.OCCargador.cargar(LISTA);
  assert.equal(e.modo, 'local');
  assert.deepEqual(insertados.map((s) => s.src), LISTA);
  assert.ok(insertados.every((s) => !s.crossOrigin && s.async === false));
  assert.equal(e.caidas, 0);
});

test('canario en localStorage: pide al remoto con CORS y normaliza la barra final', async () => {
  const { ctx, insertados } = armar({ canario: 'https://midominio.com/friendly-123/docs' });
  const e = await ctx.OCCargador.cargar(LISTA);
  assert.equal(e.origen, 'https://midominio.com/friendly-123/docs/');
  assert.deepEqual(insertados.map((s) => s.src), LISTA.map((f) => e.origen + f.slice(2)));
  assert.ok(insertados.every((s) => s.crossOrigin === 'anonymous'));
  assert.equal(e.cargados.filter((c) => c.desde === 'remoto').length, 3);
});

test('remoto falla en b.js: cae a github.io para ESE archivo y conserva el orden', async () => {
  const { ctx, insertados } = armar({ meta: 'https://midominio.com/docs/', falla: (s) => s.endsWith('docs/b.js') });
  const e = await ctx.OCCargador.cargar(LISTA);
  assert.equal(e.caidas, 1);
  assert.deepEqual(insertados.map((s) => s.src), ['https://midominio.com/docs/a.js', 'https://midominio.com/docs/b.js', './b.js', 'https://midominio.com/docs/c.js']);
  assert.deepEqual(Array.from(e.cargados, (c) => c.archivo + ':' + c.desde), ['./a.js:remoto', './b.js:local', './c.js:remoto']);
  assert.equal(insertados[1].parentNode, null, 'el script remoto fallido se quita del DOM');
});

test('remoto se cuelga: el timeout lo manda a github.io', async () => {
  const { ctx, insertados } = armar({ meta: 'https://midominio.com/docs/', cuelga: (s) => s.startsWith('https://') });
  const e = await ctx.OCCargador.cargar(['./a.js'], { timeoutMs: 20 });
  assert.equal(e.caidas, 1);
  assert.deepEqual(insertados.map((s) => s.src), ['https://midominio.com/docs/a.js', './a.js']);
});

test('canario "0" fuerza local aunque el meta traiga URL; http:// se rechaza', async () => {
  const { ctx } = armar({ meta: 'https://midominio.com/docs/', canario: '0' });
  const e = await ctx.OCCargador.cargar(LISTA);
  assert.equal(e.modo, 'local');
  assert.equal(ctx.OCCargador.normalizar('http://inseguro.com/docs/'), '');
  assert.equal(ctx.OCCargador.fijarCanario('ftp://x'), false);
  assert.equal(ctx.OCCargador.fijarCanario('https://midominio.com/docs'), true);
  assert.equal(ctx.OCCargador.origen(), 'https://midominio.com/docs/');
  ctx.OCCargador.quitarCanario();
  assert.equal(ctx.OCCargador.origen(), 'https://midominio.com/docs/', 'sin canario manda el meta');
});

test('texto() dice de donde vino el codigo y cuantos cayeron', async () => {
  const { ctx } = armar({ meta: 'https://midominio.com/docs/', falla: (s) => s.endsWith('docs/a.js') });
  await ctx.OCCargador.cargar(LISTA);
  const t = ctx.OCCargador.texto();
  assert.match(t, /remote https:\/\/midominio\.com\/docs\//);
  assert.match(t, /1 fell back to github\.io/);
});

test('cableado de index.html: meta vacio, lista en el SHELL, sin doble carga, fallback inline', () => {
  const html = fs.readFileSync(path.join(DOCS, 'index.html'), 'utf8');
  const sw = fs.readFileSync(path.join(DOCS, 'sw.js'), 'utf8');
  assert.match(html, /<meta name="oc-origen-codigo" content="">/, 'el meta va VACIO hasta orden de JFC');
  const linea = html.split('\n').find((l) => l.includes('OC-CARGADOR-LISTA'));
  const lista = [...linea.matchAll(/"(\.\/[^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(lista, ['./edutips.js', './workshop-brand.js', './inspector.js', './inspector-ui.js']);
  for (const f of ['./cargador.js', ...lista]) {
    assert.ok(sw.includes('"' + f + '"'), f + ' tiene que estar en el SHELL de sw.js');
    if (f !== './cargador.js') assert.ok(!new RegExp('<script[^>]+src="' + f.replace(/[./]/g, '\\$&') + '"').test(html), f + ' no puede ser tambien <script src>');
  }
  assert.ok(html.includes('<script src="./cargador.js"></script>'));
  assert.ok(html.includes("document.write('<script src=\"' + lista[i] + '\"><\\/script>')"), 'fallback inline si cargador.js no carga');
  const htaccess = fs.readFileSync(path.join(DOCS, '.htaccess'), 'utf8');
  assert.match(htaccess, /Access-Control-Allow-Origin "https:\/\/jfcarpiopuntocom\.github\.io"/);
});
