'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const DOCS = path.join(__dirname, '../docs');
const read = name => fs.readFileSync(path.join(DOCS, name), 'utf8');
const data = name => JSON.parse(read(name));
const base = 'https://jfcarpiopuntocom.github.io/friendly-123/';
const identity = (m) => new URL(m.id || new URL(m.start_url, base).href, new URL(base).origin).href;

test('PWA principal conserva id historico implicito y no crea otra identidad', () => {
  const m = data('manifest.json');
  assert.equal(m.start_url, './');
  assert.equal(identity(m), base);
  assert.equal(new URL(m.scope, base).href, base);
  assert.equal(m.display, 'standalone');
});

test('Dashboard tiene manifest y una identidad distinta de la app de ventas', () => {
  const m = data('dashboard-manifest.json');
  assert.equal(identity(m), base + 'dashboard.html');
  assert.equal(new URL(m.start_url, base).href, base + 'dashboard.html');
  assert.equal(new URL(m.scope, base).href, base);
  assert.equal(m.display, 'standalone');
  assert.notEqual(identity(m), identity(data('manifest.json')));
  assert.match(read('dashboard.html'), /rel="manifest" href="\.\/dashboard-manifest\.json"/);
});

test('rescate disponible junto a PIN y respaldo, sin permiso para borrar datos', () => {
  const rescue = read('pwa-rescue.html');
  const panel = read('panel.html');
  const app = read('avanzado-extra.js');
  const dash = read('dashboard.html');
  assert.match(rescue, /<title>[^<]*Rescate PWA/i);
  assert.match(rescue, /IndexedDB|IDB/);
  assert.match(rescue, /Export backup|Exportar respaldo/i);
  assert.match(rescue, /Eliminar app|Eliminar la app/i);
  assert.match(rescue, /iPhone/i);
  for (const [name, source] of [['panel', panel], ['app', app], ['dashboard', dash]]) {
    assert.match(source, /pwa-rescue\.html/, name + ' debe enlazar rescate');
  }
  for (const forbidden of ['.unregister(', 'caches.delete(', 'indexedDB.deleteDatabase(', 'localStorage.clear(', 'localStorage.removeItem(']) {
    assert.ok(!rescue.includes(forbidden), 'No destruir almacenamiento desde rescate: ' + forbidden);
  }
});

test('el rescate no comunica datos ni promete descubrir otras PWAs', () => {
  const rescue = read('pwa-rescue.html');
  assert.doesNotMatch(rescue, /fetch\s*\(\s*['"]https?:\/\//i);
  assert.doesNotMatch(rescue, /autodesinstalar|desinstalaci[oó]n autom[aá]tica/i);
  assert.match(rescue, /cada instalaci[oó]n|cada copia/i);
});
