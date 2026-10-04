const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

async function withPage(fn) {
  const js = fs.readFileSync(path.resolve(__dirname, '../docs/idb-fotos.js'), 'utf8');
  const server = http.createServer((req, res) => {
    if (req.url === '/idb-fotos.js') {
      res.writeHead(200, { 'Content-Type': 'application/javascript' }); res.end(js); return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end('<!doctype html><html><body><script src="/idb-fotos.js"></script></body></html>');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.goto('http://127.0.0.1:' + port + '/', { waitUntil: 'networkidle' });
    return await fn(page);
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

test('Prime Directive: borrarFoto preserves bytes and guardarFoto versions both old and new', async () => {
  await withPage(async (page) => {
    const out = await page.evaluate(async () => {
      const a = 'data:image/png;base64,QUFBQQ==';
      const b = 'data:image/png;base64,QkJCQg==';
      await OCFotos.guardarFoto('shelf-1', a);
      await OCFotos.guardarFoto('shelf-1', b);
      const beforeDelete = await OCFotos.leerFoto('shelf-1');
      const del = await OCFotos.borrarFoto('shelf-1');
      const afterDelete = await OCFotos.leerFoto('shelf-1');
      const blobs = await OCFotos.leerTodosPorHash();
      const hist = await OCFotos.leerHistorialPorPercha();
      return {
        beforeDelete, afterDelete, del,
        blobsCount: Object.keys(blobs).length,
        history: (hist['shelf-1'] || []).map(x => x.dataUrl)
      };
    });
    assert.equal(out.beforeDelete, 'data:image/png;base64,QkJCQg==');
    assert.equal(out.afterDelete, out.beforeDelete, 'borrarFoto must not delete current bytes');
    assert.equal(out.del.borrada, false);
    assert.ok(out.blobsCount >= 2, 'both photo versions survive by content hash');
    assert.ok(out.history.includes('data:image/png;base64,QUFBQQ=='), 'old version preserved');
    assert.ok(out.history.includes('data:image/png;base64,QkJCQg=='), 'new version preserved');
  });
});

test('Prime Directive: legacy migration is copy-only and keeps localStorage source', async () => {
  await withPage(async (page) => {
    const out = await page.evaluate(async () => {
      const key = 'f123_foto_percha_legacy-shelf';
      const p = 'data:image/png;base64,TEVHQUNZ';
      localStorage.setItem(key, p);
      await OCFotos.migrarSiHaceFalta();
      return {
        source: localStorage.getItem(key),
        idb: await OCFotos.leerFoto('legacy-shelf'),
        forensic: await OCFotos.inventarioForense()
      };
    });
    assert.equal(out.source, 'data:image/png;base64,TEVHQUNZ',
      'migration must never remove the original localStorage copy');
    assert.equal(out.idb, out.source, 'copy is added to IndexedDB');
    assert.equal(out.forensic.legacy['legacy-shelf'], out.source);
  });
});
