const { test } = require('node:test');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const http = require('node:http');
const path = require('node:path');

async function withPage(fn) {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<!doctype html><html><body></body></html>');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.goto('http://127.0.0.1:' + port + '/', { waitUntil: 'domcontentloaded' });
    await fn(page);
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

test('v448 GOLDEN G03: legacy shelf photo remains readable even if migration flag already exists', async () => {
  await withPage(async (page) => {
    await page.evaluate(() => {
      localStorage.clear();
      localStorage.setItem('f123_fotos_migradas_idb_v1', '1');
      localStorage.setItem('f123_foto_percha_u-legacy', 'data:image/png;base64,TEVHQUNZ');
    });
    await page.addScriptTag({ path: path.resolve(__dirname, '../docs/idb-fotos.js') });
    const out = await page.evaluate(async () => ({
      todas: await OCFotos.leerTodas(),
      una: await OCFotos.leerFoto('u-legacy')
    }));
    assert.equal(out.todas['u-legacy'], 'data:image/png;base64,TEVHQUNZ');
    assert.equal(out.una, 'data:image/png;base64,TEVHQUNZ');
  });
});

test('v448 GOLDEN G03: IndexedDB blocked does not make existing legacy shelf photos invisible', async () => {
  await withPage(async (page) => {
    await page.evaluate(() => {
      localStorage.clear();
      localStorage.setItem('f123_foto_percha_u-blocked', 'data:image/png;base64,QkxPQ0tFRA==');
      Object.defineProperty(window, 'indexedDB', {
        configurable: true,
        value: { open() { throw new Error('fixture blocked'); } }
      });
    });
    await page.addScriptTag({ path: path.resolve(__dirname, '../docs/idb-fotos.js') });
    const out = await page.evaluate(async () => ({
      todas: await OCFotos.leerTodas(),
      una: await OCFotos.leerFoto('u-blocked')
    }));
    assert.equal(out.todas['u-blocked'], 'data:image/png;base64,QkxPQ0tFRA==');
    assert.equal(out.una, 'data:image/png;base64,QkxPQ0tFRA==');
  });
});


test('v448 GOLDEN G07: copy-only migration never overwrites newer IDB bytes and preserves legacy by hash', async () => {
  await withPage(async (page) => {
    await page.evaluate(async () => {
      localStorage.clear();
      localStorage.setItem('f123_foto_percha_u-same', 'data:image/png;base64,TEVHQUNZLU9MRA==');
      await new Promise((resolve, reject) => {
        const req = indexedDB.open('f123_fotos', 2);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains('perchas')) db.createObjectStore('perchas');
          if (!db.objectStoreNames.contains('blobs')) db.createObjectStore('blobs');
        };
        req.onerror = () => reject(req.error);
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction('perchas', 'readwrite');
          tx.objectStore('perchas').put('data:image/png;base64,SURCLU5FVw==', 'u-same');
          tx.oncomplete = () => { db.close(); resolve(); };
          tx.onerror = () => reject(tx.error);
        };
      });
    });
    await page.addScriptTag({ path: path.resolve(__dirname, '../docs/idb-fotos.js') });
    const out = await page.evaluate(async () => {
      const legacy = localStorage.getItem('f123_foto_percha_u-same');
      const legacyHash = await OCFotos.hashDeDataUrl(legacy);
      await OCFotos.migrarSiHaceFalta();
      return {
        current: await OCFotos.leerFoto('u-same'),
        legacyHash,
        legacyByHash: await OCFotos.leerPorHash(legacyHash)
      };
    });
    assert.equal(out.current, 'data:image/png;base64,SURCLU5FVw==',
      'legacy copy must never overwrite a newer IDB per-id photo');
    assert.equal(out.legacyByHash, 'data:image/png;base64,TEVHQUNZLU9MRA==',
      'old legacy bytes remain recoverable by content hash');
  });
});

test('v448 GOLDEN G07: forensic hash inventory unions IDB and legacy localStorage blobs', async () => {
  await withPage(async (page) => {
    await page.evaluate(() => {
      localStorage.clear();
      localStorage.setItem('f123_fotoblob_legacy-hash', 'data:image/png;base64,TEVHQUNZLUJMT0I=');
    });
    await page.addScriptTag({ path: path.resolve(__dirname, '../docs/idb-fotos.js') });
    const all = await page.evaluate(() => OCFotos.leerTodosPorHash());
    assert.equal(all['legacy-hash'], 'data:image/png;base64,TEVHQUNZLUJMT0I=');
  });
});
