const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');

const PHOTO_FILES = {
  '/photo-policy.js': 'docs/core/shelf-photo-policy.js',
  '/recover-photo.js': 'docs/application/recover-shelf-photo.js',
  '/vista-perchas.js': 'docs/vista-perchas.js'
};

async function loadPhotoStack(page) {
  await page.addScriptTag({ url: '/photo-policy.js' });
  await page.addScriptTag({ url: '/recover-photo.js' });
  await page.addScriptTag({ url: '/vista-perchas.js' });
}

async function serverFor(files, fn) {
  const server = http.createServer((req, res) => {
    const p = files[req.url];
    if (p) {
      res.writeHead(200, { 'Content-Type': 'application/javascript' });
      res.end(fs.readFileSync(path.join(ROOT, p), 'utf8'));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end('<!doctype html><html><body></body></html>');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.goto('http://127.0.0.1:' + server.address().port + '/', { waitUntil: 'domcontentloaded' });
    return await fn(page);
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

test('G05: read-only Yjs replay recovers an old shelf->photoHash mapping after current pointer became null', async () => {
  await serverFor({
    '/yjs.js': 'docs/vendor/yjs-bundle.min.js',
    '/sync-yjs.js': 'docs/sync-yjs.js'
  }, async (page) => {
    await page.addScriptTag({ url: '/yjs.js' });
    await page.addScriptTag({ url: '/sync-yjs.js' });
    const out = await page.evaluate(async () => {
      const updates = [];
      const d = new Y.Doc();
      d.on('update', (u) => updates.push(new Uint8Array(u)));
      const m = d.getMap('ubicaciones');
      m.set('shelf-old', { id: 'shelf-old', nombre: 'Old shelf', fotoHash: 'hash-old-exact' });
      m.set('shelf-old', { id: 'shelf-old', nombre: 'Old shelf', fotoHash: null });

      const name = 'g05-hist-' + Date.now() + '-' + Math.random();
      const db = await new Promise((resolve, reject) => {
        const req = indexedDB.open(name, 1);
        req.onupgradeneeded = () => req.result.createObjectStore('updates', { autoIncrement: true });
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      await new Promise((resolve, reject) => {
        const tx = db.transaction('updates', 'readwrite');
        const store = tx.objectStore('updates');
        updates.forEach((u) => store.add(u));
        tx.oncomplete = resolve; tx.onerror = () => reject(tx.error);
      });

      OCYjs.idb = { db };
      OCYjs.mapas.ubicaciones = new Y.Doc().getMap('ubicaciones');
      const before = await new Promise((resolve, reject) => {
        const tx = db.transaction('updates', 'readonly');
        const req = tx.objectStore('updates').count();
        req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error);
      });
      const hist = await OCYjs.historialFotosPorPercha();
      const after = await new Promise((resolve, reject) => {
        const tx = db.transaction('updates', 'readonly');
        const req = tx.objectStore('updates').count();
        req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error);
      });
      return { hist, before, after, current: OCYjs.mapas.ubicaciones.get('shelf-old') || null };
    });
    assert.deepEqual(out.hist['shelf-old'], ['hash-old-exact']);
    assert.equal(out.before, out.after, 'forensic reader never writes/deletes Yjs updates');
    assert.equal(out.current, null, 'isolated replay never changes live Yjs map');
  });
});

async function shelfPage(setup) {
  return serverFor(PHOTO_FILES, async (page) => {
    await page.setContent('<!doctype html><html><body><section id="vista-perchas" class="activa"><div id="vp-orden"></div><div id="vp-grid"></div><div id="vp-transfers"></div></section></body></html>');
    await page.evaluate(setup);
    await loadPhotoStack(page);
    await page.evaluate(() => VPerchas.cargar());
    return page;
  });
}

test('G05: pointerless shelf auto-recovers only from its exact historical hash when bytes survive', async () => {
  await serverFor(PHOTO_FILES, async (page) => {
    await page.setContent('<!doctype html><html><body><section id="vista-perchas" class="activa"><div id="vp-orden"></div><div id="vp-grid"></div><div id="vp-transfers"></div></section></body></html>');
    await page.evaluate(() => {
      const photo = 'data:image/png;base64,RzA1LUhJU1RPUlk=';
      window.__photo = photo; window.__puts = [];
      window.__shelf = { id: 'u-history', nombre: 'Recovered historical shelf', tipo: 'propio', activa: true, fotoHash: null };
      window.t = (k) => ({
        'shelves.noRacksYet':'No shelves yet','shelves.noTarget':'No target','shelves.ofTargetMet':'% target',
        'shelves.monthlySales':'Monthly sales','shelves.target':'Target','shelves.commission':'Commission',
        'shelves.promoter':'Promoter','shelves.open':'Open','shelves.transfersHeading':'Transfers',
        'shelves.addRackBtn':'Add shelf'
      }[k] || k);
      window.OCI18n = { locale: () => 'en-US' }; window.OCMoneda = { codigo: () => 'USD' };
      window.OCAuth = { puedeGestionar: () => false };
      window.OCFotos = {
        migrarSiHaceFalta: async () => {}, leerTodas: async () => ({}),
        leerTodosPorHash: async () => ({ 'hash-history': photo }),
        leerPorHash: async (h) => h === 'hash-history' ? photo : null,
        guardarPorHash: async () => true, guardarFoto: async () => true,
        guardarFotoContenido: async () => 'unused', hashDeDataUrl: async () => 'unused'
      };
      window.OCSync = { catalogoPropio: () => ({ ubicaciones:[{...window.__shelf}], productos:[] }) };
      window.OCYjs = {
        get: () => ({ 'u-history': { ...window.__shelf } }),
        historialFotosPorPercha: async () => ({ 'u-history':['hash-history'] }),
        fotosMap: { get: () => null }
      };
      window.fetch = async (input, options={}) => {
        const url=String(input), method=options.method||'GET';
        if (method === 'PUT') {
          const body=JSON.parse(options.body||'{}'); window.__puts.push({url,body});
          if (body.fotoHash) window.__shelf.fotoHash=body.fotoHash;
          return new Response(JSON.stringify(window.__shelf), {status:200,headers:{'Content-Type':'application/json'}});
        }
        let body=[];
        if (url === '/api/ubicaciones') body=[{...window.__shelf}];
        else if (url === '/api/liquidaciones' || url === '/api/promotoras' || url === '/api/transferencias' || url === '/api/ventas/todas') body=[];
        return new Response(JSON.stringify(body), {status:200,headers:{'Content-Type':'application/json'}});
      };
    });
    await loadPhotoStack(page);
    await page.evaluate(() => VPerchas.cargar());
    const out = await page.evaluate(() => ({
      img: document.querySelector('#vp-grid img')?.getAttribute('src') || null,
      puts: window.__puts.slice(), pointer: window.__shelf.fotoHash
    }));
    assert.equal(out.img, 'data:image/png;base64,RzA1LUhJU1RPUlk=');
    assert.equal(out.pointer, 'hash-history');
    assert.ok(out.puts.some((x) => x.body.fotoHash === 'hash-history'), 'exact historical pointer is reattached');
  });
});

test('G05: Vault labels and preselects a unique exact historical shelf but does not auto-overwrite its current photo', async () => {
  await serverFor(PHOTO_FILES, async (page) => {
    await page.setContent('<!doctype html><html><body><section id="vista-perchas" class="activa"><div id="vp-orden"></div><div id="vp-grid"></div><div id="vp-transfers"></div></section></body></html>');
    await page.evaluate(() => {
      const old='data:image/png;base64,T0xELUhJU1RPUklD';
      const cur='data:image/png;base64,Q1VSUkVOVA==';
      window.__shelf={id:'u-one',nombre:'Shelf One',tipo:'propio',activa:true,fotoHash:'hash-current'};
      window.t=(k)=>({'shelves.noRacksYet':'No shelves yet','shelves.noTarget':'No target','shelves.ofTargetMet':'% target','shelves.monthlySales':'Monthly sales','shelves.target':'Target','shelves.commission':'Commission','shelves.promoter':'Promoter','shelves.open':'Open','shelves.transfersHeading':'Transfers','shelves.addRackBtn':'Add shelf'}[k]||k);
      window.OCI18n={locale:()=> 'en-US'}; window.OCMoneda={codigo:()=> 'USD'};
      sessionStorage.setItem('f123_diag_photo_vault', '1');
      window.OCAuth={puedeGestionar:()=>false,rolActual:()=> 'owner'};
      window.OCFotos={
        migrarSiHaceFalta:async()=>{}, leerTodas:async()=>({}),
        leerTodosPorHash:async()=>({'hash-old':old,'hash-current':cur}),
        leerPorHash:async(h)=>h==='hash-current'?cur:(h==='hash-old'?old:null),
        guardarPorHash:async()=>true, guardarFoto:async()=>true, hashDeDataUrl:async()=> 'hash-current'
      };
      window.OCSync={catalogoPropio:()=>({ubicaciones:[{...window.__shelf}],productos:[]})};
      window.OCYjs={
        get:()=>({'u-one':{...window.__shelf}}),
        historialFotosPorPercha:async()=>({'u-one':['hash-old','hash-current']}),
        fotosMap:{get:()=>null}
      };
      window.fetch=async(input)=>{
        const url=String(input); let body=[];
        if(url==='/api/ubicaciones') body=[{...window.__shelf}];
        else if(url==='/api/liquidaciones'||url==='/api/promotoras'||url==='/api/transferencias'||url==='/api/ventas/todas') body=[];
        return new Response(JSON.stringify(body),{status:200,headers:{'Content-Type':'application/json'}});
      };
    });
    await loadPhotoStack(page);
    await page.evaluate(() => VPerchas.cargar());
    const out=await page.evaluate(()=>({
      txt:document.getElementById('vp-photo-vault')?.textContent||'',
      sel:document.querySelector('[data-vault-shelf="hash-old"]')?.value||'',
      pointer:window.__shelf.fotoHash
    }));
    assert.match(out.txt,/Exact local history: Shelf One/);
    assert.equal(out.sel,'u-one','exact historical shelf is preselected for human confirmation');
    assert.equal(out.pointer,'hash-current','history never overwrites a currently valid pointer');
  });
});
