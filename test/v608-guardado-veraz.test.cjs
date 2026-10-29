'use strict';
// v608 (JFC 2026-10-28): fallos de guardado veraces, reintento acotado, aviso naranja, nombre dorado. Datos sinteticos, app real en Chromium.
const {test}=require('node:test'),assert=require('node:assert/strict');
const {chromium,startServer,openDevice,enterAs,go}=require('./helpers/e2e-app.cjs');
async function withDevice(fn){
  const {srv,base}=await startServer();let browser;
  try{browser=await chromium.launch({headless:true});const d=await openDevice(browser,base);d.page.setDefaultTimeout(8000);await enterAs(d.page);
    await fn(d.page);await d.ctx.close();}
  finally{if(browser)await browser.close();await new Promise(r=>srv.close(r));}
}
const NUEVO=bc=>JSON.stringify({nombre:'Syn '+bc,barcode:bc,categoria:'x',precio:'5',costo:'1',stockInicial:'1',ubicacionId:'todas'});
// POST + forced durable save (POST alone saves on a debounce).
const POST=(page,b)=>page.evaluate(async b=>{const r=await fetch('/api/productos',{method:'POST',headers:{'Content-Type':'application/json'},body:b});await OCSync.confirmarCatalogoDurable().catch(()=>false);return r.status;},b);
// Every save fails with AbortError (lock); backoff timers are logged and run fast.
const FALLA=()=>{
  window.__delays=[];const st=window.setTimeout;
  window.setTimeout=function(fn,ms,...a){ if([3000,6000,12000,24000,48000].includes(ms)){window.__delays.push(ms);return st(fn,10,...a);} return st(fn,ms,...a); };
  window.__lock=true;
  Object.defineProperty(navigator,'locks',{configurable:true,value:{request:(n,o,cb)=>window.__lock?Promise.reject(new DOMException('lock timeout','AbortError')):Promise.resolve(cb())}});
};

test('retry backoff is 3,6,12,24,48 s and stops at 5 attempts; no red banner and no notice',async()=>{
  await withDevice(async page=>{
    await page.evaluate(FALLA);
    await POST(page,NUEVO('R1'));
    await page.waitForTimeout(1500);
    const r=await page.evaluate(()=>({d:window.__delays.slice(),aviso:!!document.getElementById('f123-aviso-guardado'),quota:!!document.getElementById('oc-quota-aviso')||!!window.__ocMemoriaLlena}));
    assert.deepEqual(r.d,[3000,6000,12000,24000,48000]);
    assert.equal(r.quota,false);
    assert.equal(r.aviso,false,'no visible notice element (owner order)');
    await page.waitForTimeout(500);
    assert.equal(await page.evaluate(()=>window.__delays.length),5,'no 6th attempt');
  });
});

test('a later successful save resets the retry counter; no visible notice ever',async()=>{
  await withDevice(async page=>{
    await page.evaluate(FALLA);
    await POST(page,NUEVO('S1'));
    await page.waitForTimeout(800);
    assert.equal(await page.evaluate(()=>!!document.getElementById('f123-aviso-guardado')),false,'owner order: no notice element');
    await page.evaluate(()=>{window.__lock=false;window.__delays.length=0;});
    await POST(page,NUEVO('S2'));
    await page.waitForTimeout(300);
    // counter was reset by the success: a new failure series starts again at 3000
    await page.evaluate(()=>{window.__lock=true;});
    await POST(page,NUEVO('S3'));
    await page.waitForTimeout(300);
    const d=await page.evaluate(()=>window.__delays.slice());
    assert.equal(d[0],3000,'backoff restarted after a success: '+JSON.stringify(d));
    assert.equal(await page.evaluate(()=>!!document.getElementById('f123-aviso-guardado')),false);
  });
});

test('real quota error writes plain text in the Avanzado status line (no overlay element)',async()=>{
  await withDevice(async page=>{
    await page.evaluate(()=>{
      const orig=localStorage.setItem.bind(localStorage);
      localStorage.setItem=function(k,v){ if(String(k).indexOf('f123_estado_v4')===0) throw new DOMException('full','QuotaExceededError'); return orig(k,v); };
      if(window.OCEstadoIDB) window.OCEstadoIDB.guardar=()=>Promise.resolve(false);
    });
    await POST(page,NUEVO('Q1'));
    await page.waitForTimeout(400);
    await go(page,'avanzado');
    const r=await page.evaluate(()=>{const e=document.getElementById('oc-sync-estado-min');return {q:!!document.getElementById('oc-quota-aviso'),a:!!document.getElementById('f123-aviso-guardado'),
      t:e?e.textContent:null,vis:e?getComputedStyle(e).display!=='none':false,pos:e?getComputedStyle(e).position:null};});
    assert.deepEqual({q:r.q,a:r.a,vis:r.vis,pos:r.pos},{q:false,a:false,vis:true,pos:'static'});
    assert.equal(r.t,'Memoria del aparato llena: no se pudo guardar el último cambio.');
  });
});

test('store name is gold #E8A020 (computed) in light and dark scheme',async()=>{
  await withDevice(async page=>{
    for(const scheme of ['light','dark']){
      await page.emulateMedia({colorScheme:scheme});
      const r=await page.evaluate(()=>{const e=document.getElementById('oc-negocio-nombre');if(!e)return null;const c=getComputedStyle(e);return {c:c.color,f:c.webkitTextFillColor};});
      assert.ok(r,'wordmark element exists');
      assert.equal(r.c,'rgb(232, 160, 32)',scheme);assert.equal(r.f,'rgb(232, 160, 32)',scheme);
    }
  });
});

test('real IndexedDB quota error (localStorage unavailable) writes the in-UI status text',async()=>{
  await withDevice(async page=>{
    await page.evaluate(()=>{
      const orig=localStorage.setItem.bind(localStorage);
      localStorage.setItem=function(k,v){ if(String(k).indexOf('f123_estado_v4')===0) throw new DOMException('denied','SecurityError'); return orig(k,v); };
      // Real estado-idb path: its write rejects with a quota error, estado-idb catches it and returns false.
      const orig2=IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put=function(){ throw new DOMException('full','QuotaExceededError'); };
      window.__restorePut=()=>{IDBObjectStore.prototype.put=orig2;};
    });
    await POST(page,NUEVO('IQ1'));
    await page.waitForTimeout(500);
    await go(page,'avanzado');
    const r=await page.evaluate(()=>{const e=document.getElementById('oc-sync-estado-min');return {q:!!document.getElementById('oc-quota-aviso'),a:!!document.getElementById('f123-aviso-guardado'),
      t:e?e.textContent:null,vis:e?getComputedStyle(e).display!=='none':false,pos:e?getComputedStyle(e).position:null};});
    assert.deepEqual({q:r.q,a:r.a,vis:r.vis,pos:r.pos},{q:false,a:false,vis:true,pos:'static'});
    assert.equal(r.t,'Memoria del aparato llena: no se pudo guardar el último cambio.');
  });
});
