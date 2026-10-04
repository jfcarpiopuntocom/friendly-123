const { test } = require('node:test');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const path = require('node:path');

test('G06 Recovery Vault shows all preserved photos and preselects exact historical shelf matches', async () => {
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
      window.__F123_DIAG_PHOTO_VAULT = true;
      window.OCAuth = { puedeGestionar: () => true, rolActual: () => 'owner' };
      const orphan='data:image/png;base64,T1JQSEFO';
      const referenced='data:image/png;base64,UkVGRVJFTkNFRA==';
      window.__idPhotos = {};
      window.__puts = [];
      window.__shelves = [
        { id:'u1', nombre:'Shelf One', tipo:'propio', activa:true, fotoHash:null },
        { id:'u2', nombre:'Shelf Two', tipo:'propio', activa:true, fotoHash:'hash-ref' }
      ];
      window.OCFotos = {
        migrarSiHaceFalta: async()=>{},
        blindarEvidencia: async()=>({}),
        leerTodas: async()=>({...window.__idPhotos}),
        leerTodosPorHash: async()=>({'hash-orphan':orphan,'hash-ref':referenced}),
        leerPorHash: async(h)=>h==='hash-orphan'?orphan:(h==='hash-ref'?referenced:null),
        guardarFoto: async(id,d)=>{ window.__idPhotos[id]=d; return true; },
        guardarFotoContenido: async()=>null,
        guardarPorHash: async()=>true,
        hashDeDataUrl: async()=>null
      };
      window.OCSync = { catalogoPropio: () => ({ ubicaciones:window.__shelves.map(x=>({...x})), productos:[] }) };
      window.OCYjs = {
        get: () => ({u2:{id:'u2',fotoHash:'hash-ref'}}),
        fotosMap: new Map(),
        historialFotosPorPercha: async()=>({u1:['hash-orphan'],u2:['hash-ref']})
      };
      window.fetch = async (input, options={}) => {
        const url=String(input), m=options.method||'GET';
        if(m==='PUT'){ window.__puts.push({url,body:JSON.parse(options.body||'{}')}); return new Response('{}',{status:200}); }
        let body=[];
        if(url==='/api/ubicaciones') body=window.__shelves.map(x=>({...x}));
        else if(url==='/api/liquidaciones'||url==='/api/promotoras'||url==='/api/transferencias'||url==='/api/ventas/todas') body=[];
        return new Response(JSON.stringify(body),{status:200,headers:{'Content-Type':'application/json'}});
      };
    });

    await page.addScriptTag({ path: path.resolve(__dirname, '../docs/core/shelf-photo-policy.js') });
    await page.addScriptTag({ path: path.resolve(__dirname, '../docs/application/recover-shelf-photo.js') });
    await page.addScriptTag({ path: path.resolve(__dirname, '../docs/vista-perchas.js') });
    await page.evaluate(() => window.VPerchas.cargar());

    assert.equal(await page.locator('#vp-photo-vault img').count(), 2,
      'referenced evidence must remain visible alongside unlinked evidence');
    const txt = await page.locator('#vp-photo-vault').textContent();
    assert.match(txt, /2 preserved/);
    assert.match(txt, /1 unlinked/);
    assert.match(txt, /1 referenced somewhere/);
    assert.match(txt, /Exact local history: Shelf One/);

    const selected = await page.locator('[data-vault-shelf="hash-orphan"]').inputValue();
    assert.equal(selected, 'u1', 'exact historical shelf match should be preselected');
    assert.equal(await page.evaluate(() => window.__puts.length), 1,
      'G05 exact auto-recovery may restore the missing shelf before the Vault renders');
    // The referenced hash still has to be visible even though it is not orphaned.
    assert.equal(await page.locator('[data-vault-shelf="hash-ref"]').count(), 1);
  } finally {
    await browser.close();
  }
});
