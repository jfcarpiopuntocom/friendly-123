const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '../docs');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const start = html.indexOf('async function cargarHoy()');
const end = html.indexOf('if (!window.__relojInterval)', start);
assert(start >= 0 && end > start);
test('Start notices remain complete and count severity without forcing a closed panel open', async () => {
  assert.match(html, /<details id="ocAvisosHoy" class="avisos-hoy">/);
  for (const color of ['rojo', 'amarillo', 'verde']) {
    const elements = new Map();
    const get = id => { if (!elements.has(id)) elements.set(id, { style: {}, setAttribute() {}, innerHTML: '', textContent: '' }); return elements.get(id); };
    const alertas = [{ estado: color, mensaje: 'Synthetic visible notice' }, { estado: 'rojo', mensaje: 'Synthetic restock notice', reposicionPlegable: true }];
    const data = { semaforoGeneral: color, resumenDia: { ventasCount: 0 }, alertas };
    const ctx = { API: '/api', ubicacionActual: 1, t: k => k, tf: k => k, fmtMoney: String, fmtMoneyPend: String, escHtml: String, actualizarReloj() {}, document: { getElementById: get, querySelectorAll: () => [] }, window: { OCAuth: { puedeGestionar: () => false } }, fetch: async url => ({ ok: true, json: async () => url.includes('/dashboard') ? data : [] }) };
    await vm.runInNewContext('(' + html.slice(start, end) + ')()', ctx);
    assert.match(get('ocAvisosHoyTitulo').textContent, /\(1\)$/);
    assert.equal(get('ocAvisosHoy').style.borderLeftColor, 'var(--sim-' + color + ')');
    assert.match(get('listaAlertas').innerHTML, /Synthetic visible notice/);
    assert.match(get('listaReposicionHoy').innerHTML, /Synthetic restock notice/);
    assert.equal(get('ocAvisosHoy').open, undefined);
  }
  for (const f of ['i18n.js', 'simon-config.js']) assert.doesNotMatch(fs.readFileSync(path.join(root, f), 'utf8'), /pull it/i);
});
