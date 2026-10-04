const { test } = require('node:test');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const path = require('node:path');

test('v446: a shelf photo still stored by id reattaches its hash automatically', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`
      <!doctype html><html><body>
        <section id="vista-perchas" class="activa">
          <div id="vp-orden"></div>
          <div id="vp-grid"></div>
          <div id="vp-transfers"></div>
        </section>
      </body></html>
    `);

    await page.evaluate(() => {
      const photo = 'data:image/png;base64,bG9jYWwtc2hlbGYtcGhvdG8=';
      window.__photo = photo;
      window.__puts = [];

      window.t = (k) => ({
        'shelves.noRacksYet': 'No shelves yet',
        'shelves.noTarget': 'No target',
        'shelves.ofTargetMet': '% target',
        'shelves.monthlySales': 'Monthly sales',
        'shelves.target': 'Target',
        'shelves.commission': 'Commission',
        'shelves.promoter': 'Promoter',
        'shelves.open': 'Open',
        'shelves.transfersHeading': 'Transfers',
        'shelves.addRackBtn': 'Add shelf'
      }[k] || k);
      window.OCI18n = { locale: () => 'en-US' };
      window.OCMoneda = { codigo: () => 'USD' };
      window.OCAuth = { puedeGestionar: () => false };
      window.OCFotos = {
        migrarSiHaceFalta: async () => {},
        leerTodas: async () => ({ 'u-photo': photo }),
        guardarFotoContenido: async (data) => {
          window.__hashedData = data;
          return 'hash-recovered';
        },
        leerPorHash: async () => null,
        guardarPorHash: async () => true
      };
      window.fetch = async (input, options = {}) => {
        const url = String(input);
        const method = options.method || 'GET';
        if (method === 'PUT') {
          window.__puts.push({ url, body: JSON.parse(options.body || '{}') });
          return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        let body = [];
        if (url === '/api/ubicaciones') {
          body = [{ id: 'u-photo', nombre: 'JFC shelf', tipo: 'propio', activa: true, fotoHash: null }];
        } else if (url === '/api/liquidaciones') body = [];
        else if (url === '/api/promotoras') body = [];
        else if (url === '/api/transferencias') body = [];
        return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
      };
    });

    await page.addScriptTag({ path: path.resolve(__dirname, '../docs/core/shelf-photo-policy.js') });
    await page.addScriptTag({ path: path.resolve(__dirname, '../docs/application/recover-shelf-photo.js') });
    await page.addScriptTag({ path: path.resolve(__dirname, '../docs/vista-perchas.js') });
    await page.evaluate(() => window.VPerchas.cargar());

    const result = await page.evaluate(() => ({
      puts: window.__puts.slice(),
      img: document.querySelector('#vp-grid img') && document.querySelector('#vp-grid img').getAttribute('src'),
      text: document.getElementById('vp-grid').textContent,
      hashedData: window.__hashedData
    }));

    assert.match(result.text, /JFC shelf/);
    assert.equal(result.img, 'data:image/png;base64,bG9jYWwtc2hlbGYtcGhvdG8=');
    assert.equal(result.hashedData, result.img, 'the exact local bytes are hashed; no photo is guessed or copied');
    assert.deepEqual(result.puts, [{
      url: '/api/ubicaciones/u-photo',
      body: { fotoHash: 'hash-recovered' }
    }]);
  } finally {
    await browser.close();
  }
});


test('v448 GOLDEN G07: UI adapter falls through render cache to storage port for same-shelf legacy bytes', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`
      <!doctype html><html><body>
        <section id="vista-perchas" class="activa">
          <div id="vp-orden"></div>
          <div id="vp-grid"></div>
          <div id="vp-transfers"></div>
        </section>
      </body></html>
    `);
    await page.evaluate(() => {
      const photo = 'data:image/png;base64,U1RPUkFHRS1QT1JULUZBTExCQUNL';
      window.__photo = photo;
      window.__puts = [];
      window.__readFotoCalls = 0;
      window.t = (k) => ({
        'shelves.noRacksYet':'No shelves yet','shelves.noTarget':'No target',
        'shelves.ofTargetMet':'% target','shelves.monthlySales':'Monthly sales',
        'shelves.target':'Target','shelves.commission':'Commission',
        'shelves.promoter':'Promoter','shelves.open':'Open',
        'shelves.transfersHeading':'Transfers','shelves.addRackBtn':'Add shelf'
      }[k] || k);
      window.OCI18n = { locale: () => 'en-US' };
      window.OCMoneda = { codigo: () => 'USD' };
      window.OCAuth = { puedeGestionar: () => false };
      window.OCFotos = {
        migrarSiHaceFalta: async () => {},
        blindarEvidencia: async () => ({}),
        leerTodas: async () => ({}), // render cache deliberately misses it
        leerFoto: async (id) => {
          window.__readFotoCalls++;
          return id === 'u-storage' ? photo : null;
        },
        hashDeDataUrl: async (bytes) => bytes === photo ? 'hash-storage' : null,
        guardarPorHash: async () => true,
        guardarFoto: async () => true,
        leerPorHash: async () => null
      };
      window.fetch = async (input, options = {}) => {
        const url = String(input);
        const method = options.method || 'GET';
        if (method === 'PUT') {
          window.__puts.push({ url, body: JSON.parse(options.body || '{}') });
          return new Response('{}', { status:200, headers:{'Content-Type':'application/json'} });
        }
        let body = [];
        if (url === '/api/ubicaciones') body = [{ id:'u-storage', nombre:'Storage shelf', tipo:'propio', activa:true, fotoHash:null }];
        else if (url === '/api/liquidaciones') body = [];
        else if (url === '/api/promotoras') body = [];
        else if (url === '/api/transferencias') body = [];
        return new Response(JSON.stringify(body), { status:200, headers:{'Content-Type':'application/json'} });
      };
    });

    await page.addScriptTag({ path: path.resolve(__dirname, '../docs/core/shelf-photo-policy.js') });
    await page.addScriptTag({ path: path.resolve(__dirname, '../docs/application/recover-shelf-photo.js') });
    await page.addScriptTag({ path: path.resolve(__dirname, '../docs/vista-perchas.js') });
    await page.evaluate(() => window.VPerchas.cargar());

    const out = await page.evaluate(() => ({
      img: document.querySelector('#vp-grid img')?.getAttribute('src') || null,
      calls: window.__readFotoCalls,
      puts: window.__puts.slice()
    }));
    assert.equal(out.img, 'data:image/png;base64,U1RPUkFHRS1QT1JULUZBTExCQUNL');
    assert.ok(out.calls >= 1, 'adapter must consult the storage port when render cache is incomplete');
    assert.deepEqual(out.puts, [{ url:'/api/ubicaciones/u-storage', body:{ fotoHash:'hash-storage' } }]);
  } finally {
    await browser.close();
  }
});
