const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require('playwright');

test('financial facts converge by ID across two real IndexedDB profiles', async () => {
  const server = http.createServer((_req, res) => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('<!doctype html><title>fixture</title>'); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ headless: true });
  const pages = [];
  try {
    for (let n = 0; n < 2; n++) {
      const context = await browser.newContext();
      const page = await context.newPage(); pages.push(page);
      await page.goto(`http://127.0.0.1:${server.address().port}/`);
      await page.evaluate(() => {
        localStorage.setItem('f123_owned', JSON.stringify({ licenseCode: 'SYNTHETIC-FACTS-ONLY', instanceId: crypto.randomUUID() }));
        window.WebSocket = class { constructor() { throw Error('offline fixture'); } };
        window.BroadcastChannel = class { constructor() { throw Error('isolated fixture'); } };
      });
      for (const file of ['mock-backend.js', 'vendor/yjs-bundle.min.js', 'sync-yjs.js', 'hechos.js', 'cartera.js', 'caja-chica.js']) {
        await page.addScriptTag({ content: fs.readFileSync(path.join(__dirname, '../docs', file), 'utf8') });
      }
      await page.waitForFunction(() => window.OCYjs && OCYjs.estado === 'activo' && OCYjs._store && AMG.Hechos);
    }
    const [a, b] = pages;
    await a.evaluate(async () => {
      await AMG.Cartera.registrarMovimiento('fixture-client', 'cargo', 19, 'fixture');
      await AMG.CajaChica.registrarMovimiento('fixture-shelf', 'ingreso', 7, 'fixture');
    });
    await a.waitForFunction(() => OCYjs.hechosMap && OCYjs.hechosMap.size === 2);
    const update = await a.evaluate(() => Array.from(Y.encodeStateAsUpdate(OCYjs.doc)));
    await b.evaluate(bytes => Y.applyUpdate(OCYjs.doc, new Uint8Array(bytes), 'red'), update);
    await b.waitForFunction(async () => (await AMG.Hechos.contar()) === 2);
    const result = await b.evaluate(async () => ({
      credit: await AMG.Cartera.saldoDeCliente('fixture-client'),
      cash: await AMG.CajaChica.saldoDePercha('fixture-shelf'),
      facts: await AMG.Hechos.todos()
    }));
    assert.equal(result.credit.saldo, -19);
    assert.equal(result.cash.saldo, 7);
    assert.equal(result.facts.length, 2);
    await b.evaluate(bytes => Y.applyUpdate(OCYjs.doc, new Uint8Array(bytes), 'red'), update);
    assert.equal(await b.evaluate(() => AMG.Hechos.contar()), 2);
    const tampered = { ...result.facts[0], datos: { monto: 999 } };
    await assert.rejects(() => b.evaluate(h => AMG.Hechos.importarRemoto(h), tampered));
    assert.equal((await b.evaluate(() => AMG.Cartera.saldoDeCliente('fixture-client'))).saldo, -19);

    // A second update can arrive while the first IndexedDB import is pending.
    await b.evaluate(() => {
      const original = AMG.Hechos.importarRemoto;
      let first = true;
      AMG.Hechos.importarRemoto = async function (fact) {
        if (first) {
          first = false; window.__importStarted = true;
          await new Promise(resolve => { window.__releaseImport = resolve; });
        }
        return original(fact);
      };
    });
    await a.evaluate(() => AMG.Cartera.registrarMovimiento('fixture-client', 'abono', 4, 'first update'));
    const firstUpdate = await a.evaluate(() => Array.from(Y.encodeStateAsUpdate(OCYjs.doc)));
    await b.evaluate(bytes => Y.applyUpdate(OCYjs.doc, new Uint8Array(bytes), 'red'), firstUpdate);
    await b.waitForFunction(() => window.__importStarted === true);
    await a.evaluate(() => AMG.Cartera.registrarMovimiento('fixture-client', 'abono', 2, 'second update'));
    const secondUpdate = await a.evaluate(() => Array.from(Y.encodeStateAsUpdate(OCYjs.doc)));
    const started = Date.now();
    await b.evaluate(bytes => Y.applyUpdate(OCYjs.doc, new Uint8Array(bytes), 'red'), secondUpdate);
    await b.evaluate(() => window.__releaseImport());
    await b.waitForFunction(async () => (await AMG.Hechos.contar()) === 4);
    assert.ok(Date.now() - started < 2000, 'local receive-to-persist should stay below two seconds');
    assert.equal((await b.evaluate(() => AMG.Cartera.saldoDeCliente('fixture-client'))).saldo, -13);
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
});
