// Golden v448 certification: real WebKit + real IndexedDB shelf-photo paths.
// QA-only. No production network and no customer data.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { webkit, devices } = require('playwright');

const DOCS = path.resolve(__dirname, '../docs');

function server() {
  return http.createServer((req, res) => {
    const u = req.url.split('?')[0];
    if (u === '/idb-fotos.js' || u === '/vista-perchas.js') {
      const f = path.join(DOCS, u.slice(1));
      res.writeHead(200, { 'Content-Type': 'text/javascript', 'Cache-Control': 'no-store' });
      return res.end(fs.readFileSync(f));
    }
    if (u !== '/') { res.writeHead(404); return res.end(); }
    const html = `<!doctype html><html><body>
      <section id="vista-perchas" class="activa">
        <div id="vp-orden"></div><div id="vp-grid"></div><div id="vp-transfers"></div>
      </section>
      <script>
        window.t = (k) => ({
          'shelves.noRacksYet':'No shelves yet','shelves.noTarget':'No target',
          'shelves.ofTargetMet':'% target','shelves.monthlySales':'Monthly sales',
          'shelves.target':'Target','shelves.commission':'Commission',
          'shelves.promoter':'Promoter','shelves.open':'Open',
          'shelves.transfersHeading':'Transfers','shelves.addRackBtn':'Add shelf',
          'common.close':'Close','shelves.newRackTitle':'New shelf',
          'shelves.rackNameLabel':'Name','shelves.rackNamePlaceholder':'Shelf',
          'shelves.assignHint':'Assign products later','shelves.createRackBtn':'Create'
        }[k] || k);
        window.OCI18n = { locale: () => 'en-US' };
        window.OCMoneda = { codigo: () => 'USD' };
        window.OCAuth = { puedeGestionar: () => false };
        window.__perchas = [];
        window.__puts = [];
        window.fetch = async (input, options = {}) => {
          const url = String(input), method = options.method || 'GET';
          if (url === '/api/ubicaciones' && method === 'GET') {
            return new Response(JSON.stringify(window.__perchas.filter(x => x && x.activa !== false && !x.borrado)), {status:200,headers:{'Content-Type':'application/json'}});
          }
          if (url === '/api/ubicaciones?todas=1' && method === 'GET') {
            return new Response(JSON.stringify(window.__perchas), {status:200,headers:{'Content-Type':'application/json'}});
          }
          if (url.startsWith('/api/ubicaciones/') && method === 'PUT') {
            const id = decodeURIComponent(url.split('/').pop());
            const body = JSON.parse(options.body || '{}');
            const p = window.__perchas.find(x => x.id === id);
            if (p) Object.assign(p, body);
            window.__puts.push({ id, body });
            return new Response(JSON.stringify(p || {}), {status:200,headers:{'Content-Type':'application/json'}});
          }
          if (url === '/api/liquidaciones' || url === '/api/promotoras' || url === '/api/transferencias' || url === '/api/ventas/todas') {
            return new Response('[]', {status:200,headers:{'Content-Type':'application/json'}});
          }
          return new Response('{}', {status:200,headers:{'Content-Type':'application/json'}});
        };
      </script>
      <script src="/idb-fotos.js"></script>
      <script src="/vista-perchas.js"></script>
    </body></html>`;
    res.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' });
    res.end(html);
  });
}

async function deleteBlob(page, hash) {
  await page.evaluate(async (h) => {
    await new Promise((resolve, reject) => {
      const req = indexedDB.open('f123_fotos', 2);
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction('blobs', 'readwrite');
        tx.objectStore('blobs').delete(h);
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
      };
      req.onerror = () => reject(req.error);
    });
  }, hash);
}

test('v448 golden: WebKit/iPhone keeps shelf photos through ID, hash, Yjs read-repair, and archive filtering', async () => {
  const srv = server();
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${srv.address().port}/`;
  const browser = await webkit.launch({ headless: true });
  try {
    const ctx = await browser.newContext({ ...devices['iPhone 13'] });
    const page = await ctx.newPage();
    const pageErrors = [];
    page.on('pageerror', e => pageErrors.push(String(e)));
    await page.goto(url, { waitUntil: 'load' });
    await page.waitForFunction(() => window.OCFotos && window.VPerchas);

    const supported = await page.evaluate(() => window.OCFotos.soportado());
    assert.equal(supported, true, 'WebKit must exercise real IndexedDB, not fallback localStorage');

    const photoA = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl7sAAAAASUVORK5CYII=';
    await page.evaluate(async (photo) => {
      window.__perchas = [{ id:'golden-shelf', nombre:'Golden Shelf', tipo:'socio', activa:true, fotoHash:null }];
      await window.OCFotos.guardarFoto('golden-shelf', photo);
      await window.VPerchas.cargar();
    }, photoA);

    const first = await page.evaluate(async () => {
      const p = window.__perchas[0];
      return {
        hash:p.fotoHash,
        img:document.querySelector('#vp-grid img')?.getAttribute('src') || null,
        byId:await window.OCFotos.leerFoto('golden-shelf'),
        byHash:p.fotoHash ? await window.OCFotos.leerPorHash(p.fotoHash) : null,
        puts:window.__puts.slice()
      };
    });
    assert.ok(first.hash, 'ID-only photo self-heals a fotoHash');
    assert.equal(first.img, photoA, 'ID photo is visible');
    assert.equal(first.byId, photoA, 'ID bytes remain intact');
    assert.equal(first.byHash, photoA, 'same exact bytes were mirrored by hash');
    assert.ok(first.puts.some(x => x.body && x.body.fotoHash === first.hash), 'self-heal persisted only the derived hash pointer');

    // Hash-only recovery: remove the per-shelf ID copy but retain content-addressed bytes.
    await page.evaluate(async () => {
      await window.OCFotos.borrarFoto('golden-shelf');
      await window.VPerchas.cargar();
    });
    const hashOnly = await page.evaluate(() => document.querySelector('#vp-grid img')?.getAttribute('src') || null);
    assert.equal(hashOnly, photoA, 'hash-only blob renders in WebKit after ID copy is gone');

    // Yjs read-repair: remove both local stores, leave only the exact hash->bytes remote map.
    await page.evaluate(async () => { await window.OCFotos.borrarFoto('golden-shelf'); });
    await deleteBlob(page, first.hash);
    await page.evaluate(async ({hash, photo}) => {
      window.__perchas[0].fotoHash = hash;
      window.OCYjs = { fotosMap: new Map([[hash, photo]]) };
      await window.VPerchas.cargar();
    }, {hash:first.hash, photo:photoA});
    const yjs = await page.evaluate(async (hash) => ({
      img:document.querySelector('#vp-grid img')?.getAttribute('src') || null,
      repaired:await window.OCFotos.leerPorHash(hash)
    }), first.hash);
    assert.equal(yjs.img, photoA, 'Yjs exact hash bytes render');
    assert.equal(yjs.repaired, photoA, 'Yjs exact bytes are read-repaired into IndexedDB');

    // Archived shelves must never resurrect just because photo bytes still exist.
    await page.evaluate(async () => {
      window.__perchas[0].activa = false;
      await window.VPerchas.cargar();
    });
    const archived = await page.evaluate(() => ({
      text:document.getElementById('vp-grid').textContent,
      card:!!document.querySelector('[data-vp-abrir="golden-shelf"]')
    }));
    assert.equal(archived.card, false, 'archived shelf is absent from operational view');
    assert.doesNotMatch(archived.text, /Golden Shelf/, 'archived shelf name does not leak back into the grid');

    assert.deepEqual(pageErrors, [], 'no WebKit page errors in the photo recovery path');
  } finally {
    await browser.close();
    srv.close();
  }
});
