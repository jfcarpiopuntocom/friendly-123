'use strict';
// v773 (JFC 13 nov 2026: «se reinicia la pantalla cuando aplasto en vender»): the "newer version" notice must never sit
// over the app's buttons. It was position:fixed at the bottom, over the sale buttons, so a tap on «Vender» hit «Recargar».
// Runs the REAL ofrecerRecarga path of docs/salud-app.js in a vm with a minimal DOM. No network.
const { test } = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const src = fs.readFileSync(path.join(__dirname, '../docs/salud-app.js'), 'utf8');

function dom() {
  const els = {};
  const mk = tag => ({ tag, style: { cssText: '' }, children: [], attrs: {}, setAttribute(k, v) { this.attrs[k] = v; },
    addEventListener() {}, set id(v) { this._id = v; els[v] = this; }, get id() { return this._id; },
    set innerHTML(h) { this._html = h; const m = /id="([^"]+)"/g; let x; while ((x = m.exec(h))) els[x[1]] = mk('button'); }, get innerHTML() { return this._html; } });
  const body = mk('body'); body.firstChild = { marker: 'primer-hijo' };
  body.insertBefore = (n, ref) => { body.children.unshift(n); n._antes = ref; };
  body.appendChild = n => { body.children.push(n); };
  return { els, body, document: { readyState: 'complete', body, documentElement: body, createElement: mk, getElementById: id => els[id] || null, addEventListener() {} } };
}

test('the new-version notice goes in the page flow at the top, never fixed over the sale buttons', async () => {
  const d = dom();
  let ofrecer = null;
  const ctx = {
    console, Promise, JSON, Date, Math, String, Number, Array, Object,
    document: d.document, location: { pathname: '/app/' },
    navigator: { serviceWorker: { controller: { postMessage(msg, [port]) { port.postMessage({ shell: 'f123-shell-v000', cacheGeneration: '-golden1' }); } } } },
    MessageChannel: class { constructor() { const a = { onmessage: null }, b = { postMessage: x => setImmediate(() => a.onmessage && a.onmessage({ data: x })) }; this.port1 = a; this.port2 = b; } },
    fetch: async () => ({ ok: true, json: async () => ({ shell: 'f123-shell-v773', cacheGeneration: 'golden309' }) }),
    setTimeout: (f, ms) => (ms >= 15000 ? (f(), 0) : 0), requestIdleCallback: null, addEventListener() {}
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(src, ctx);
  for (let i = 0; i < 200 && !d.els['oc-version-vieja']; i++) await new Promise(r => setTimeout(r, 10));
  const aviso = d.els['oc-version-vieja'];
  assert.ok(aviso, 'the mismatch shows the notice (positive control)');
  assert.doesNotMatch(aviso.style.cssText, /position:\s*fixed/, 'not fixed');
  assert.doesNotMatch(aviso.style.cssText, /bottom:\s*0/, 'not at the bottom');
  assert.equal(d.body.children[0], aviso, 'inserted at the top of the page');
  assert.equal(aviso._antes && aviso._antes.marker, 'primer-hijo', 'before the first element, pushing content down');
});
