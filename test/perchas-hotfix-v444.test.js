const { test } = require('node:test');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const path = require('node:path');

test('Perchas hides archived shelves and read-repairs a synced photo already present in Yjs', async () => {
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
      const photo = 'data:image/png;base64,aG90Zml4LXBlcmNoYS1waG90bw==';
      window.__photo = photo;
      window.__requests = [];
      window.__repaired = [];

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
        leerTodas: async () => ({}),
        leerPorHash: async () => null,
        guardarPorHash: async (hash, data) => { window.__repaired.push([hash, data]); return true; }
      };
      window.OCYjs = {
        fotosMap: new Map([['hash-active', photo]])
      };
      window.fetch = async (input) => {
        const url = String(input);
        window.__requests.push(url);
        let body = [];
        if (url === '/api/ubicaciones') {
          body = [
            { id: 'u-active', nombre: 'Active shelf', tipo: 'socio', activa: true, fotoHash: 'hash-active' },
            { id: 'u-archived', nombre: 'Archived shelf', tipo: 'socio', activa: false, fotoHash: 'hash-old' }
          ];
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
      html: document.getElementById('vp-grid').innerHTML,
      text: document.getElementById('vp-grid').textContent,
      requests: window.__requests.slice(),
      repaired: window.__repaired.slice(),
      img: document.querySelector('#vp-grid img') && document.querySelector('#vp-grid img').getAttribute('src')
    }));

    assert.ok(result.requests.includes('/api/ubicaciones'), 'operational shelf view must request active shelves');
    assert.equal(result.requests.some((u) => u.includes('/api/ubicaciones?todas=1')), false, 'must not request archived shelves');
    assert.match(result.text, /Active shelf/);
    assert.doesNotMatch(result.text, /Archived shelf/);
    assert.equal(result.img, 'data:image/png;base64,aG90Zml4LXBlcmNoYS1waG90bw==');
    assert.deepEqual(result.repaired, [['hash-active', 'data:image/png;base64,aG90Zml4LXBlcmNoYS1waG90bw==']]);
  } finally {
    await browser.close();
  }
});
