/* v449 regression — backups must preserve BOTH photo stores:
   shelf-id mirrors and content-addressed hash blobs. No orphan hash is ever
   assigned to a shelf during export/import; it is preserved only as evidence. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require('playwright');

function ventanaConFotos() {
  const entries = new Map();
  const w = {
    localStorage: {
      get length() { return entries.size; },
      key: i => [...entries.keys()][i],
      getItem: k => entries.get(k) ?? null,
      setItem: (k, v) => entries.set(k, String(v)),
      removeItem: k => entries.delete(k),
    },
    console: { warn() {}, error() {}, log() {} },
    crypto: globalThis.crypto,
    TextEncoder, atob, btoa,
  };
  w.window = w; w.globalThis = w; w.self = w;
  vm.createContext(w);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'docs', 'idb-fotos.js'), 'utf8'), w);
  return w;
}

test('v449: content-addressed photo blobs can be exported without inventing shelf associations', async () => {
  const w = ventanaConFotos();
  const foto = 'data:image/png;base64,T1JQSEFOLUhBU0gtRVZJREVOQ0U=';
  await w.OCFotos.guardarPorHash('hash-orphan-evidence', foto);
  assert.equal(typeof w.OCFotos.leerTodosPorHash, 'function',
    'backup needs a read-only way to enumerate hash->bytes evidence');
  const todos = await w.OCFotos.leerTodosPorHash();
  assert.equal(todos['hash-orphan-evidence'], foto);
  assert.equal(Object.keys(await w.OCFotos.leerTodas()).length, 0,
    'preserving an orphan blob must not fabricate a shelf-id mapping');
});

test('v449: primary Export backup carries and restores IndexedDB shelf photos AND hash blobs', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'docs', 'avanzado-extra.js'), 'utf8');
  const exp0 = src.indexOf('$("oc-exportar").addEventListener');
  const imp0 = src.indexOf('$("oc-importar-file").addEventListener');
  assert.ok(exp0 >= 0 && imp0 > exp0, 'primary backup handlers must exist');
  const primaryExport = src.slice(exp0, imp0);
  const primaryImport = src.slice(imp0, src.indexOf('// ==========================================================================', imp0));
  assert.match(primaryExport, /fotosIDB|exportarRespaldoFotos/,
    'primary backup must include per-shelf IndexedDB photos');
  assert.match(primaryExport, /fotosBlobs|exportarRespaldoFotos/,
    'primary backup must include content-addressed photo blobs');
  assert.match(primaryImport, /guardarFoto|importarRespaldoFotos/,
    'primary import must restore per-shelf photo bytes');
  assert.match(primaryImport, /guardarPorHash|importarRespaldoFotos/,
    'primary import must restore hash blobs without assigning them to shelves');
});

test('v449: WhatsApp copy preserves content-addressed hash evidence as well as id photos', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'docs', 'avanzado-extra.js'), 'utf8');
  const exp0 = src.indexOf('var _bx = document.getElementById("btnExportarCopia")');
  const end = src.indexOf('/* GATE DE SYNC PODADO', exp0);
  assert.ok(exp0 >= 0 && end > exp0, 'Forma B export/import block must exist');
  const block = src.slice(exp0, end);
  assert.match(block, /fotosIDB/, 'Forma B must preserve shelf-id photo mirrors');
  assert.match(block, /fotosBlobs|exportarRespaldoFotos/,
    'Forma B must also preserve hash-addressed photo evidence');
  assert.match(block, /guardarPorHash|importarRespaldoFotos/,
    'Forma B import must restore hash blobs without guessing a shelf mapping');
});

test('v449: scheduled sovereign backup includes both durable photo stores', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'docs', 'backup-scheduler.js'), 'utf8');
  const a = src.indexOf('async function construirArchivoRespaldo');
  const b = src.indexOf('// Downloads the file', a);
  assert.ok(a >= 0 && b > a, 'scheduled backup builder must exist');
  const block = src.slice(a, b);
  assert.match(block, /fotosIDB|exportarRespaldoFotos/,
    'scheduled backup must not omit per-shelf IndexedDB photos');
  assert.match(block, /fotosBlobs|exportarRespaldoFotos/,
    'scheduled backup must preserve content-addressed hash evidence');
});


test('v449: real Chromium IndexedDB exports shelf-id photos and hash blobs separately', async () => {
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<!doctype html><html><body>idb fixture</body></html>');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.goto('http://127.0.0.1:' + port + '/');
    await page.addScriptTag({ path: path.resolve(__dirname, '../docs/idb-fotos.js') });
    const out = await page.evaluate(async () => {
      const byId = 'data:image/png;base64,SUQtU1RPUkU=';
      const byHash = 'data:image/png;base64,SEFTSC1TVE9SRQ==';
      const okId = await window.OCFotos.guardarFoto('shelf-idb-fixture', byId);
      const okHash = await window.OCFotos.guardarPorHash('hash-idb-fixture', byHash);
      return {
        soportado: window.OCFotos.soportado(),
        okId, okHash,
        ids: await window.OCFotos.leerTodas(),
        blobs: await window.OCFotos.leerTodosPorHash()
      };
    });
    assert.equal(out.soportado, true);
    assert.equal(out.okId, true);
    assert.equal(out.okHash, true);
    assert.equal(out.ids['shelf-idb-fixture'], 'data:image/png;base64,SUQtU1RPUkU=');
    assert.equal(out.blobs['hash-idb-fixture'], 'data:image/png;base64,SEFTSC1TVE9SRQ==');
    assert.equal(out.ids['hash-idb-fixture'], undefined,
      'hash evidence must stay unassigned unless a shelf id is independently known');
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
});
