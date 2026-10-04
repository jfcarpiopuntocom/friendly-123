const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const FILES = {
  '/photo-policy.js': 'docs/core/shelf-photo-policy.js',
  '/recover-photo.js': 'docs/application/recover-shelf-photo.js',
  '/vista-perchas.js': 'docs/vista-perchas.js'
};

async function withPage(fn) {
  const server = http.createServer((req, res) => {
    const p = FILES[req.url];
    if (p) {
      res.writeHead(200, { 'Content-Type':'application/javascript' });
      res.end(fs.readFileSync(path.join(ROOT, p), 'utf8'));
      return;
    }
    res.writeHead(200, { 'Content-Type':'text/html' });
    res.end('<!doctype html><html><body></body></html>');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ headless:true });
  try {
    const page = await browser.newPage();
    await page.goto('http://127.0.0.1:' + server.address().port + '/', { waitUntil:'domcontentloaded' });
    await page.setContent('<!doctype html><html><body><section id="vista-perchas" class="activa"><div id="vp-orden"></div><div id="vp-grid"></div><div id="vp-transfers"></div><div id="vp-photo-vault">OLD G06 VAULT</div></section></body></html>');
    return await fn(page);
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

async function load(page) {
  await page.addScriptTag({ url:'/photo-policy.js' });
  await page.addScriptTag({ url:'/recover-photo.js' });
  await page.addScriptTag({ url:'/vista-perchas.js' });
  await page.evaluate(() => VPerchas.cargar());
}

test('G08: checksummed local checkpoint restores exact shelf hash and normal Shelves never shows the Vault', async () => {
  await withPage(async (page) => {
    await page.evaluate(() => {
      const shelfPhoto = 'data:image/png;base64,U0hFTEYtUEhPVE8=';
      const productPhoto = 'data:image/png;base64,UFJPRFVDVC1QSE9UTw==';
      window.__shelfPhoto = shelfPhoto;
      window.__productPhoto = productPhoto;
      window.__puts = [];
      window.__savedById = {};
      window.__shelf = { id:'shelf-1', nombre:'Front shelf', tipo:'socio', activa:true, fotoHash:null };

      const contenido = JSON.stringify({
        fecha:'2026-10-01T12:00:00.000Z',
        datos:{
          ubicaciones:[{ id:'shelf-1', nombre:'Front shelf', tipo:'socio', activa:true, fotoHash:'hash-shelf-old' }],
          productos:[{ id:'p-real', nombre:'Product', fotoHash:'hash-product' }]
        }
      });
      localStorage.setItem('f123_caja_snapshots', JSON.stringify([
        { fecha:'2026-10-01T12:00:00.000Z', contenido, checksum:'checksum-ok' }
      ]));

      window.OCSecure = { hashTexto: async () => 'checksum-ok' };
      window.t = (k) => ({
        'shelves.noRacksYet':'No shelves yet','shelves.noTarget':'No target','shelves.ofTargetMet':'% target',
        'shelves.monthlySales':'Monthly sales','shelves.target':'Target','shelves.commission':'Commission',
        'shelves.promoter':'Promoter','shelves.open':'Open','shelves.transfersHeading':'Transfers',
        'shelves.addRackBtn':'Add shelf'
      }[k] || k);
      window.OCI18n = { locale:()=>'en-US' };
      window.OCMoneda = { codigo:()=> 'USD' };
      window.OCAuth = { puedeGestionar:()=>false, rolActual:()=> 'owner' };
      window.OCFotos = {
        migrarSiHaceFalta:async()=>{},
        blindarEvidencia:async()=>({}),
        leerTodas:async()=>({}),
        leerFoto:async()=>null,
        leerTodosPorHash:async()=>({
          'hash-shelf-old':shelfPhoto,
          'hash-product':productPhoto
        }),
        leerPorHash:async(h)=>h==='hash-shelf-old'?shelfPhoto:(h==='hash-product'?productPhoto:null),
        guardarPorHash:async()=>true,
        guardarFoto:async(id,d)=>{ window.__savedById[id]=d; return true; },
        hashDeDataUrl:async()=>null
      };
      window.OCSync = {
        catalogoPropio:()=>({
          ubicaciones:[{...window.__shelf}],
          productos:[{id:'p-real',nombre:'Product',fotoHash:'hash-product'}]
        })
      };
      window.OCYjs = {
        get:(col)=> col==='ubicaciones'
          ? {'shelf-1':{...window.__shelf}}
          : (col==='productos'?{'p-real':{id:'p-real',fotoHash:'hash-product'}}:{}),
        historialFotosPorPercha:async()=>({}),
        fotosMap:{ get:()=>null }
      };
      window.fetch = async (input, options={}) => {
        const url=String(input), method=options.method||'GET';
        if(method==='PUT'){
          const body=JSON.parse(options.body||'{}');
          window.__puts.push({url,body});
          if(body.fotoHash) window.__shelf.fotoHash=body.fotoHash;
          return new Response(JSON.stringify(window.__shelf),{status:200,headers:{'Content-Type':'application/json'}});
        }
        let body=[];
        if(url==='/api/ubicaciones') body=[{...window.__shelf}];
        else if(url==='/api/liquidaciones'||url==='/api/promotoras'||url==='/api/transferencias'||url==='/api/ventas/todas') body=[];
        return new Response(JSON.stringify(body),{status:200,headers:{'Content-Type':'application/json'}});
      };
    });

    await load(page);
    const out = await page.evaluate(() => ({
      pointer:window.__shelf.fotoHash,
      puts:window.__puts.slice(),
      img:document.querySelector('#vp-grid img')?.getAttribute('src')||null,
      saved:window.__savedById['shelf-1']||null,
      vault:document.getElementById('vp-photo-vault')
    }));

    assert.equal(out.pointer,'hash-shelf-old');
    assert.ok(out.puts.some(x=>x.body.fotoHash==='hash-shelf-old'),
      'the exact shelf mapping from the valid checkpoint is reattached');
    assert.equal(out.img,'data:image/png;base64,U0hFTEYtUEhPVE8=');
    assert.equal(out.saved,out.img,'recovered bytes are copied back under the exact shelf id');
    assert.equal(out.vault,null,'normal My Shelves removes the old G06 Vault instead of rendering it');
    assert.ok(!out.puts.some(x=>x.body.fotoHash==='hash-product'),
      'a product photo hash is never assigned to the shelf');
  });
});

test('G08: product-only photo evidence cannot become a shelf photo', async () => {
  await withPage(async (page) => {
    await page.evaluate(() => {
      const productPhoto='data:image/png;base64,UFJPRFVDVC1PTkxZ';
      window.__puts=[];
      window.__shelf={id:'shelf-no-photo',nombre:'No photo shelf',tipo:'socio',activa:true,fotoHash:null};
      const contenido=JSON.stringify({
        fecha:'2026-10-01T12:00:00.000Z',
        datos:{
          ubicaciones:[{id:'shelf-no-photo',nombre:'No photo shelf',tipo:'socio',activa:true,fotoHash:null}],
          productos:[{id:'p1',nombre:'Product',fotoHash:'hash-product-only'}]
        }
      });
      localStorage.setItem('f123_caja_snapshots',JSON.stringify([
        {fecha:'2026-10-01T12:00:00.000Z',contenido,checksum:'ok'}
      ]));
      window.OCSecure={hashTexto:async()=> 'ok'};
      window.t=(k)=>({'shelves.noRacksYet':'No shelves yet','shelves.noTarget':'No target','shelves.ofTargetMet':'% target','shelves.monthlySales':'Monthly sales','shelves.target':'Target','shelves.commission':'Commission','shelves.promoter':'Promoter','shelves.open':'Open','shelves.transfersHeading':'Transfers','shelves.addRackBtn':'Add shelf'}[k]||k);
      window.OCI18n={locale:()=> 'en-US'}; window.OCMoneda={codigo:()=> 'USD'}; window.OCAuth={puedeGestionar:()=>false,rolActual:()=> 'owner'};
      window.OCFotos={
        migrarSiHaceFalta:async()=>{}, blindarEvidencia:async()=>({}), leerTodas:async()=>({}), leerFoto:async()=>null,
        leerTodosPorHash:async()=>({'hash-product-only':productPhoto}),
        leerPorHash:async(h)=>h==='hash-product-only'?productPhoto:null,
        guardarPorHash:async()=>true, guardarFoto:async()=>true, hashDeDataUrl:async()=>null
      };
      window.OCSync={catalogoPropio:()=>({ubicaciones:[{...window.__shelf}],productos:[{id:'p1',fotoHash:'hash-product-only'}]})};
      window.OCYjs={get:(col)=>col==='productos'?{'p1':{id:'p1',fotoHash:'hash-product-only'}}:{'shelf-no-photo':{...window.__shelf}},historialFotosPorPercha:async()=>({}),fotosMap:{get:()=>null}};
      window.fetch=async(input,options={})=>{
        const url=String(input),method=options.method||'GET';
        if(method==='PUT'){window.__puts.push({url,body:JSON.parse(options.body||'{}')});return new Response('{}',{status:200});}
        let body=[]; if(url==='/api/ubicaciones') body=[{...window.__shelf}];
        else if(url==='/api/liquidaciones'||url==='/api/promotoras'||url==='/api/transferencias'||url==='/api/ventas/todas') body=[];
        return new Response(JSON.stringify(body),{status:200,headers:{'Content-Type':'application/json'}});
      };
    });
    await load(page);
    const out=await page.evaluate(()=>({
      puts:window.__puts.slice(),
      img:document.querySelector('#vp-grid img')?.getAttribute('src')||null,
      vault:document.getElementById('vp-photo-vault')
    }));
    assert.deepEqual(out.puts,[],'product-only evidence cannot set a shelf pointer');
    assert.equal(out.img,null);
    assert.equal(out.vault,null);
  });
});
