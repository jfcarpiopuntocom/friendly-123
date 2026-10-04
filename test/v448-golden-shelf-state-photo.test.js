const { test } = require('node:test');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const path = require('node:path');
const { browser } = require('./helpers/browser.cjs');

function later(rev, device) {
  return { c: Math.max(1, Number(rev && rev.c) || 0) + 1000, d: device };
}

test('v448 golden RED: unrelated newer legacy shelf edit cannot reactivate an archived shelf', async () => {
  const w = browser();
  const shelf = await w.request('/api/ubicaciones', 'POST', { nombre: 'Keep archived', tipo: 'propio' });
  const stalePeer = w.catalog();
  await w.request('/api/ubicaciones/' + shelf.id + '/desactivar', 'POST');

  const archived = (await w.request('/api/respaldo/exportar')).ubicaciones.find(x => x.id === shelf.id);
  assert.equal(archived.activa, false, 'fixture must really be archived');

  const remote = stalePeer.ubicaciones.find(x => x.id === shelf.id);
  remote.nombre = 'Unrelated rename from stale peer';
  remote.activa = true;
  remote.borrado = false;
  remote.rev = later(archived.rev, 'stale-peer-with-big-counter');

  w.OCSync.aplicarCatalogo(stalePeer, null);

  const after = (await w.request('/api/respaldo/exportar')).ubicaciones.find(x => x.id === shelf.id);
  assert.equal(after.activa, false, 'a general rev from a stale peer must not resurrect archived state');
});

test('v448 golden RED: unrelated newer legacy shelf edit cannot clear a shelf tombstone', async () => {
  const w = browser();
  await w.request('/api/ubicaciones', 'POST', { nombre: 'Other shelf', tipo: 'propio' });
  const shelf = await w.request('/api/ubicaciones', 'POST', { nombre: 'Delete me', tipo: 'propio' });
  const stalePeer = w.catalog();

  await w.request('/api/ubicaciones/' + shelf.id, 'DELETE');
  const deleted = (await w.request('/api/respaldo/exportar')).ubicaciones.find(x => x.id === shelf.id);
  assert.equal(deleted.borrado, true, 'fixture must really have a tombstone');
  assert.equal(deleted.activa, false);

  const remote = stalePeer.ubicaciones.find(x => x.id === shelf.id);
  remote.nombre = 'Stale peer edited this after missing the delete';
  remote.activa = true;
  remote.borrado = false;
  remote.rev = later(deleted.rev, 'stale-peer-with-big-counter');

  w.OCSync.aplicarCatalogo(stalePeer, null);

  const after = (await w.request('/api/respaldo/exportar')).ubicaciones.find(x => x.id === shelf.id);
  assert.equal(after.borrado, true, 'a tombstone is state, not an unrelated general field');
  assert.equal(after.activa, false, 'deleted shelf cannot become operational again');
});

test('v448 golden RED: a hash-resolved synced shelf photo is mirrored durably under the exact shelf id', async () => {
  const browserInstance = await chromium.launch({ headless: true });
  try {
    const page = await browserInstance.newPage();
    await page.setContent('<!doctype html><html><body><section id="vista-perchas" class="activa"><div id="vp-orden"></div><div id="vp-grid"></div><div id="vp-transfers"></div></section></body></html>');
    await page.evaluate(() => {
      const photo = 'data:image/png;base64,Z29sZGVuLTQ0OC1waG90bw==';
      window.__photo = photo;
      window.__idWrites = [];
      window.t = k => ({
        'shelves.noRacksYet':'No shelves yet','shelves.noTarget':'No target','shelves.ofTargetMet':'% target',
        'shelves.monthlySales':'Monthly sales','shelves.target':'Target','shelves.commission':'Commission',
        'shelves.promoter':'Promoter','shelves.open':'Open','shelves.transfersHeading':'Transfers',
        'shelves.addRackBtn':'Add shelf'
      }[k] || k);
      window.OCI18n = { locale: () => 'en-US' };
      window.OCMoneda = { codigo: () => 'USD' };
      window.OCAuth = { puedeGestionar: () => false };
      window.OCFotos = {
        migrarSiHaceFalta: async () => {},
        leerTodas: async () => ({}),
        leerPorHash: async h => h === 'hash-current' ? photo : null,
        guardarPorHash: async () => true,
        guardarFoto: async (id, data) => { window.__idWrites.push([id, data]); return true; }
      };
      window.fetch = async input => {
        const url = String(input);
        let body = [];
        if (url === '/api/ubicaciones') body = [{ id:'u-photo', nombre:'Photo shelf', tipo:'propio', activa:true, fotoHash:'hash-current' }];
        else if (url === '/api/liquidaciones' || url === '/api/promotoras' || url === '/api/transferencias') body = [];
        return new Response(JSON.stringify(body), { status:200, headers:{'Content-Type':'application/json'} });
      };
    });
    await page.addScriptTag({ path: path.resolve(__dirname, '../docs/vista-perchas.js') });
    await page.evaluate(() => window.VPerchas.cargar());
    const out = await page.evaluate(() => ({
      img: document.querySelector('#vp-grid img')?.getAttribute('src') || null,
      idWrites: window.__idWrites.slice()
    }));
    assert.equal(out.img, 'data:image/png;base64,Z29sZGVuLTQ0OC1waG90bw==', 'photo must be visible first');
    assert.deepEqual(out.idWrites, [['u-photo','data:image/png;base64,Z29sZGVuLTQ0OC1waG90bw==']],
      'the exact displayed bytes must also be persisted under the same shelf id');
  } finally {
    await browserInstance.close();
  }
});
