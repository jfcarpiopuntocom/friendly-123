const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { browser } = require('./helpers/browser.cjs');
const auth = fs.readFileSync(path.join(__dirname, '../docs/auth-ui.js'), 'utf8');
// Execute the shipped renderer, isolating it from PIN entry and unrelated UI setup.
const renderer = auth.slice(auth.indexOf('  function pintarNegocioGate()'), auth.indexOf('  function pintarBuildGate()'));

test('PIN gate reads the active store name when the activation cache is older', async () => {
  const w = browser();
  await w.request('/api/instancia/nombre', 'POST', { nombre: 'Current fixture name' });
  w.localStorage.setItem('f123_owned', JSON.stringify({ nombreNegocio: 'Old fixture name' }));
  const element = { innerHTML: '', style: {} };
  w.document.getElementById = () => element;
  w.t = (key, fallback) => fallback || key;
  w.dispositivoApropiado = () => true;
  vm.runInContext(renderer + '\npintarNegocioGate();', w);
  assert.ok(element.innerHTML.includes('Current fixture name'));
  assert.ok(!element.innerHTML.includes('Old fixture name'));
});

test('renaming a business immediately notifies the PIN gate and sync publisher', async () => {
  const w = browser();
  const events = [];
  for (const name of ['oc-negocio-actualizado', 'oc-catalogo-cambiado']) w.addEventListener(name, () => events.push(name));
  await w.request('/api/instancia/nombre', 'POST', { nombre: 'Updated fixture' });
  assert.ok(events.includes('oc-negocio-actualizado'));
  assert.ok(events.includes('oc-catalogo-cambiado'));
});
