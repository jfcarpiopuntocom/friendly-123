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

async function seedLateRawPhoto(page, id, bytes) {
  await page.evaluate(({id, bytes}) => {
    // Simula un aparato que YA habia ejecutado la migracion de aislamiento y,
    // despues, una shell vieja vuelve a escribir una clave raw sin namespace.
    localStorage.setItem('f123::_migrado_v1', 'already-done');
    localStorage.setItem('f123_foto_percha_' + id, bytes);
    localStorage.setItem('f123_foto_percha_invalid', 'javascript:alert(1)');
  }, {id, bytes});
}

for (const [name, engine] of [['chromium',chromium],['webkit',webkit]]) {
  test('G10b '+name+': rescata foto raw escrita despues del marcador de aislamiento sin borrar origen', async () => {
    await withBrowser(engine, async (page) => {
      const id='shelf-late-raw';
      const photo='data:image/png;base64,RzEwYi1SQVctTEFURS1QSE9UTw==';
      await seedLateRawPhoto(page, id, photo);

      await page.addScriptTag({url:'/aislamiento.js'});
      // La app aislada NO debe ver la clave raw directamente.
      assert.equal(await page.evaluate((id) => localStorage.getItem('f123_foto_percha_' + id), id), null);

      await page.addScriptTag({url:'/idb-fotos.js'});
      const out = await page.evaluate(async ({id}) => {
        await OCFotos.migrarSiHaceFalta();
        const current = await OCFotos.leerFoto(id);
        const raw = await AMG.Aislamiento.leerFotosLocalStoragePreAislamiento();
        const diag = await OCFotos.diagnosticoRecuperacion();
        return {
          current,
          rawPhoto: raw && raw.perchas && raw.perchas[id],
          invalid: raw && raw.perchas && raw.perchas.invalid,
          diag
        };
      }, {id});

      assert.equal(out.current, photo, 'late raw legacy photo becomes visible in current store');
      assert.equal(out.rawPhoto, photo, 'raw source remains intact: copy-only');
      assert.equal(out.invalid, undefined, 'non-image raw value is rejected by the narrow reader');
      assert.ok(out.diag.rawLocalStorage.perchas >= 1);
      assert.ok(out.diag.current.perchas >= 1);
    });
  });
}

test('G10b: current per-id photo wins over late raw legacy copy while old bytes remain preserved by hash', async () => {
  await withBrowser(chromium, async (page) => {
    const id='same-shelf';
    const old='data:image/png;base64,RzEwYi1PTEQ=';
    const current='data:image/png;base64,RzEwYi1DVVJSRU5U';
    await seedLateRawPhoto(page, id, old);
    await page.addScriptTag({url:'/aislamiento.js'});
    await page.addScriptTag({url:'/idb-fotos.js'});
    const out = await page.evaluate(async ({id,current,old}) => {
      await OCFotos.guardarFoto(id, current);
      await OCFotos.migrarSiHaceFalta();
      const now = await OCFotos.leerFoto(id);
      const h = await OCFotos.hashDeDataUrl(old);
      const byHash = await OCFotos.leerPorHash(h);
      return {now, byHash};
    }, {id,current,old});
    assert.equal(out.now, current, 'new current photo is never overwritten');
    assert.equal(out.byHash, old, 'old raw evidence remains recoverable by content hash');
  });
});
