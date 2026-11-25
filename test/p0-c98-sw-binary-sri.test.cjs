'use strict';
// C98 RED->GREEN: Service Worker install SRI must hash raw bytes via arrayBuffer()
// (so valid binary assets like logo.png / fonts do NOT fail UTF-8 decoding and re-fetch)
// and must run in bounded batches rather than opening all 130+ cached files concurrently.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');

const docsDir = path.join(__dirname, '../docs');
const manifest = JSON.parse(fs.readFileSync(path.join(docsDir, 'version-manifest.json'), 'utf8'));

function runSwInstallWithAssets(entries, options = {}) {
  const swSrc = fs.readFileSync(path.join(docsDir, 'sw.js'), 'utf8');
  const installBlock = swSrc.slice(
    swSrc.indexOf('self.addEventListener("install"'),
    swSrc.indexOf('self.addEventListener("fetch"')
  );
  const filesMap = new Map(Object.entries(entries));
  const manifestSubset = { version: manifest.version, shell: manifest.shell, files: {} };
  for (const rel of filesMap.keys()) {
    manifestSubset.files[rel] = manifest.files[rel];
  }

  let activeReads = 0;
  let peakReads = 0;
  const refetches = [];
  const replaced = [];

  function makeResponse(buf) {
    const u8 = new Uint8Array(buf);
    const readBytes = async () => {
      activeReads++;
      if (activeReads > peakReads) peakReads = activeReads;
      await new Promise((r) => setTimeout(r, 8));
      activeReads--;
      return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);
    };
    return {
      ok: true,
      clone() { return makeResponse(buf); },
      async arrayBuffer() { return readBytes(); },
      async text() {
        const ab = await readBytes();
        return new TextDecoder('utf-8').decode(ab);
      }
    };
  }

  const cacheObj = {
    async add() { return undefined; },
    async match(rel) {
      if (rel === './version-manifest.json') {
        return { ok: true, async json() { return manifestSubset; } };
      }
      const buf = filesMap.get(rel);
      return buf ? makeResponse(buf) : null;
    },
    async put(rel, res) {
      replaced.push(rel);
      if (res && typeof res.arrayBuffer === 'function') {
        const ab = await res.arrayBuffer();
        filesMap.set(rel, Buffer.from(ab));
      }
    }
  };

  let waitPromise = Promise.resolve();
  const self = {
    addEventListener(k, fn) { if (k === 'install') self._onInstall = fn; },
    skipWaiting() { return Promise.resolve(); },
    clients: { claim() {}, matchAll() { return Promise.resolve([]); } }
  };
  const caches = {
    async open() { return cacheObj; },
    async keys() { return [manifest.shell + '-golden0']; }
  };
  const fetchFn = async (req) => {
    const rel = typeof req === 'string' ? req : req.url;
    refetches.push(rel);
    const replacement = options.networkOverrides?.[rel];
    return replacement ? makeResponse(replacement) : makeResponse(filesMap.get(rel));
  };

  const decls = [
    'const CACHE = ' + JSON.stringify(manifest.shell) + ';',
    'const CACHE_GENERACION = "-golden0";',
    'const CACHE_LOCAL = CACHE + CACHE_GENERACION, CANAL = "";',
    'function esDeMiCanal(n) { return n.startsWith("f123-shell-v") && !/-(next|previo)$/.test(n); }',
    'const SHELL = ' + JSON.stringify([...filesMap.keys()]) + ';'
  ].join('\n');

  vm.runInNewContext(decls + '\n' + installBlock, {
    self,
    caches,
    fetch: fetchFn,
    Request: class { constructor(url, init) { this.url = url; this.init = init; } },
    TextEncoder,
    Promise,
    console: { warn() {} },
    crypto: { subtle: crypto.webcrypto.subtle }
  }, { timeout: 2000 });

  const event = {
    waitUntil(p) { waitPromise = Promise.resolve(p); }
  };
  self._onInstall(event);
  return waitPromise.then(async () => {
    // Allow bounded worker-pool async SRI verification to settle.
    await new Promise((r) => setTimeout(r, 250));
    return { refetches, replaced, peakReads };
  });
}

function readLfBytes(rel) {
  const filePath = path.join(docsDir, rel.replace(/^\.\//, ''));
  const raw = fs.readFileSync(filePath);
  if (/\.(png|ico|woff2)$/i.test(rel)) return raw;
  return Buffer.from(raw.toString('utf8').replace(/\r\n/g, '\n'), 'utf8');
}

test('C98: binary asset matching version-manifest.json SHA-256 must NOT mismatch under UTF-8 text decode or re-fetch', async () => {
  const logoBytes = readLfBytes('./logo.png');
  const scriptBytes = readLfBytes('./copiar-libre.js');
  const result = await runSwInstallWithAssets({
    './logo.png': logoBytes,
    './copiar-libre.js': scriptBytes
  });
  assert.deepEqual(result.refetches, []);
  assert.deepEqual(result.replaced, []);
});

test('C98: SRI bounded batching caps concurrent in-flight digest allocations <= 4 across many assets', async () => {
  const entries = {};
  for (const [rel, sha] of Object.entries(manifest.files)) {
    if (typeof sha !== 'string' || !sha.startsWith('sha256-')) continue;
    const filePath = path.join(docsDir, rel.replace(/^\.\//, ''));
    if (fs.existsSync(filePath)) entries[rel] = readLfBytes(rel);
    if (Object.keys(entries).length >= 16) break;
  }
  const result = await runSwInstallWithAssets(entries);
  assert.equal(result.refetches.length, 0);
  assert.ok(result.peakReads >= 1 && result.peakReads <= 4, `expected bounded SRI concurrency <= 4, got ${result.peakReads}`);
});

test('C98: genuinely corrupted binary bytes in cache STILL trigger network refresh and cache repair', async () => {
  const realLogo = readLfBytes('./logo.png');
  const corrupted = Buffer.from(realLogo);
  corrupted[0] ^= 0xff;
  const result = await runSwInstallWithAssets(
    { './logo.png': corrupted },
    { networkOverrides: { './logo.png': realLogo } }
  );
  assert.deepEqual(result.refetches, ['./logo.png']);
  assert.deepEqual(result.replaced, ['./logo.png']);
});
