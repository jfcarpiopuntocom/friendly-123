'use strict';
// v608 (JFC 2026-10-28): fallos de guardado veraces, reintento acotado, aviso naranja, nombre dorado. Datos sinteticos, app real en Chromium.
const {test}=require('node:test'),assert=require('node:assert/strict');
const {chromium,startServer,openDevice,enterAs}=require('./helpers/e2e-app.cjs');
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

test('retry backoff is 3,6,12,24,48 s and stops at 5 attempts; notice appears; no red banner',async()=>{
  await withDevice(async page=>{
    await page.evaluate(FALLA);
    await POST(page,NUEVO('R1'));
    await page.waitForTimeout(1500);
    const r=await page.evaluate(()=>({d:window.__delays.slice(),aviso:!!document.getElementById('f123-aviso-guardado'),quota:!!document.getElementById('oc-quota-aviso')}));
    assert.deepEqual(r.d,[3000,6000,12000,24000,48000]);
    assert.equal(r.quota,false);
    assert.equal(r.aviso,true);
    await page.waitForTimeout(500);
    assert.equal(await page.evaluate(()=>window.__delays.length),5,'no 6th attempt');
  });
});

test('notice EN: style, below #oc-gate; tap keeps text on failure and hides on success',async()=>{
  await withDevice(async page=>{
    await page.evaluate(()=>{window.OCI18n.getLang=()=>'en';});
    await page.evaluate(FALLA);
    await POST(page,NUEVO('N1'));
    await page.waitForSelector('#f123-aviso-guardado');
    const st=await page.evaluate(()=>{const e=document.getElementById('f123-aviso-guardado'),c=getComputedStyle(e);
      return {t:e.textContent,bg:c.backgroundColor,fg:c.color,fs:c.fontSize,mh:c.minHeight,pos:c.position,z:c.zIndex,op:c.opacity};});
    assert.equal(st.t,'Your last change could not be saved. Close the app and open it again.');
    assert.equal(st.bg,'rgb(232, 96, 64)');assert.equal(st.fg,'rgb(255, 255, 255)');assert.equal(st.fs,'16px');
    assert.equal(st.pos,'fixed');assert.equal(st.op,'1');assert.ok(Number(st.z)<9999);assert.ok(parseFloat(st.mh)>=48);
    // tap while still failing: same text, still there (never "still saving")
    await page.evaluate(()=>document.getElementById('f123-aviso-guardado').click());await page.waitForTimeout(400);
    assert.equal(await page.evaluate(()=>{const e=document.getElementById('f123-aviso-guardado');return e&&e.textContent;}),st.t);
    // storage heals: tap -> durable save ok -> hidden
    await page.evaluate(()=>{window.__lock=false;});
    await page.evaluate(()=>document.getElementById('f123-aviso-guardado').click());
    await page.waitForFunction(()=>!document.getElementById('f123-aviso-guardado'),null,{timeout:7000});
  });
});

test('notice ES text when UI language is Spanish',async()=>{
  await withDevice(async page=>{
    await page.evaluate(()=>{window.OCI18n.getLang=()=>'es';});
    await page.evaluate(FALLA);
    await POST(page,NUEVO('E1'));
    await page.waitForSelector('#f123-aviso-guardado');
    assert.equal(await page.evaluate(()=>document.getElementById('f123-aviso-guardado').textContent),'No se pudo guardar el último cambio. Cierra la app y vuelve a abrirla.');
  });
});

test('a later successful save resets the counter and hides the notice',async()=>{
  await withDevice(async page=>{
    await page.evaluate(FALLA);
    await POST(page,NUEVO('S1'));
    await page.waitForSelector('#f123-aviso-guardado');
    await page.evaluate(()=>{window.__lock=false;});
    await POST(page,NUEVO('S2'));
    await page.waitForFunction(()=>!document.getElementById('f123-aviso-guardado'),null,{timeout:7000});
  });
});

test('real quota error still shows the red banner and no orange notice',async()=>{
  await withDevice(async page=>{
    await page.evaluate(()=>{
      const orig=localStorage.setItem.bind(localStorage);
      localStorage.setItem=function(k,v){ if(String(k).indexOf('f123_estado_v4')===0) throw new DOMException('full','QuotaExceededError'); return orig(k,v); };
      if(window.OCEstadoIDB) window.OCEstadoIDB.guardar=()=>Promise.resolve(false);
    });
    await POST(page,NUEVO('Q1'));
    await page.waitForTimeout(400);
    const r=await page.evaluate(()=>({q:!!document.getElementById('oc-quota-aviso'),a:!!document.getElementById('f123-aviso-guardado')}));
    assert.deepEqual(r,{q:true,a:false});
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
