/* v447 regression — a synced shelf photo that was displayed from its content hash
   must become durable under that shelf id too, so later pointer loss can self-heal. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const path = require('node:path');

test('v447: a previously displayed hash-only shelf photo survives later fotoHash pointer loss', async () => {
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
        leerTodas: async () => ({}),
        guardarFotoContenido: async () => null,
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
