/* v449 regression — a synced shelf photo that was displayed from its content hash
   must become durable under that shelf id too, so later pointer loss can self-heal. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const path = require('node:path');

test('v449: a previously displayed hash-only shelf photo survives later fotoHash pointer loss', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`
      <!doctype html><html><body>
        <section id="vista-perchas" class="activa">
          <div id="vp-orden"></div><div id="vp-grid"></div><div id="vp-transfers"></div>
        </section>
      </body></html>`);
    await page.evaluate(() => {
      const photo = 'data:image/png;base64,SFlOQy1PTkxZLVBIT1RP';
      window.__photo = photo;
      window.__idPhotos = {};
      window.__shelf = { id: 'u-hash-only', nombre: 'Hash-only shelf', tipo: 'socio', activa: true, fotoHash: 'hash-only' };
      window.t = (k) => ({
        'shelves.noRacksYet':'No shelves yet','shelves.noTarget':'No target','shelves.ofTargetMet':'% target',
        'shelves.monthlySales':'Monthly sales','shelves.target':'Target','shelves.commission':'Commission',
        'shelves.promoter':'Promoter','shelves.open':'Open','shelves.transfersHeading':'Transfers',
        'shelves.addRackBtn':'Add shelf','common.close':'Close','shelves.newRackTitle':'New shelf',
        'shelves.rackNameLabel':'Name','shelves.rackNamePlaceholder':'Shelf name','shelves.assignHint':'Assign',
        'shelves.createRackBtn':'Create'
      }[k] || k);
      window.OCI18n = { locale: () => 'en-US' };
      window.OCMoneda = { codigo: () => 'USD' };
      window.OCAuth = { puedeGestionar: () => false };
      // Simulates a photo received from another peer: present in the content-addressed
      // blob store, but NEVER stored under the shelf id in STORE "perchas".
      window.OCFotos = {
        migrarSiHaceFalta: async () => {},
        leerTodas: async () => ({ ...window.__idPhotos }),
        guardarFoto: async (id, dataUrl) => { window.__idPhotos[id] = dataUrl; return true; },
        guardarFotoContenido: async (dataUrl) => dataUrl === photo ? 'hash-only' : null,
        leerPorHash: async (hash) => hash === 'hash-only' ? photo : null,
        guardarPorHash: async () => true
      };
      window.fetch = async (input, options = {}) => {
        const url = String(input);
        let body = [];
        if (url === '/api/ubicaciones') body = [Object.assign({}, window.__shelf)];
        else if (url === '/api/liquidaciones') body = [];
        else if (url === '/api/promotoras') body = [];
        else if (url === '/api/transferencias') body = [];
        return new Response(JSON.stringify(body), { status:200, headers:{'Content-Type':'application/json'} });
      };
    });
    await page.addScriptTag({ path: path.resolve(__dirname, '../docs/vista-perchas.js') });

    await page.evaluate(() => window.VPerchas.cargar());
    const first = await page.evaluate(() => ({
      img: document.querySelector('#vp-grid img')?.getAttribute('src') || null,
      text: document.getElementById('vp-grid').textContent
    }));
    assert.equal(first.img, 'data:image/png;base64,SFlOQy1PTkxZLVBIT1RP',
      'precondition: the synced hash-only photo really was visible before pointer loss');

    // Simulate the regression already observed in the field: a stale peer/general
    // shelf merge lost the pointer. The bytes themselves are still in blobs.
    await page.evaluate(() => { window.__shelf.fotoHash = null; });
    await page.evaluate(() => window.VPerchas.cargar());
    const second = await page.evaluate(() => ({
      img: document.querySelector('#vp-grid img')?.getAttribute('src') || null,
      text: document.getElementById('vp-grid').textContent
    }));

    assert.equal(second.img, 'data:image/png;base64,SFlOQy1PTkxZLVBIT1RP',
      'a photo that was visible before pointer loss should remain recoverable from durable local storage');
  } finally {
    await browser.close();
  }
});


test('v449: current fotoHash overrides a stale per-id mirror and refreshes that mirror', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`
      <!doctype html><html><body>
        <section id="vista-perchas" class="activa">
          <div id="vp-orden"></div><div id="vp-grid"></div><div id="vp-transfers"></div>
        </section>
      </body></html>`);
    await page.evaluate(() => {
      const oldPhoto = 'data:image/png;base64,T0xELUlELU1JUlJPUg==';
      const newPhoto = 'data:image/png;base64,TkVXLUhBU0gtUEhPVE8=';
      window.__oldPhoto = oldPhoto;
      window.__newPhoto = newPhoto;
      window.__idPhotos = { 'u-stale-id': oldPhoto };
      window.__shelf = { id: 'u-stale-id', nombre: 'Updated photo shelf', tipo: 'socio', activa: true, fotoHash: 'hash-new' };
      window.t = (k) => ({
        'shelves.noRacksYet':'No shelves yet','shelves.noTarget':'No target','shelves.ofTargetMet':'% target',
        'shelves.monthlySales':'Monthly sales','shelves.target':'Target','shelves.commission':'Commission',
        'shelves.promoter':'Promoter','shelves.open':'Open','shelves.transfersHeading':'Transfers',
        'shelves.addRackBtn':'Add shelf','common.close':'Close','shelves.newRackTitle':'New shelf',
        'shelves.rackNameLabel':'Name','shelves.rackNamePlaceholder':'Shelf name','shelves.assignHint':'Assign',
        'shelves.createRackBtn':'Create'
      }[k] || k);
      window.OCI18n = { locale: () => 'en-US' };
      window.OCMoneda = { codigo: () => 'USD' };
      window.OCAuth = { puedeGestionar: () => false };
      window.OCFotos = {
        migrarSiHaceFalta: async () => {},
        leerTodas: async () => ({ ...window.__idPhotos }),
        guardarFoto: async (id, dataUrl) => { window.__idPhotos[id] = dataUrl; return true; },
        guardarFotoContenido: async (dataUrl) => dataUrl === newPhoto ? 'hash-new' : 'hash-old',
        leerPorHash: async (hash) => hash === 'hash-new' ? newPhoto : null,
        guardarPorHash: async () => true
      };
      window.fetch = async (input) => {
        const url = String(input);
        let body = [];
        if (url === '/api/ubicaciones') body = [Object.assign({}, window.__shelf)];
        else if (url === '/api/liquidaciones') body = [];
        else if (url === '/api/promotoras') body = [];
        else if (url === '/api/transferencias') body = [];
        return new Response(JSON.stringify(body), { status:200, headers:{'Content-Type':'application/json'} });
      };
    });
    await page.addScriptTag({ path: path.resolve(__dirname, '../docs/vista-perchas.js') });
    await page.evaluate(() => window.VPerchas.cargar());
    const out = await page.evaluate(() => ({
      img: document.querySelector('#vp-grid img')?.getAttribute('src') || null,
      mirror: window.__idPhotos['u-stale-id']
    }));
    assert.equal(out.img, 'data:image/png;base64,TkVXLUhBU0gtUEhPVE8=',
      'the hash referenced by the current shelf state must beat an older id mirror');
    assert.equal(out.mirror, out.img,
      'the id mirror must be refreshed so future pointer recovery uses the current photo');
  } finally {
    await browser.close();
  }
});


test('v449: explicit modern photo deletion clears an id mirror instead of self-healing it', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`
      <!doctype html><html><body>
        <section id="vista-perchas" class="activa">
          <div id="vp-orden"></div><div id="vp-grid"></div><div id="vp-transfers"></div>
        </section>
      </body></html>`);
    await page.evaluate(() => {
      const oldPhoto = 'data:image/png;base64,REVMRVRFRC1QSE9UTw==';
      window.__idPhotos = { 'u-deleted-photo': oldPhoto };
      window.__puts = [];
      window.__deletes = [];
      window.__shelf = {
        id: 'u-deleted-photo', nombre: 'Deleted photo shelf', tipo: 'propio', activa: true,
        fotoHash: null, fotoRev: { c: 42, d: 'modern-delete' }
      };
      window.t = (k) => ({
        'shelves.noRacksYet':'No shelves yet','shelves.noTarget':'No target','shelves.ofTargetMet':'% target',
        'shelves.monthlySales':'Monthly sales','shelves.target':'Target','shelves.commission':'Commission',
        'shelves.promoter':'Promoter','shelves.open':'Open','shelves.transfersHeading':'Transfers',
        'shelves.addRackBtn':'Add shelf','common.close':'Close','shelves.newRackTitle':'New shelf',
        'shelves.rackNameLabel':'Name','shelves.rackNamePlaceholder':'Shelf name','shelves.assignHint':'Assign',
        'shelves.createRackBtn':'Create'
      }[k] || k);
      window.OCI18n = { locale: () => 'en-US' };
      window.OCMoneda = { codigo: () => 'USD' };
      window.OCAuth = { puedeGestionar: () => false };
      window.OCFotos = {
        migrarSiHaceFalta: async () => {},
        leerTodas: async () => ({ ...window.__idPhotos }),
        guardarFoto: async (id, dataUrl) => { window.__idPhotos[id] = dataUrl; return true; },
        borrarFoto: async (id) => { window.__deletes.push(id); delete window.__idPhotos[id]; },
        guardarFotoContenido: async () => 'hash-old-deleted',
        leerPorHash: async () => null,
        guardarPorHash: async () => true
      };
      window.fetch = async (input, options = {}) => {
        const url = String(input);
        if ((options.method || 'GET') === 'PUT') {
          window.__puts.push({ url, body: JSON.parse(options.body || '{}') });
          return new Response('{}', { status:200, headers:{'Content-Type':'application/json'} });
        }
        let body = [];
        if (url === '/api/ubicaciones') body = [Object.assign({}, window.__shelf)];
        else if (url === '/api/liquidaciones') body = [];
        else if (url === '/api/promotoras') body = [];
        else if (url === '/api/transferencias') body = [];
        return new Response(JSON.stringify(body), { status:200, headers:{'Content-Type':'application/json'} });
      };
    });
    await page.addScriptTag({ path: path.resolve(__dirname, '../docs/vista-perchas.js') });
    await page.evaluate(() => window.VPerchas.cargar());
    const out = await page.evaluate(() => ({
      img: document.querySelector('#vp-grid img')?.getAttribute('src') || null,
      puts: window.__puts.slice(),
      deletes: window.__deletes.slice(),
      mirror: window.__idPhotos['u-deleted-photo'] || null
    }));
    assert.equal(out.img, null, 'an explicit modern deletion must not render stale mirrored bytes');
    assert.equal(out.puts.length, 0, 'an explicit modern deletion must not regenerate fotoHash');
    assert.deepEqual(out.deletes, ['u-deleted-photo']);
    assert.equal(out.mirror, null);
  } finally {
    await browser.close();
  }
});


test('v449: unavailable current fotoHash never displays or trusts a stale per-id mirror', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`
      <!doctype html><html><body>
        <section id="vista-perchas" class="activa">
          <div id="vp-orden"></div><div id="vp-grid"></div><div id="vp-transfers"></div>
        </section>
      </body></html>`);
    await page.evaluate(() => {
      const oldPhoto = 'data:image/png;base64,T0xELVNURUFMRS1NSVJST1I=';
      window.__idPhotos = { 'u-missing-current': oldPhoto };
      window.__deletes = [];
      window.__shelf = {
        id: 'u-missing-current', nombre: 'Waiting for current photo', tipo: 'propio',
        activa: true, fotoHash: 'hash-current-not-here', fotoRev: { c: 9, d: 'peer-new' }
      };
      window.t = (k) => ({
        'shelves.noRacksYet':'No shelves yet','shelves.noTarget':'No target','shelves.ofTargetMet':'% target',
        'shelves.monthlySales':'Monthly sales','shelves.target':'Target','shelves.commission':'Commission',
        'shelves.promoter':'Promoter','shelves.open':'Open','shelves.transfersHeading':'Transfers',
        'shelves.addRackBtn':'Add shelf','common.close':'Close','shelves.newRackTitle':'New shelf',
        'shelves.rackNameLabel':'Name','shelves.rackNamePlaceholder':'Shelf name','shelves.assignHint':'Assign',
        'shelves.createRackBtn':'Create'
      }[k] || k);
      window.OCI18n = { locale: () => 'en-US' };
      window.OCMoneda = { codigo: () => 'USD' };
      window.OCAuth = { puedeGestionar: () => false };
      window.OCFotos = {
        migrarSiHaceFalta: async () => {},
        leerTodas: async () => ({ ...window.__idPhotos }),
        leerPorHash: async () => null,
        guardarPorHash: async () => true,
        guardarFoto: async (id, dataUrl) => { window.__idPhotos[id] = dataUrl; return true; },
        borrarFoto: async (id) => { window.__deletes.push(id); delete window.__idPhotos[id]; },
        hashDeDataUrl: async (dataUrl) => dataUrl === oldPhoto ? 'hash-old-stale' : 'hash-other',
        guardarFotoContenido: async (dataUrl) => dataUrl === oldPhoto ? 'hash-old-stale' : 'hash-other'
      };
      window.fetch = async (input, options = {}) => {
        const url = String(input);
        if ((options.method || 'GET') === 'PUT') {
          return new Response('{}', { status:200, headers:{'Content-Type':'application/json'} });
        }
        let body = [];
        if (url === '/api/ubicaciones') body = [Object.assign({}, window.__shelf)];
        else if (url === '/api/liquidaciones') body = [];
        else if (url === '/api/promotoras') body = [];
        else if (url === '/api/transferencias') body = [];
        return new Response(JSON.stringify(body), { status:200, headers:{'Content-Type':'application/json'} });
      };
    });
    await page.addScriptTag({ path: path.resolve(__dirname, '../docs/vista-perchas.js') });
    await page.evaluate(() => window.VPerchas.cargar());
    const out = await page.evaluate(() => ({
      img: document.querySelector('#vp-grid img')?.getAttribute('src') || null,
      mirror: window.__idPhotos['u-missing-current'] || null,
      deletes: window.__deletes.slice(),
      pointer: window.__shelf.fotoHash
    }));
    assert.equal(out.img, null, 'stale bytes must not be painted under a newer unresolved pointer');
    assert.equal(out.pointer, 'hash-current-not-here', 'the current pointer remains untouched');
    assert.equal(out.mirror, null, 'a proven-mismatched id mirror is cleared so it cannot later self-heal the wrong photo');
    assert.deepEqual(out.deletes, ['u-missing-current']);
  } finally {
    await browser.close();
  }
});
