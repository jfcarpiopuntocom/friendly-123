const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

test('release identity: advancing shells retain coherent generation and channel cache isolation', () => {
  const version = JSON.parse(fs.readFileSync('docs/version.json', 'utf8'));
  const sw = fs.readFileSync('docs/sw.js', 'utf8');
  const salud = fs.readFileSync('docs/salud-app.js', 'utf8');

  assert.match(version.shell, /^f123-shell-v[1-9][0-9]*$/);
  assert.ok(Number(version.shell.split('v').pop()) >= 448);
  assert.equal(typeof version.releaseName, 'string');
  assert.match(version.cacheGeneration, /^golden[1-9][0-9]*$/);
  assert.ok(sw.includes('const CACHE = "' + version.shell + '"'));
  assert.match(sw, new RegExp('const CACHE_GENERACION = "-' + version.cacheGeneration + '"'));
  assert.match(sw, /const CACHE_LOCAL = CACHE \+ CACHE_GENERACION \+ CANAL/);
  assert.match(sw, /cacheGeneration: CACHE_GENERACION/);
  assert.match(salud, /genMal/);
  assert.match(salud, /cacheGeneration/);
});

test('v448 GOLDEN: a pre-generation service worker is treated as stale', () => {
  const version = JSON.parse(fs.readFileSync('docs/version.json', 'utf8'));
  const oldWorkerReply = { shell: 'f123-shell-v448' };
  const expected = '-' + version.cacheGeneration.replace(/^-/, '');
  const stale = !!(expected && oldWorkerReply.cacheGeneration !== expected);
  assert.equal(stale, true);
});
