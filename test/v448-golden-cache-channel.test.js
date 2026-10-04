const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const index = fs.readFileSync(path.join(__dirname, '../docs/index.html'), 'utf8');
const sw = fs.readFileSync(path.join(__dirname, '../docs/sw.js'), 'utf8');
const version = JSON.parse(fs.readFileSync(path.join(__dirname, '../docs/version.json'), 'utf8'));

function helperFor(pathname) {
  const a = index.indexOf('function _shellPublicoCache(nombres)');
  const b = index.indexOf('(function verificarCompatibilidadVersion()', a);
  assert.ok(a >= 0 && b > a, 'helper de cache/version existe antes de los verificadores');
  const src = index.slice(a, b);
  const context = { location: { pathname } };
  vm.createContext(context);
  vm.runInContext(src, context);
  return context._shellPublicoCache;
}

test('v448 GOLDEN keeps one public shell while hotfix cache uses a private generation', () => {
  assert.equal(version.shell, 'f123-shell-v448');
  assert.equal(version.releaseName, 'v448 GOLDEN');
  assert.match(sw, /const CACHE = "f123-shell-v448"/);
  assert.match(sw, /const CACHE_GENERACION = "-golden2"/);
  assert.match(sw, /const CACHE_LOCAL = CACHE \+ CACHE_GENERACION \+ CANAL/);
});

test('stable ignores next/previo caches and strips golden generation before comparing version', () => {
  const publicShell = helperFor('/friendly-123/');
  const caches = [
    'f123-shell-v447',
    'f123-shell-v448-golden2-next',
    'f123-shell-v448-golden2-previo',
    'f123-shell-v448-golden2'
  ];
  assert.equal(publicShell(caches), 'f123-shell-v448');
});

test('next selects only its own cache and normalizes generation + channel', () => {
  const publicShell = helperFor('/friendly-123/next/');
  const caches = [
    'f123-shell-v448-golden2',
    'f123-shell-v448-golden2-previo',
    'f123-shell-v448-golden2-next'
  ];
  assert.equal(publicShell(caches), 'f123-shell-v448');
});

test('previo selects only its own cache and normalizes generation + channel', () => {
  const publicShell = helperFor('/friendly-123/previo/');
  const caches = [
    'f123-shell-v448-golden2-next',
    'f123-shell-v448-golden2',
    'f123-shell-v448-golden2-previo'
  ];
  assert.equal(publicShell(caches), 'f123-shell-v448');
});

test('a genuinely old cache remains old after normalization', () => {
  const publicShell = helperFor('/friendly-123/next/');
  assert.equal(publicShell(['f123-shell-v447-golden9-next']), 'f123-shell-v447');
  assert.notEqual(publicShell(['f123-shell-v447-golden9-next']), version.shell);
});

test('both version guards use normalized current-channel cache, never raw CacheStorage ordering', () => {
  const calls = index.match(/const activa = _shellPublicoCache\(nombres\);/g) || [];
  assert.equal(calls.length, 2, 'compatibilidad y piso autoritativo usan la misma normalizacion');
  assert.doesNotMatch(
    index.slice(index.indexOf('function _shellPublicoCache(nombres)')),
    /const activa = \(nombres\.filter\(function \(n\) \{ return n\.indexOf\("f123-shell-"\) === 0; \}\)\.pop\(\) \|\| ""\);/
  );
});
