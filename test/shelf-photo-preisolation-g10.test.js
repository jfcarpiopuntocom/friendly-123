const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { chromium, webkit } = require('playwright');

const ROOT = path.resolve(__dirname, '..');

async function withBrowser(engine, fn) {
  const server = http.createServer((req, res) => {
    const map = {
      '/aislamiento.js':'docs/aislamiento.js',
      '/idb-fotos.js':'docs/idb-fotos.js'
    };
    if (map[req.url]) {
      res.writeHead(200, {'Content-Type':'application/javascript'});
      res.end(fs.readFileSync(path.join(ROOT, map[req.url]), 'utf8'));
      return;
    }
    res.writeHead(200, {'Content-Type':'text/html'});
    res.end('<!doctype html><html><body></body></html>');
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const browser = await engine.launch({headless:true});
  try {
    const page = await browser.newPage();
    await page.goto('http://127.0.0.1:' + server.address().port + '/', {waitUntil:'domcontentloaded'});
    await fn(page);
  } finally {
    await browser.close();
    await new Promise(r => server.close(r));
  }
}

async function seedRawLegacy(page, {perchas={}, blobs={}}) {
  await page.evaluate(async ({perchas, blobs}) => {
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
        const tx = db.transaction(['perchas','blobs'], 'readwrite');
        for (const [k,v] of Object.entries(perchas)) tx.objectStore('perchas').put(v,k);
        for (const [k,v] of Object.entries(blobs)) tx.objectStore('blobs').put(v,k);
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => reject(tx.error);
      };
    });
  }, {perchas, blobs});
}

async function runRescue(page) {
  await page.addScriptTag({url:'/aislamiento.js'});
  await page.addScriptTag({url:'/idb-fotos.js'});
  return page.evaluate(async () => {
    const r = await OCFotos.rescatarDbPreAislamiento();
    const ids = await OCFotos.leerTodas();
    const hashes = await OCFotos.leerTodosPorHash();
    const physical = typeof indexedDB.databases === 'function'
      ? (await indexedDB.databases()).map(x => x.name).sort()
      : [];
    const legacy = await AMG.Aislamiento.leerFotosDbPreAislamiento();
    return {r, ids, hashes, physical, legacy};
  });
}

for (const [name, engine] of [['chromium',chromium],['webkit',webkit]]) {
  test('G10 '+name+': rescata copy-only la DB f123_fotos anterior al namespace', async () => {
    await withBrowser(engine, async (page) => {
      const old='data:image/png;base64,RzEwLU9MRC1TSEVMRi1QSE9UTw==';
      const blob='data:image/png;base64,RzEwLU9MRC1CTE9C';
      await seedRawLegacy(page, {
        perchas:{'shelf-old':old},
        blobs:{'legacy-hash':blob}
      });
      const out = await runRescue(page);
      assert.equal(out.r.encontrada, true);
      assert.equal(out.ids['shelf-old'], old, 'old per-id photo becomes visible in current namespaced store');
      assert.equal(out.hashes['legacy-hash'], blob, 'old content-addressed blob is copied too');
      assert.equal(out.legacy.perchas['shelf-old'], old, 'source DB remains intact');
      assert.equal(out.legacy.blobs['legacy-hash'], blob, 'source blob remains intact');
      if (out.physical.length) {
        assert.ok(out.physical.includes('f123_fotos'), 'physical pre-isolation DB still exists');
        assert.ok(out.physical.includes('f123::f123_fotos'), 'current isolated DB exists separately');
      }
    });
  });
}

test('G10: migration never overwrites a newer current per-shelf photo', async () => {
  await withBrowser(chromium, async (page) => {
    const old='data:image/png;base64,RzEwLU9MRC1WRVJTSU9O';
    const current='data:image/png;base64,RzEwLUNVUlJFTlQtVkVSU0lPTg==';
    await seedRawLegacy(page, {perchas:{'same-shelf':old}});
    await page.addScriptTag({url:'/aislamiento.js'});
    await page.addScriptTag({url:'/idb-fotos.js'});
    const out = await page.evaluate(async ({current, old}) => {
      await OCFotos.guardarFoto('same-shelf', current);
      await OCFotos.rescatarDbPreAislamiento();
      const byId = await OCFotos.leerFoto('same-shelf');
      const evidence = await OCFotos.leerTodosPorHash();
      const oldHash = await OCFotos.hashDeDataUrl(old);
      const legacy = await AMG.Aislamiento.leerFotosDbPreAislamiento();
      return {byId, oldHash, preserved:evidence[oldHash]||null, legacy:legacy.perchas['same-shelf']};
    }, {current, old});
    assert.equal(out.byId, current, 'new current photo wins');
    assert.equal(out.preserved, old, 'old photo is still preserved by content hash');
    assert.equal(out.legacy, old, 'legacy source is untouched');
  });
});
