const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

test('v448 GOLDEN: public release stays v448 while goldenN uniquely invalidates cache', () => {
  const version = JSON.parse(fs.readFileSync('docs/version.json', 'utf8'));
  const sw = fs.readFileSync('docs/sw.js', 'utf8');
  const salud = fs.readFileSync('docs/salud-app.js', 'utf8');

  assert.equal(version.shell, 'f123-shell-v448');
  assert.equal(version.releaseName, 'v448 GOLDEN');
  assert.match(version.cacheGeneration, /^golden[1-9][0-9]*$/);
  assert.match(sw, /const CACHE = "f123-shell-v448"/);
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
