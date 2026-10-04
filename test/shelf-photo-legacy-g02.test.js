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

test('v448 GOLDEN G02: legacy shelf photo remains readable even if migration flag already exists', async () => {
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

test('v448 GOLDEN G02: IndexedDB blocked does not make existing legacy shelf photos invisible', async () => {
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
