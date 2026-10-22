const { test } = require('node:test');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const path = require('node:path');

test('Shelves render before photo work and ignore stale photo completions', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent('<!doctype html><html><body><section id="vista-perchas" class="activa"><div id="vp-orden"></div><div id="vp-grid"></div><div id="vp-transfers"></div></section></body></html>');
    await page.evaluate(() => {
      window.t = (k) => ({
        'shelves.noRacksYet':'No shelves yet','shelves.noTarget':'No target',
        'shelves.ofTargetMet':'% target','shelves.monthlySales':'Monthly sales',
        'shelves.target':'Target','shelves.commission':'Commission',
        'shelves.promoter':'Promoter','shelves.open':'Open',
        'shelves.transfersHeading':'Transfers','shelves.addRackBtn':'Add shelf'
      }[k] || k);
      window.OCI18n = { locale: () => 'en-US' };
      window.OCMoneda = { codigo: () => 'USD' };
      window.OCAuth = { rolActual: () => 'admin', puedeGestionar: () => true };
      window.OCBusinessReadModel = {
        day: () => '2026-10-01',
        businessResult: () => ({ netCents: 1234, artistShareCents: 456 })
      };
      const oldPhoto = 'data:image/png;base64,b2xk';
      const newPhoto = 'data:image/png;base64,bmV3';
      const stalePhoto = 'data:image/png;base64,c3RhbGU=';
      window.__migrationCalls = 0;
      window.__readCalls = 0;
      window.__shelfCalls = 0;
      window.__recoveries = 0;
      window.__recoveryDone = 0;
      window.__pointerWrites = [];
      window.__releaseFirstMigration = null;
      window.__resolveRecovery = [];
      window.OCFotos = {
        migrarSiHaceFalta: () => {
          if (++window.__migrationCalls !== 1) return Promise.resolve();
          return new Promise((resolve) => { window.__releaseFirstMigration = resolve; });
        },
        blindarEvidencia: async () => ({}),
        leerTodas: async () => (++window.__readCalls === 1 ? { 'same-shelf': oldPhoto } : { 'same-shelf': newPhoto })
      };
      window.F123Application = {
        recoverShelfPhoto: (u, ports) => {
          const call = window.__recoveries++;
          const pending = new Promise((resolve) => {
            window.__resolveRecovery[call] = () => resolve({
              displayBytes: stalePhoto, pointerChanged: true, pointerHash: 'stale-hash'
            });
          });
          return pending.then(async (result) => {
            await ports.setPointer(u.id, result.pointerHash);
            window.__recoveryDone++;
            return result;
          });
        }
      };
      window.fetch = async (input, options = {}) => {
        const url = String(input);
        if ((options.method || 'GET') === 'PUT') {
          window.__pointerWrites.push({ url, body: JSON.parse(options.body || '{}') });
          return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        let body = [];
        if (url === '/api/ubicaciones') {
          window.__shelfCalls++;
          body = [{ id: 'same-shelf', nombre: window.__shelfCalls === 1 ? 'Initial shelf' : 'Updated shelf', tipo: 'propio', activa: true, metaMensual: 0 }];
        } else if (url === '/api/reporting/corte') {
          body = { schema: 1, ventas: [], ajustesComision: [] };
        }
        return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
      };
    });

    await page.addScriptTag({ path: path.resolve(__dirname, '../docs/vista-perchas.js') });
    await page.evaluate(() => { window.__firstShelfLoad = window.VPerchas.cargar(); });
    await page.waitForFunction(() => document.getElementById('vp-grid').textContent.includes('Initial shelf'), {}, { timeout: 2000 });
    await page.waitForFunction(() => window.__recoveries === 1);
    const first = await page.evaluate(() => ({
      text: document.getElementById('vp-grid').textContent,
      photo: document.querySelector('#vp-grid img')?.getAttribute('src') || null,
      migrationPending: window.__migrationCalls === 1 && window.__readCalls === 0
    }));
    assert.match(first.text, /Initial shelf/);
    assert.match(first.text, /\$12\.34/);
    assert.equal(first.photo, null);
    assert.equal(first.migrationPending, true);

    await page.evaluate(() => window.__releaseFirstMigration());
    await page.waitForFunction(() => document.querySelector('#vp-grid img')?.getAttribute('src') === 'data:image/png;base64,b2xk');
    await page.evaluate(() => window.VPerchas.cargar());
    await page.waitForFunction(() => window.__recoveries === 2 && document.querySelector('#vp-grid img')?.getAttribute('src') === 'data:image/png;base64,bmV3');

    await page.evaluate(() => window.__resolveRecovery[0]());
    await page.waitForFunction(() => window.__recoveryDone === 1);
    const latest = await page.evaluate(() => ({
      text: document.getElementById('vp-grid').textContent,
      photo: document.querySelector('#vp-grid img')?.getAttribute('src') || null,
      pointerWrites: window.__pointerWrites
    }));
    assert.match(latest.text, /Updated shelf/);
    assert.match(latest.text, /\$12\.34/);
    assert.equal(latest.photo, 'data:image/png;base64,bmV3');
    assert.deepEqual(latest.pointerWrites, []);
  } finally {
    await browser.close();
  }
});


test('E6: photo recovery shows a delayed accessible hint and removes it when ready or photographed', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent('<section id="vista-perchas" class="activa"><div id="vp-orden"></div><div id="vp-grid"></div><div id="vp-transfers"></div></section>');
    await page.evaluate(() => {
      window.t = key => ({'shelves.noTarget':'No target','shelves.ofTargetMet':'% target',
        'shelves.monthlySales':'Monthly sales','shelves.target':'Target',
        'shelves.commission':'Commission','shelves.promoter':'Promoter',
        'shelves.open':'Open','shelves.transfersHeading':'Transfers'}[key] || key);
      window.OCI18n = { locale: () => 'en-US' };
      window.OCMoneda = { codigo: () => 'USD' };
      window.OCAuth = { puedeGestionar: () => false, rolActual: () => 'admin' };
      window.OCYjs = { fotosCanal: { recuperando: true } };
      window.OCFotos = { migrarSiHaceFalta: async () => {},
        leerTodas: async () => window.__photo ? {'shelf-e6': window.__photo} : {} };
      window.F123Application = { recoverShelfPhoto: async () => null };
      window.fetch = async input => {
        const body = String(input).endsWith('/ubicaciones')
          ? [{id:'shelf-e6',nombre:'Example shelf',activa:true,tipo:'propio'}] : [];
        return new Response(JSON.stringify(body),{status:200,headers:{'Content-Type':'application/json'}});
      };
    });
    await page.addScriptTag({path:path.resolve(__dirname,'../docs/vista-perchas.js')});
    await page.evaluate(() => window.VPerchas.cargar());
    const visual = '#vp-grid [data-vp-foto-visual="shelf-e6"]';
    await page.waitForFunction(sel => !!document.querySelector(sel), visual);
    assert.doesNotMatch(await page.locator(visual).innerText(), /Loading photo/);
    await page.waitForTimeout(3400);
    assert.match(await page.locator(visual).innerText(), /Loading photo/);
    await page.evaluate(() => { window.OCYjs.fotosCanal.recuperando = false; });
    await page.waitForFunction(sel => !/Loading photo/.test(document.querySelector(sel)?.textContent || ''), visual);
    await page.evaluate(() => {window.__photo = 'data:image/png;base64,Zm90bw==';window.VPerchas.cargar();});
    await page.waitForFunction(sel => document.querySelector(sel)?.tagName === 'IMG', visual);
    assert.equal(await page.locator(visual).getAttribute('src'), 'data:image/png;base64,Zm90bw==');
  } finally { await browser.close(); }
});
