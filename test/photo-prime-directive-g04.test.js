const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

test('Prime Directive 1AAA: photo persistence is append-only/copy-only', () => {
  const idb = read('docs/idb-fotos.js');
  const vp = read('docs/vista-perchas.js');

  assert.doesNotMatch(idb, /objectStore\(STORE\)\.delete\(id\)/);
  assert.doesNotMatch(idb, /localStorage\.removeItem\(claveVieja\(id\)\)/);
  assert.doesNotMatch(idb, /if \(ok\) localStorage\.removeItem\(k\)/);
  assert.match(idb, /Prime Directive: foto preservada/);
  assert.match(idb, /async function blindarEvidencia/);
  assert.match(idb, /async function inventariarEvidencia/);

  assert.doesNotMatch(vp, /OCFotos\.borrarFoto\(perchaGestionId\)/);
  assert.doesNotMatch(vp, /delete fotoCache\[perchaGestionId\]/);
  assert.match(vp, /Photo Recovery Vault/);
  assert.match(vp, /Restore photo/);
  assert.match(vp, /window\.OCYjs\.get\('ubicaciones'\)/);
});

test('Photo Recovery Vault does not assign an orphan until explicit restore click', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent('<!doctype html><html><body><section id="vista-perchas" class="activa"><div id="vp-orden"></div><div id="vp-grid"></div><div id="vp-transfers"></div></section></body></html>');
    await page.evaluate(() => {
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
      window.OCAuth = { puedeGestionar: () => true };
      window.__byId = {};
      window.__puts = [];
      window.__shelf = { id:'u1', nombre:'Shelf One', tipo:'propio', activa:true, fotoHash:null };
      const orphan = 'data:image/png;base64,T1JQSEFOLVBIT1RP';
      window.OCFotos = {
        migrarSiHaceFalta: async()=>{},
        blindarEvidencia: async()=>({}),
        leerTodas: async()=>({...window.__byId}),
        leerTodosPorHash: async()=>({'orphan-hash': orphan}),
        leerPorHash: async(h)=>h==='orphan-hash'?orphan:null,
        guardarFoto: async(id,d)=>{ window.__byId[id]=d; return true; },
        guardarFotoContenido: async()=>null,
        guardarPorHash: async()=>true,
        hashDeDataUrl: async()=>null
      };
      window.OCSync = { catalogoPropio: () => ({ ubicaciones:[{...window.__shelf}], productos:[] }) };
      window.OCYjs = { get: () => ({}), fotosMap: new Map() };
      window.fetch = async (input, options={}) => {
        const url=String(input), m=options.method||'GET';
        if(m==='PUT'){ window.__puts.push({url,body:JSON.parse(options.body||'{}')}); window.__shelf.fotoHash=window.__puts.at(-1).body.fotoHash; return new Response('{}',{status:200}); }
        let body=[];
        if(url==='/api/ubicaciones') body=[{...window.__shelf}];
        else if(url==='/api/liquidaciones'||url==='/api/promotoras'||url==='/api/transferencias'||url==='/api/ventas/todas') body=[];
        return new Response(JSON.stringify(body),{status:200,headers:{'Content-Type':'application/json'}});
      };
    });
    await page.addScriptTag({ path: path.join(root, 'docs/vista-perchas.js') });
    await page.evaluate(() => window.VPerchas.cargar());
    assert.equal(await page.locator('#vp-photo-vault img').count(), 1);
    assert.equal(await page.evaluate(() => window.__puts.length), 0, 'vault preview is read-only');

    await page.selectOption('[data-vault-shelf="orphan-hash"]', 'u1');
    await page.click('[data-vault-restore="orphan-hash"]');
    await page.waitForTimeout(100);
    const out = await page.evaluate(() => ({ puts: window.__puts, saved: window.__byId.u1 || null }));
    assert.equal(out.puts.length, 1);
    assert.equal(out.puts[0].body.fotoHash, 'orphan-hash');
    assert.equal(out.saved, 'data:image/png;base64,T1JQSEFOLVBIT1RP');
  } finally {
    await browser.close();
  }
});
