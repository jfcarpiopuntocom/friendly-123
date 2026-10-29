const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require('playwright');

test('remote facts retain IndexedDB abort causes and recover locally without another Yjs update', { timeout: 20000 }, async () => {
  const server = http.createServer((_req, res) => res.end('<!doctype html><title>isolated facts</title>'));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    page.setDefaultTimeout(3000);
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.evaluate(() => {
      localStorage.setItem('f123_owned', JSON.stringify({ licenseCode: 'SYNTHETIC-FACTS-ONLY', instanceId: crypto.randomUUID() }));
      window.WebSocket = class { constructor() { throw Error('offline fixture'); } };
      window.BroadcastChannel = class { constructor() { throw Error('isolated fixture'); } };
    });
    for (const file of ['mock-backend.js', 'vendor/yjs-bundle.min.js', 'sync-yjs.js', 'hechos.js', 'cartera.js']) {
      await page.addScriptTag({ content: fs.readFileSync(path.join(__dirname, '../docs', file), 'utf8') });
    }
    await page.waitForFunction(() => window.OCYjs && OCYjs.hechosListos && OCYjs.hechosListos());
    await page.evaluate(async () => {
      await AMG.Cartera.registrarMovimiento('fixture-client', 'cargo', 19, 'fixture');
      window.__fact = (await AMG.Hechos.todos())[0];
      window.__fact = { ...window.__fact, id: 'remote-abort-1', instanceId: 'remote-abort', reloj: { 'remote-abort': 1 }, hashPrevio: '' };
      const h = window.__fact;
      const base = JSON.stringify({ id: h.id, instanceId: h.instanceId, autor: h.autor, reloj: h.reloj, ts: h.ts, tipo: h.tipo, datos: h.datos, hashPrevio: h.hashPrevio });
      h.hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(base)))).map(x => x.toString(16).padStart(2, '0')).join('');
      const original = IDBObjectStore.prototype.add;
      window.__remainingAborts = 1; window.__attempts = 0;
      IDBObjectStore.prototype.add = function (value) {
        const req = original.apply(this, arguments);
        if (this.name === 'hechos' && value.id === window.__fact.id) {
          window.__attempts++;
          if (window.__remainingAborts-- > 0) this.transaction.abort();
        }
        return req;
      };
    });
    const abort = await page.evaluate(async () => {
      try { await AMG.Hechos.importarRemoto(window.__fact); return null; }
      catch (e) { return { name: e.name, message: e.message }; }
    });
    assert.equal(abort.name, 'AbortError', 'a real IndexedDB abort must not be labeled an ID collision');
    await page.evaluate(() => {
      window.__remainingAborts = 1; window.__attempts = 0;
      OCYjs.doc.transact(() => OCYjs.hechosMap.set(window.__fact.id, window.__fact), 'red');
    });
    const deadline = Date.now() + 3000;
    while (!(await page.evaluate(async () => (await AMG.Hechos.todos()).some(h => h.id === window.__fact.id)))) {
      assert.ok(Date.now() < deadline, 'the valid fact must persist without another Yjs update');
      await page.waitForTimeout(50);
    }
    assert.equal(await page.evaluate(() => window.__attempts), 2);
    assert.equal((await page.evaluate(() => AMG.Cartera.saldoDeCliente('fixture-client'))).saldo, -38);
    const result = await page.evaluate(async () => {
      const duplicate = await AMG.Hechos.importarRemoto(window.__fact);
      const collision = { ...window.__fact, extra: 'different immutable content' };
      let error;
      try { await AMG.Hechos.importarRemoto(collision); } catch (e) { error = e.message; }
      return { duplicate, error, count: (await AMG.Hechos.todos()).length };
    });
    assert.equal(result.duplicate, false);
    assert.match(result.error, /colision/);
    assert.equal(result.count, 2);
    await page.evaluate(() => {
      const original = AMG.Hechos.importarRemoto;
      window.__invalidAttempts = 0;
      AMG.Hechos.importarRemoto = function (h) {
        if (h.id === 'invalid-hash-1') window.__invalidAttempts++;
        return original(h);
      };
      const invalid = { ...window.__fact, id: 'invalid-hash-1' };
      OCYjs.doc.transact(() => OCYjs.hechosMap.set(invalid.id, invalid), 'red');
    });
    await page.waitForFunction(() => window.__invalidAttempts === 1);
    await page.waitForTimeout(850);
    assert.equal(await page.evaluate(() => window.__invalidAttempts), 1, 'invalid hashes must not be retried automatically');
    assert.equal(await page.evaluate(() => AMG.Hechos.contar()), 2);
    await page.evaluate(async () => {
      window.__remainingAborts = 99; window.__attempts = 0;
      const h = { ...window.__fact, id: 'remote-abort-2', reloj: { 'remote-abort': 2 }, hashPrevio: window.__fact.hash };
      window.__fact = h;
      const base = JSON.stringify({ id: h.id, instanceId: h.instanceId, autor: h.autor, reloj: h.reloj, ts: h.ts, tipo: h.tipo, datos: h.datos, hashPrevio: h.hashPrevio });
      h.hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(base)))).map(x => x.toString(16).padStart(2, '0')).join('');
      OCYjs.doc.transact(() => OCYjs.hechosMap.set(h.id, h), 'red');
    });
    await page.waitForFunction(() => window.__attempts >= 1);
    assert.equal(await page.evaluate(() => OCYjs.hechosListos()), false, 'a failed financial fact is not acknowledged as ready');
    // Recovery is exponential (2s, 4s, ...), not four attempts inside 3s.
    // Re-enable IDB and wake the existing retry path without another Yjs update.
    await page.evaluate(() => {
      window.__remainingAborts = 0;
      window.dispatchEvent(new Event('online'));
    });
    await page.waitForFunction(async () =>
      (await AMG.Hechos.todos()).some(h => h.id === 'remote-abort-2'), null, { timeout: 6000 });
    assert.ok(await page.evaluate(() => window.__attempts >= 2), 'original remote fact must be retried');
    assert.equal(await page.evaluate(() => OCYjs.hechosListos()), true, 'recovered fact is durable and ready');
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
});
