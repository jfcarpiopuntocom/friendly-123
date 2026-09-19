const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '../docs/index.html'), 'utf8');
const block = html.slice(html.indexOf('// --- Nombre editable del negocio'), html.indexOf('// --- Navegación ---'));

test('header uses the active notebook name even if an older instance request resolves empty', async () => {
  let resolveFetch;
  const span = { textContent: 'My store or shelf(s)' };
  const btn = { style: {}, addEventListener() {} };
  const events = new Map();
  const elements = { 'oc-negocio-nombre': span, 'oc-negocio-editar': btn };
  const storage = new Map([['f123_owned', JSON.stringify({ nombreNegocio: '17 de septiembre' })]]);
  const context = {
    window: { OCTienda: { nombreActivo: () => '17 de septiembre' },
      addEventListener(type, handler) { events.set(type, handler); } },
    document: { getElementById: id => elements[id] || null },
    localStorage: { getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value) },
    sessionStorage: { getItem: () => null }, API: '/api',
    fetch: () => new Promise(resolve => { resolveFetch = resolve; }),
  };
  vm.createContext(context);
  vm.runInContext(block, context);
  assert.equal(span.textContent, '17 de septiembre');
  resolveFetch({ json: async () => ({ nombreNegocio: '' }) });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(span.textContent, '17 de septiembre');
  assert.equal(JSON.parse(storage.get('f123_owned')).nombreNegocio, '17 de septiembre');
  assert.ok(events.has('oc-negocio-actualizado'));
});

test('empty startup state keeps the last known name of the owned notebook', async () => {
  const span = { textContent: 'My store or shelf(s)' };
  const btn = { style: {}, addEventListener() {} };
  const storage = new Map([['f123_owned', JSON.stringify({ nombreNegocio: 'Known fixture store' })]]);
  const context = { window: { OCTienda: { nombreActivo: () => '', esUnida: () => false }, addEventListener() {} },
    document: { getElementById: id => ({ 'oc-negocio-nombre': span, 'oc-negocio-editar': btn })[id] || null },
    localStorage: { getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value) },
    sessionStorage: { getItem: () => null }, API: '/api',
    fetch: async () => ({ json: async () => ({ nombreNegocio: '' }) }) };
  vm.createContext(context);
  vm.runInContext(block, context);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(span.textContent, 'Known fixture store');
  assert.equal(JSON.parse(storage.get('f123_owned')).nombreNegocio, 'Known fixture store');
});

test('joined notebook paints the name returned by its active namespace without refresh', async () => {
  const span = { textContent: 'My store or shelf(s)' };
  const btn = { style: {}, addEventListener() {} };
  const events = new Map();
  const context = {
    window: { OCTienda: { nombreActivo: () => '', esUnida: () => true },
      addEventListener(type, handler) { events.set(type, handler); } },
    document: { getElementById: id => ({ 'oc-negocio-nombre': span, 'oc-negocio-editar': btn })[id] || null },
    localStorage: { getItem: () => null, setItem() {} }, sessionStorage: { getItem: () => null }, API: '/api',
    fetch: async () => ({ json: async () => ({ nombreNegocio: 'Joined fixture store' }) })
  };
  vm.createContext(context);
  vm.runInContext(block, context);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(span.textContent, 'Joined fixture store');
  events.get('oc-negocio-actualizado')({ detail: { nombre: 'Instant rename' } });
  assert.equal(span.textContent, 'Instant rename');
});
