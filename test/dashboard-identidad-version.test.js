// JFC 2026-10-14: "acabo de entrar al dashboard y dice v498 arriba". La etiqueta era texto
// fijo y la meta dashboard-shell se quedo en v502 mientras version.json iba en v507: el
// actualizador del tablero nunca recargaba y bajaba dashboard.html cada 15 s para nada.
// Regla JFC 24/oct: release publico, shell y Dashboard llevan el MISMO numero.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const docs = (f) => fs.readFileSync(path.join(__dirname, '../docs', f), 'utf8');

test('meta dashboard-shell = shell de version.json', () => {
  const shell = JSON.parse(docs('version.json')).shell;
  const meta = (docs('dashboard.html').match(/<meta\s+name="dashboard-shell"\s+content="([^"]+)"/) || [])[1];
  assert.equal(meta, shell);
});

test('Dashboard visible, shell y releaseName conservan una sola version', () => {
  const version = JSON.parse(docs('version.json'));
  const publicMeta = (docs('dashboard.html').match(/<meta\s+name="dashboard-release"\s+content="([^"]+)"/) || [])[1];
  assert.equal(publicMeta, version.releaseName);
  assert.equal(version.releaseName, 'v' + version.shell.match(/-v(\d+)$/)[1]);
  const staticLabel = (docs('dashboard.html').match(/<span\s+id="dashboard-version"[^>]*>([^<]+)<\/span>/) || [])[1];
  assert.equal(staticLabel, 'Dashboard ' + version.releaseName);
  const label = { textContent: 'Dashboard v498' };
  const c = { document: { querySelector: (s) => s.includes('dashboard-release') ? { content: publicMeta } : s.includes('dashboard-shell') ? { content: 'f123-shell-v999' } : null, getElementById: (id) => id === 'dashboard-version' ? label : null }, navigator: {}, window: {} };
  vm.createContext(c);
  vm.runInContext(docs('dashboard-updates.js'), c);
  assert.equal(label.textContent, 'Dashboard ' + version.releaseName);
  assert.doesNotMatch(label.textContent, /v999/);
});
