const { test } = require('node:test');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const path = require('node:path');

test('G05 vault shows both orphan and referenced preserved photo evidence; restore stays explicit', async () => {
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
      const a='data:image/png;base64,T1JQSEFO';
      const b='data:image/png;base64,UkVGRVJFTkNFRA==';
      window.__byId = {};
      window.__puts = [];
      window.__shelves = [
        { id:'u1', nombre:'Shelf One', tipo:'propio', activa:true, fotoHash:null },
        { id:'u2', nombre:'Shelf Two', tipo:'propio', activa:true, fotoHash:'hash-ref' }
      ];
      window.OCFotos = {
        migrarSiHaceFalta: async()=>{},
        blindarEvidencia: async()=>({}),
        leerTodas: async()=>({...window.__byId}),
        leerTodosPorHash: async()=>({'hash-orphan':a,'hash-ref':b}),
        leerPorHash: async(h)=>h==='hash-orphan'?a:(h==='hash-ref'?b:null),
        guardarFoto: async(id,d)=>{ window.__byId[id]=d; return true; },
        guardarFotoContenido: async()=>null,
        guardarPorHash: async()=>true,
        hashDeDataUrl: async()=>null
      };
      window.OCSync = { catalogoPropio: () => ({ ubicaciones:window.__shelves.map(x=>({...x})), productos:[] }) };
      window.OCYjs = { get: () => ({u2:{id:'u2',fotoHash:'hash-ref'}}), fotosMap: new Map() };
      window.fetch = async (input, options={}) => {
        const url=String(input), m=options.method||'GET';
        if(m==='PUT'){ window.__puts.push({url,body:JSON.parse(options.body||'{}')}); return new Response('{}',{status:200}); }
        let body=[];
        if(url==='/api/ubicaciones') body=window.__shelves.map(x=>({...x}));
        else if(url==='/api/liquidaciones'||url==='/api/promotoras'||url==='/api/transferencias'||url==='/api/ventas/todas') body=[];
        return new Response(JSON.stringify(body),{status:200,headers:{'Content-Type':'application/json'}});
      };
    });

    await page.addScriptTag({ path: path.resolve(__dirname, '../docs/vista-perchas.js') });
    await page.evaluate(() => window.VPerchas.cargar());

    assert.equal(await page.locator('#vp-photo-vault img').count(), 2,
      'all preserved blobs must be visible, not only unreferenced ones');
    const txt = await page.locator('#vp-photo-vault').textContent();
    assert.match(txt, /2 preserved/);
    assert.match(txt, /1 unlinked/);
    assert.match(txt, /1 referenced/);
    assert.equal(await page.evaluate(() => window.__puts.length), 0,
      'opening the vault must never change shelf pointers');

    await page.selectOption('[data-vault-shelf="hash-orphan"]','u1');
    await page.click('[data-vault-restore="hash-orphan"]');
    await page.waitForTimeout(80);
    const out=await page.evaluate(()=>({puts:window.__puts.slice(),saved:window.__byId.u1||null}));
    assert.equal(out.puts.length,1);
    assert.equal(out.puts[0].body.fotoHash,'hash-orphan');
    assert.equal(out.saved,'data:image/png;base64,T1JQSEFO');
  } finally {
    await browser.close();
  }
});
