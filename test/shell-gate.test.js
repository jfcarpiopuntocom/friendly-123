const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '../docs/auth-ui.js'), 'utf8');
const render = src.slice(src.indexOf('  function pintarBuildGate()'), src.indexOf('  pintarBuildGate();'));

test('PIN gate reports the controlling service worker when a newer cache also exists', async () => {
  const label = { textContent: '', style: { setProperty() {} } };
  const listeners = new Map();
  let asked = false;
  const controller = { postMessage(message) {
    asked = message.tipo === 'que-shell';
    for (const listener of listeners.get('message') || []) listener({ data: { tipo: 'shell-actual', shell: 'f123-shell-v306' } });
  } };
  const serviceWorker = {
    controller,
    addEventListener(type, listener) { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(listener); },
    removeEventListener(type, listener) { listeners.get(type)?.delete(listener); }
  };
  const context = { window: {}, navigator: { serviceWorker },
    document: { getElementById: () => label },
    fetch: async () => ({ ok: true, json: async () => ({ version: '1.0', shell: 'f123-shell-v307' }) }),
    caches: { keys: async () => ['f123-shell-v306', 'f123-shell-v307'] },
    setTimeout: () => 1, clearTimeout() {}, Date };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(render + '\npintarBuildGate();', context);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(asked, true);
  assert.match(label.textContent, /shell-v306/);
  assert.match(label.textContent, /versión vieja/);
});


test('PIN gate detects stale golden generation even when public shell stays v448', async () => {
  const label = { textContent: '', style: { opacity:'', color:'', setProperty() {} } };
  const listeners = new Map();
  const controller = { postMessage(message) {
    if (message.tipo !== 'que-shell') return;
    for (const listener of listeners.get('message') || []) listener({
      data: { tipo: 'shell-actual', shell: 'f123-shell-v448', cacheGeneration: 'golden1' }
    });
  } };
  const serviceWorker = {
    controller,
    addEventListener(type, listener) { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(listener); },
    removeEventListener(type, listener) { listeners.get(type)?.delete(listener); }
  };
  const context = { window: {}, navigator: { serviceWorker },
    document: { getElementById: () => label },
    fetch: async () => ({ ok: true, json: async () => ({
      version: '1.0', shell: 'f123-shell-v448', releaseName: 'v448 GOLDEN',
      cacheGeneration: 'golden2'
    }) }),
    caches: { keys: async () => ['f123-shell-v448-golden1', 'f123-shell-v448-golden2'] },
    setTimeout: () => 1, clearTimeout() {}, Date };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(render + '\npintarBuildGate();', context);
  await new Promise(resolve => setImmediate(resolve));
  assert.match(label.textContent, /golden1/);
  assert.match(label.textContent, /versión vieja/);
  assert.match(label.textContent, /v448 GOLDEN/);
  assert.match(label.textContent, /golden2/);
});

test('PIN gate shows v448 GOLDEN when shell and generation both match', async () => {
  const label = { textContent: '', style: { setProperty() {} } };
  const listeners = new Map();
  const controller = { postMessage(message) {
    if (message.tipo !== 'que-shell') return;
    for (const listener of listeners.get('message') || []) listener({
      data: { tipo: 'shell-actual', shell: 'f123-shell-v448', cacheGeneration: 'golden2' }
    });
  } };
  const serviceWorker = {
    controller,
    addEventListener(type, listener) { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(listener); },
    removeEventListener(type, listener) { listeners.get(type)?.delete(listener); }
  };
  const context = { window: {}, navigator: { serviceWorker },
    document: { getElementById: () => label },
    fetch: async () => ({ ok: true, json: async () => ({
      version: '1.0', shell: 'f123-shell-v448', releaseName: 'v448 GOLDEN',
      cacheGeneration: 'golden2'
    }) }),
    caches: { keys: async () => [] },
    setTimeout: () => 1, clearTimeout() {}, Date };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(render + '\npintarBuildGate();', context);
  await new Promise(resolve => setImmediate(resolve));
  assert.match(label.textContent, /v448 GOLDEN/);
  assert.match(label.textContent, /build golden2/);
  assert.doesNotMatch(label.textContent, /versión vieja/);
});
