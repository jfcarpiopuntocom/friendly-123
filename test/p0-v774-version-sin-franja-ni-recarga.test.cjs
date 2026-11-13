'use strict';
// v774 (JFC 13 nov 2026: «se reinicia la pantalla cuando aplasto en vender… la cosa es que no se rompa»; rule of 28 oct
// 2026: no modal, popup, banner or strip). A new version must show NO strip and must NOT reload the page: the old strip
// sat over the sale buttons and a tap on «Vender» hit «Recargar». The waiting service worker is told to take over, so the
// next normal opening loads the new shell. Runs the REAL docs/salud-app.js in a vm with a minimal DOM. No network.
const { test } = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const src = fs.readFileSync(path.join(__dirname, '../docs/salud-app.js'), 'utf8');

function dom() {
  const els = {};
  const mk = tag => ({ tag, style: { cssText: '' }, children: [], setAttribute() {}, addEventListener() {},
    set id(v) { this._id = v; els[v] = this; }, get id() { return this._id; }, set innerHTML(h) { this._html = h; } });
  const body = mk('body'); body.firstChild = null;
  body.insertBefore = n => body.children.unshift(n); body.appendChild = n => body.children.push(n);
  return { els, body, document: { readyState: 'complete', visibilityState: 'visible', body, documentElement: body, createElement: mk,
    getElementById: id => els[id] || null, querySelectorAll: () => [], addEventListener() {} } };
}

test('a new version shows no strip, never reloads, and tells the waiting service worker to take over', async () => {
  const d = dom(), avisos = [], mensajesSW = [];
  let recargas = 0, actualizaciones = 0;
  const reg = { waiting: { postMessage: m => mensajesSW.push(m) }, update: () => { actualizaciones++; return Promise.resolve(); } };
  const ctx = {
    console, Promise, JSON, Date, Math, String, Number, Array, Object,
    document: d.document,
    location: { pathname: '/app/', reload: () => { recargas++; } },
    caches: { keys: async () => [], delete: async () => true },
    navigator: { serviceWorker: {
      controller: { postMessage(msg, [port]) { port.postMessage({ shell: 'f123-shell-v000', cacheGeneration: '-golden1' }); } },
      getRegistration: async () => reg } },
    MessageChannel: class { constructor() { const a = { onmessage: null }, b = { postMessage: x => setImmediate(() => a.onmessage && a.onmessage({ data: x })) }; this.port1 = a; this.port2 = b; } },
    fetch: async () => ({ ok: true, json: async () => ({ shell: 'f123-shell-v774', cacheGeneration: 'golden310' }) }),
    setTimeout: (f, ms) => (ms >= 15000 ? (f(), 0) : setTimeout(f, ms)), requestIdleCallback: null, addEventListener() {},
    AMG: { Salud: { registrar: m => avisos.push(m) } }
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(src, ctx);
  for (let i = 0; i < 200 && !mensajesSW.length; i++) await new Promise(r => setTimeout(r, 10));
  // Positive control: the skip-waiting message is only sent when the mismatch was detected.
  assert.deepEqual(JSON.parse(JSON.stringify(mensajesSW)), [{ tipo: 'skip-waiting' }], 'the mismatch is detected and the waiting service worker is told to take over');
  assert.equal(actualizaciones, 1, 'one update check');
  assert.equal(d.els['oc-version-vieja'], undefined, 'no strip at all');
  assert.equal(d.body.children.length, 0, 'nothing added to the page');
  await new Promise(r => setTimeout(r, 50));
  assert.equal(recargas, 0, 'the page never reloads by itself');
});
