'use strict';
// C199: export local automatico al abrir (orden JFC 22 nov 2026). Ejecuta el
// docs/backup-scheduler.js REAL en un sandbox vm con DOM minimo.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { createHash, webcrypto } = require('crypto');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'docs', 'backup-scheduler.js'), 'utf8');

function cargar({ status = 200, demo = false } = {}) {
  const store = new Map();
  const listeners = {};
  const docListeners = [];
  const descargas = [];
  const blobs = new Map();
  let nBlob = 0;
  const localStorage = {
    getItem: k => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: k => store.delete(k),
  };
  const document = {
    hidden: false,
    body: { appendChild() {} },
    createElement() { return { click() { descargas.push({ nombre: this.download, texto: blobs.get(this.href) }); }, remove() {} }; },
    getElementById() { return null; },
    querySelector() { return null; },
    addEventListener(tipo, fn, opts) { docListeners.push({ tipo, fn, once: opts && opts.once }); },
  };
  const window = {
    OCAuth: { esDemo: () => demo, rolActual: () => 'dueno' },
    addEventListener(tipo, fn) { (listeners[tipo] = listeners[tipo] || []).push(fn); },
  };
  const ctx = {
    window, document, localStorage, console,
    crypto: webcrypto, TextEncoder,
    Blob: class { constructor(partes) { this.texto = partes.join(''); } },
    URL: { createObjectURL(b) { const u = 'blob:' + (++nBlob); blobs.set(u, b.texto); return u; }, revokeObjectURL() {} },
    setTimeout: fn => { ctx._timers.push(fn); return 0; }, clearTimeout() {},
    _timers: [],
    fetch: async () => ({ ok: status === 200, status, json: async () => ({ productos: [{ id: 'p1', nombre: 'A' }], ventas: [] }) }),
    navigator: {},
  };
  ctx.globalThis = ctx;
  window.window = window;
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx);
  return {
    store, descargas,
    login(detail) { (listeners['oc-login'] || []).forEach(fn => fn({ detail })); },
    async correrTimers() { const t = ctx._timers.splice(0); for (const fn of t) await fn(); await new Promise(r => setImmediate(r)); },
    tocar() {
      const hs = docListeners.filter(l => l.tipo === 'pointerdown');
      hs.forEach(l => { l.fn(); if (l.once) docListeners.splice(docListeners.indexOf(l), 1); });
    },
  };
}

test('login real + primer toque descarga un export local sellado con SHA-256 en el nombre', async () => {
  const app = cargar();
  app.login({ rol: 'dueno' });
  await app.correrTimers();
  app.tocar();
  assert.equal(app.descargas.length, 1);
  const { nombre, texto } = app.descargas[0];
  const sha = createHash('sha256').update(texto).digest('hex');
  assert.match(nombre, /^backup-friendly-123-.+-sha256-[0-9a-f]{16}\.json$/);
  assert.equal(nombre.slice(-21, -5), sha.slice(0, 16));
  const paquete = JSON.parse(texto);
  assert.equal(paquete.app, 'friendly-123');
  assert.equal(paquete.schemaVersion, 2);
  assert.deepEqual(paquete.datos.productos[0].id, 'p1');
  assert.ok([...app.store.keys()].includes('f123_autoexport_dia_v1'));
});

test('una sola vez al dia: segundo login el mismo dia no descarga otra vez', async () => {
  const app = cargar();
  app.login({ rol: 'dueno' }); await app.correrTimers(); app.tocar();
  app.login({ rol: 'dueno' }); await app.correrTimers(); app.tocar();
  assert.equal(app.descargas.length, 1);
});

test('demo nunca exporta', async () => {
  const app = cargar({ demo: true });
  app.login({ rol: 'dueno', demo: true }); await app.correrTimers(); app.tocar();
  assert.equal(app.descargas.length, 0);
});

test('si la lectura falla (403) no descarga ni marca el dia', async () => {
  const app = cargar({ status: 403 });
  app.login({ rol: 'dueno' }); await app.correrTimers(); app.tocar();
  assert.equal(app.descargas.length, 0);
  assert.equal(app.store.has('f123_autoexport_dia_v1'), false);
});
