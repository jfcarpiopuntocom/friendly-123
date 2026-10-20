const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');
const { webcrypto } = require('node:crypto');
const { setTimeout: delay } = require('node:timers/promises');
const { browser } = require('./helpers/browser.cjs');

const source = fs.readFileSync(path.join(__dirname, '../docs/sync-yjs.js'), 'utf8');
const bundle = fs.readFileSync(path.join(__dirname, '../docs/vendor/yjs-bundle.min.js'), 'utf8');
const PRE_FIX_BASELINE = '94877828be4da2541f25a142e26ad181e4b3d332';

test('first same-store join starts Yjs once when its license becomes available', async () => {
  const w = browser();
  delete w.JSON;
  let connections = 0;
  Object.assign(w, {
    crypto: webcrypto, TextEncoder, TextDecoder,
    F123Relay: { connect() { connections++; throw Error('fixture offline'); } },
  });
  vm.runInContext(bundle, w);
  w.IndexeddbPersistence = class { once() {} };
  vm.runInContext(source, w);
  w.dispatchEvent(new w.CustomEvent('DOMContentLoaded'));
  // A same-store join may finish while the initial no-license startup is still unwinding.
  w.localStorage.setItem('f123_owned', JSON.stringify({ licenseCode: 'F123-SYNTHETIC-OWNER' }));
  w.dispatchEvent(new w.CustomEvent('oc-licencia-disponible'));
  for (let i = 0; i < 100 && w.OCYjs.estado !== 'activo'; i++) await delay(10);
  assert.equal(w.OCYjs.estado, 'activo');
  const startedConnections = connections;
  assert.equal(startedConnections, 3, 'catalog, photos, and ops each connect once');

  w.dispatchEvent(new w.CustomEvent('oc-licencia-disponible'));
  await delay(20);
  assert.equal(connections, startedConnections, 'a repeated license event must not initialize duplicate channels');
});

test('a failed Yjs bundle load leaves startup retryable on the next license event', async () => {
  const w = browser();
  let bundleAttempts = 0;
  w.document.head = { appendChild(script) { bundleAttempts++; script.onerror(); } };
  vm.runInContext(source, w);
  w.dispatchEvent(new w.CustomEvent('DOMContentLoaded'));
  await delay(0);
  w.localStorage.setItem('f123_owned', JSON.stringify({ licenseCode: 'F123-SYNTHETIC-OWNER' }));
  w.dispatchEvent(new w.CustomEvent('oc-licencia-disponible'));
  await delay(20);
  assert.equal(w.OCYjs.estado, 'apagado');
  w.dispatchEvent(new w.CustomEvent('oc-licencia-disponible'));
  await delay(20);
  assert.equal(bundleAttempts, 2, 'a transient bundle failure must not latch the init guard');
  assert.equal(w.OCYjs.estado, 'apagado');
});

test('the Lord stable-entry guard no longer redirects, while historical routes remain noindex', async () => {
  const currentHtml = fs.readFileSync(path.join(__dirname, '../docs/index.html'), 'utf8');
  // Pin the regression baseline so this comparison survives committing the fix.
  const oldHtml = execFileSync('git', ['show', `${PRE_FIX_BASELINE}:docs/index.html`], { encoding: 'utf8' });
  const guard = html => {
    const isolation = html.indexOf('<script src="./aislamiento.js"></script>');
    assert.notEqual(isolation, -1);
    const start = html.indexOf('<script>', isolation + '<script src="./aislamiento.js"></script>'.length) + 8;
    return html.slice(start, html.indexOf('</script>', start));
  };
  const oldGuard = guard(oldHtml);
  const currentGuard = guard(currentHtml);
  const syntheticLord = 'F123-SYNTHETIC-OWNER';
  const lordFingerprint = hash53(syntheticLord);
  const ownerFixture = oldGuard.replace('6583453063440131', String(lordFingerprint));
  assert.notEqual(ownerFixture, oldGuard, 'only the Lord fingerprint literal is adapted in the fixture');

  const old = runGuard(ownerFixture, '/app/');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(old.fetches.length, 1, 'the old guard recognizes the synthetic Lord fixture');
  assert.deepEqual(old.replacements, ['./next/']);

  const current = runGuard(currentGuard, '/app/');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(current.fetches.length, 0);
  assert.deepEqual(current.replacements, []);

  for (const route of ['/app/next/', '/app/previo/']) {
    const historic = runGuard(currentGuard, route);
    assert.equal(historic.fetches.length, 0);
    assert.deepEqual(historic.replacements, []);
    assert.deepEqual(historic.robots, ['noindex,nofollow']);
  }
});

// Helpers
function hash53(str) {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0, ch; i < str.length; i++) {
    ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

function runGuard(source, pathname) {
  const state = { fetches: [], replacements: [], robots: [] };
  const context = {
    location: { pathname, search: '', hash: '', replace(value) { state.replacements.push(value); } },
    localStorage: { getItem(key) { return key === 'f123_owned' ? JSON.stringify({ licenseCode: 'F123-SYNTHETIC-OWNER' }) : null; },
      setItem() {} },
    fetch(url) { state.fetches.push(url); return Promise.resolve({ ok: true }); },
    document: { createElement() { return {}; }, head: { appendChild(meta) { state.robots.push(meta.content); } } },
    Math, JSON,
  };
  vm.runInNewContext(source, context);
  return state;
}
