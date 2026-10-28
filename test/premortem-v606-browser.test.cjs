'use strict';
// PRE-MORTEM v606 (JFC 2026-10-28). RED-style: each assertion states the SAFE behaviour; a failing test = bug confirmed.
// Synthetic data only, real app in Chromium, no network (see helpers/e2e-app.cjs). Does not change app code.
const {test}=require('node:test'),assert=require('node:assert/strict');
const {chromium,startServer,openDevice,enterAs}=require('./helpers/e2e-app.cjs');

async function withDevice(fn,n=1){
  const {srv,base}=await startServer();let browser;
  try{
    browser=await chromium.launch({headless:true});
    const devs=[];for(let i=0;i<n;i++){const d=await openDevice(browser,base);d.page.setDefaultTimeout(8000);await enterAs(d.page);devs.push(d);}
    await fn(n===1?devs[0].page:devs.map(d=>d.page));
    for(const d of devs)await d.ctx.close();
  }finally{if(browser)await browser.close();await new Promise(r=>srv.close(r));}
}
const NUEVO=(bc,extra)=>JSON.stringify(Object.assign({nombre:'Syn '+bc,barcode:bc,categoria:'x',precio:'5',costo:'1',stockInicial:'1',ubicacionId:'todas'},extra||{}));
const POST=(page,body)=>page.evaluate(async b=>{const r=await fetch('/api/productos',{method:'POST',headers:{'Content-Type':'application/json'},body:b});return {s:r.status,j:await r.json()};},body);

// Installs: lock always aborts (AbortError) + accelerated 3000 ms timers counted.
const FALLO_CANDADO=()=>{
  window.__retries=0;
  const st=window.setTimeout;
  window.setTimeout=function(fn,ms,...a){ if(ms===3000){window.__retries++;return st(fn,15,...a);} return st(fn,ms,...a); };
  Object.defineProperty(navigator,'locks',{configurable:true,value:{request:()=>Promise.reject(new DOMException('lock timeout','AbortError'))}});
};

test('P1 item1: persistent AbortError -> retry loop is infinite (3 s each) and user is never told',async()=>{
  await withDevice(async page=>{
    await page.evaluate(FALLO_CANDADO);
    await POST(page,NUEVO('P1A'));
    await page.evaluate(()=>OCSync.confirmarCatalogoDurable().catch(()=>false));
    await page.waitForTimeout(2500); // 2.5 s real == ~160 accelerated 3 s cycles
    const r=await page.evaluate(()=>({retries:window.__retries,banner:!!document.getElementById('oc-quota-aviso'),aviso:!!document.getElementById('f123-aviso-guardado'),
      cat:OCSync.catalogoPropio()}));
    // SAFE behaviour: bounded retries (<=5) and a visible message when the retries are exhausted.
    console.log('item1 diag',JSON.stringify({retries:r.retries,banner:r.banner,cat:r.cat===null}));
    assert.ok(r.retries<=5,'retry loop never stops: '+r.retries+' retries in 2.5 s accelerated (= every 3 s forever in real time)');
    // v608 (owner order JFC 2026-10-28): non-quota failure -> NO red banner and NO visible notice at all (console only).
    assert.equal(r.banner,false,'non-quota failure must not show the red storage-full banner');
    assert.equal(r.aviso,false,'no extra visible notice element');
    // v608: catalogoPropio() stays null on purpose (never publish a catalogue that was not durably saved); retries are bounded. Documented, not asserted.
    console.log('item1 catalogoPropio null (by design):',r.cat===null);
  });
});

test('P1 item B3: failures that RETURN false (not throw) schedule NO retry',async()=>{
  await withDevice(async page=>{
    await page.evaluate(()=>{
      window.__retries=0;const st=window.setTimeout;
      window.setTimeout=function(fn,ms,...a){ if(ms===3000){window.__retries++;return st(fn,15,...a);} return st(fn,ms,...a); };
      const orig=localStorage.setItem.bind(localStorage);
      localStorage.setItem=function(k,v){ if(String(k).indexOf('f123_estado_v4')===0) throw new DOMException('denied','SecurityError'); return orig(k,v); };
      if(window.OCEstadoIDB) window.OCEstadoIDB.guardar=()=>Promise.resolve(false);
    });
    await POST(page,NUEVO('B3A'));
    await page.waitForTimeout(1500);
    const n=await page.evaluate(()=>window.__retries);
    assert.ok(n>=1,'a save that returns false (non-quota) is never retried: retries='+n);
  });
});

test('P1 item B2: non-quota failure returning false (SecurityError + IDB false) must NOT show the red "storage full" banner',async()=>{
  await withDevice(async page=>{
    await page.evaluate(()=>{
      const orig=localStorage.setItem.bind(localStorage);
      localStorage.setItem=function(k,v){ if(String(k).indexOf('f123_estado_v4')===0) throw new DOMException('denied','SecurityError'); return orig(k,v); };
      if(window.OCEstadoIDB) window.OCEstadoIDB.guardar=()=>Promise.resolve(false);
    });
    await POST(page,NUEVO('B2A'));
    await page.waitForTimeout(500);
    const banner=await page.evaluate(()=>!!document.getElementById('oc-quota-aviso'));
    assert.equal(banner,false,'false "memory full" banner still appears on a non-quota failure (mock-backend.js terminar(false) -> avisoMemoriaLlena)');
  });
});

test('P2 item2: duplicate barcode POST -> 409 with server text; UI prints data.error; legacy duplicates still editable',async()=>{
  const fs=require('node:fs');
  const ui=fs.readFileSync(require('node:path').join(__dirname,'..','src/app/app-inline-01.js'),'utf8');
  assert.match(ui,/if \(!res\.ok\)\{ msg\.style\.color = "var\(--rojo-ink\)"; msg\.textContent = data\.error; return; \}/,'create UI must print the server error');
  await withDevice(async page=>{
    const a=await POST(page,NUEVO('DUP1'));assert.equal(a.s,200);
    const b=await POST(page,NUEVO('dup1 '));assert.equal(b.s,409);assert.match(b.j.error,/already used/);
    // Legacy notebook: two live products with the same barcode (injected through the catalogue merge, as sync would).
    const legacy=await page.evaluate(()=>{
      const r=OCSync.aplicarCatalogo({ubicaciones:[],usuarios:[],productos:[{id:'legacyX',nombre:'Legacy',barcode:'DUP1',sku:'L1',precio:3,costo:1,stockActual:1,rev:'0000000000001-0-zz',stockTs:1,ubicacionId:'todas'}]},null);
      return r;});
    const patch=await page.evaluate(async()=>{const r=await fetch('/api/productos/legacyX',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({nombre:'Legacy edited'})});return {s:r.status};});
    assert.equal(patch.s,200,'owner can still edit a legacy duplicate-barcode product: '+JSON.stringify(legacy));
    const ida=a.j.id||(a.j.producto&&a.j.producto.id);
    const v=await POST(page,NUEVO('DUP1-V1',{familiaId:'FAM1',productoBaseId:ida,varianteAtributo:'color',varianteValor:'rojo',sku:'DUP1-V1'}));
    assert.equal(v.s,200,'variant creation on a legacy base still works: '+JSON.stringify(v.j));
  });
});

test('P2 item B4: two offline devices create the same barcode with different ids -> merge keeps TWO live products with that barcode',{skip:'v608: out of scope (barcode merge), still RED by design'},async()=>{
  await withDevice(async page=>{
    await POST(page,NUEVO('OFF1'));
    const ap=await page.evaluate(()=>OCSync.aplicarCatalogo({ubicaciones:[],usuarios:[],productos:[{id:'otherDevP',nombre:'Other dev',barcode:'OFF1',sku:'OFF1',precio:5,costo:1,stockActual:2,rev:'0000000000002-0-zz',stockTs:2,ubicacionId:'todas'}]},null));
    console.log('B4 agregadosP',ap.agregadosP);
    const n=await page.evaluate(()=>OCSync.estadoParaCheckpoint().productos.filter(p=>String(p.barcode).toLowerCase()==='off1').length);
    assert.equal(n,1,'merge matches by id only (mock-backend.js ~3905 find by p.id): barcode duplicated, count='+n);
  });
});

test('P2 item4: import 409 when notebook has Yjs data returns clear text; callers print r.error / e.message',async()=>{
  const fs=require('node:fs'),path=require('node:path');
  const rec=fs.readFileSync(path.join(__dirname,'..','docs/reconciliacion.js'),'utf8');
  assert.match(rec,/throw new Error\(e\.error/);assert.match(rec,/\.catch\(function \(e\) \{ msg\(T\("rec\.restoreFail"\) \+ e\.message/);
  await withDevice(async page=>{
    const out=await page.evaluate(async()=>{
      await fetch('/api/productos',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({nombre:'Y',barcode:'Y1',categoria:'x',precio:'5',costo:'1',stockInicial:'1',ubicacionId:'todas'})});
      await OCSync.confirmarCatalogoDurable();
      for(let i=0;i<40&&!(OCYjs._diag().n.productos>0);i++)await new Promise(r=>setTimeout(r,150));
      window.__n=JSON.stringify(OCYjs._diag().n);
      const exp=await (await fetch('/api/respaldo/exportar')).json();
      const r=await fetch('/api/respaldo/importar',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(exp)});
      return {s:r.status,j:await r.json(),n:window.__n};
    });
    console.log('item4 yjs n',out.n,'status',out.s);
    assert.equal(out.s,409);
    assert.match(out.j.error,/restore|restaur/i);
    const english=/^[\x00-\x7F]+$/.test(out.j.error)&&/only|device|new/i.test(out.j.error);
    assert.equal(english,true,'409 text is Spanish-only in an English-default app: '+out.j.error.slice(0,60));
  });
});

test('P2 item3: sellarVenta / crearProductoNuevo restore flag and buttons when the inner flow throws or is cancelled',async()=>{
  await withDevice(async page=>{
    const r=await page.evaluate(async()=>{
      document.body.insertAdjacentHTML('beforeend','<button id="btnSellarVenta"></button><button onclick="crearProductoNuevo(\'x\')" id="cpn"></button>');
      const out={};
      let calls=0;
      window._sellarVentaInterno=async()=>{calls++;throw new Error('ocConfirm threw');};
      try{await sellarVenta();}catch(_){}
      out.sellDisabled=document.getElementById('btnSellarVenta').disabled;
      try{await sellarVenta();}catch(_){}
      out.sellCalls=calls;
      let c2=0;window._crearProductoNuevoInterno=async()=>{c2++;throw new Error('photo read failed');};
      try{await crearProductoNuevo('x');}catch(_){}
      out.cpnDisabled=document.getElementById('cpn').disabled;
      try{await crearProductoNuevo('x');}catch(_){}
      out.cpnCalls=c2;return out;
    });
    assert.deepEqual(r,{sellDisabled:false,sellCalls:2,cpnDisabled:false,cpnCalls:2});
  });
});

test('P1 item5: v606 update notice on a device whose saves fail never leaves the "Still saving" dead end (no close/reopen guidance)',{skip:'v608: update strip removed in v607 (ee90ff7); no replacement (owner: no notice UI)'},async()=>{
  const fs=require('node:fs'),path=require('node:path');
  const src=fs.readFileSync(path.join(__dirname,'..','src/app/app-inline-03.js'),'utf8');
  const a=src.indexOf('async function alTocarAviso'),b=src.indexOf('function mostrarAviso');
  const fn=src.slice(a,b),txt=src.slice(src.indexOf('function textoAviso'),a);
  const guides=/cierra|close (and|&) reopen|reabre|reopen|restart/i.test(fn+txt);
  assert.equal(guides,true,'tap -> guardarDuradero false -> text "Still saving. Try again" forever; no path says close and reopen');
});

test('P1 item6: stock divergence (different stockBase on two devices, +3 each) STILL diverges in v606',{skip:'v608: out of scope (stock ledger), still RED by design'},async()=>{
  await withDevice(async([A,B])=>{
    const seed=(base,dev)=>`(() => OCSync.aplicarCatalogo({ubicaciones:[],usuarios:[],productos:[{id:'pS',nombre:'Stock',barcode:'S1',sku:'S1',precio:5,costo:1,stockBase:${base},stockPN:{${dev}:{add:3,sub:0}},stockActual:${base+3},stockTs:100,rev:'0000000000001-0-zz',ubicacionId:'todas'}]},null))()`;
    await A.evaluate(seed(13,'"devA"'));await B.evaluate(seed(15,'"devB"'));
    const get=p=>p.evaluate(()=>OCSync.estadoParaCheckpoint().productos.find(x=>x.id==='pS'));
    const pa=await get(A),pb=await get(B);
    const exportar=p=>p.evaluate(()=>{const x=OCSync.estadoParaCheckpoint().productos.find(y=>y.id==='pS');return x;});
    // Full product (with stockBase/stockPN) is what the catalogue merge receives; read it from the live state.
    const full=p=>p.evaluate(async()=>{const l=await (await fetch('/api/productos')).json();return (Array.isArray(l)?l:l.productos).find(x=>x.id==='pS');});
    const fa=await full(A),fb=await full(B);
    await A.evaluate(x=>OCSync.aplicarCatalogo({ubicaciones:[],usuarios:[],productos:[x]},null),fb);
    await B.evaluate(x=>OCSync.aplicarCatalogo({ubicaciones:[],usuarios:[],productos:[x]},null),fa);
    const sa=(await get(A)).stockActual,sb=(await get(B)).stockActual;
    console.log('stock tras intercambio A,B =',sa,sb,'(antes',pa.stockActual,pb.stockActual,')');
    assert.equal(sa,sb,'devices still diverge after exchange: A='+sa+' B='+sb+' (expected RED: ledger fix not shipped)');
  },2);
});
