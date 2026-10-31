'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {browser}=require('./helpers/browser.cjs');
const {chromium}=require('playwright');

const patch=(app,id,body)=>app.fetch('/api/clientes/'+id+'/contacto',{method:'PATCH',body:JSON.stringify(body)});

test('contact save rejection preserves customer, stock, money and history without publishing',async()=>{
  const app=browser(); app.OCAuth={rolActual:()=> 'dueno'};
  const customer=await app.request('/api/clientes','POST',{nombre:'Synthetic durable contact',resideCuenca:true,genero:'female'});
  const before=await app.request('/api/respaldo/exportar');
  let catalogEvents=0;
  app.addEventListener('oc-catalogo-cambiado',()=>catalogEvents++);
  const original=app.localStorage.setItem;
  app.localStorage.setItem=(key,value)=>{
    if(key.startsWith('f123_estado_v4'))throw new DOMException('synthetic exhausted storage','QuotaExceededError');
    return original(key,value);
  };
  const response=await patch(app,customer.id,{resideCuenca:false,genero:'male',telefono:'0991234567'});
  assert.equal(response.status,507);
  assert.match((await response.json()).error,/not|could not/i);
  assert.equal(catalogEvents,0,'a rejected edit must never be sent to peers');
  const after=await app.request('/api/respaldo/exportar');
  for(const key of ['clientes','productos','ventas','movimientos','gastos','payouts','selloUltimo']) {
    assert.deepEqual(after[key],before[key],key+' remains unchanged after failure');
  }
  app.localStorage.setItem=original;
  const restored=browser(app.localStorage); restored.OCAuth={rolActual:()=> 'dueno'};
  const reloaded=await restored.request('/api/clientes');
  assert.equal(reloaded.find(c=>c.id===customer.id).resideCuenca,true);
});

test('native A/B lock keeps contact response and reads pending until durable commit, then reload preserves edit',{timeout:15000},async()=>{
  const chromiumBrowser=await chromium.launch({headless:true});
  try {
    const page=await chromiumBrowser.newPage();
    page.setDefaultTimeout(5000);
    await page.goto(pathToFileURL(path.resolve(__dirname,'../docs/index.html')).href,{waitUntil:'domcontentloaded'});
    await page.waitForFunction(()=>window.cargarClientes&&window.OCAuth&&window.OCEstadoAB);
    const id=await page.evaluate(async()=>{
      OCAuth.rolActual=()=> 'dueno';
      const response=await fetch('/api/clientes',{method:'POST',body:JSON.stringify({nombre:'Synthetic lock contact',resideCuenca:true,genero:'female'})});
      const customer=await response.json();
      if(!response.ok)throw Error(JSON.stringify(customer));
      return customer.id;
    });
    // Hold the real IndexedDB strict CAS behind an explicit synthetic barrier.
    // On release the original implementation writes the record to disk.
    await page.evaluate(()=>{
      const original=OCEstadoIDB.guardarConRevision.bind(OCEstadoIDB);
      window.__contactDurableReached=false;
      OCEstadoIDB.guardarConRevision=(...args)=>new Promise(resolve=>{
        window.__contactDurableReached=true;
        window.__releaseContactDurable=()=>original(...args).then(resolve,()=>resolve(false));
      });
    });
    await page.evaluate(id=>{
      window.__contactPatchDone=false;window.__contactReadDone=false;
      window.__contactPatch=fetch('/api/clientes/'+id+'/contacto',{method:'PATCH',body:JSON.stringify({resideCuenca:false,genero:'male'})}).then(async r=>{
        window.__contactPatchStatus=r.status;window.__contactPatchDone=true;return r.json();
      });
    },id);
    await page.waitForFunction(()=>window.__contactDurableReached);
    await page.evaluate(()=>{window.__contactRead=fetch('/api/clientes').then(async r=>{
      window.__contactReadBody=await r.json();window.__contactReadDone=true;return window.__contactReadBody;
    });});
    await page.evaluate(()=>new Promise(resolve=>setTimeout(resolve,30)));
    const before=await page.evaluate(id=>({
      patchDone:window.__contactPatchDone,
      readLeaked:window.__contactReadDone && (window.__contactReadBody||[]).some(c=>
        c.id===id && (c.resideCuenca===false || c.genero==='male'))
    }),id);
    assert.equal(before.patchDone,false,'contact PATCH cannot ACK before strict IDB CAS');
    assert.equal(before.readLeaked,false,'provisional contact cannot leak to a concurrent read');
    await page.evaluate(async()=>{window.__releaseContactDurable();await window.__contactPatch;await window.__contactRead;});
    assert.equal(await page.evaluate(()=>window.__contactPatchStatus),200);
    await page.reload({waitUntil:'domcontentloaded'});
    await page.waitForFunction(()=>window.cargarClientes&&window.OCAuth);
    const restored=await page.evaluate(async id=>{OCAuth.rolActual=()=> 'dueno';return (await (await fetch('/api/clientes')).json()).find(c=>c.id===id);},id);
    assert.equal(restored.resideCuenca,false); assert.equal(restored.genero,'male');
  } finally {await chromiumBrowser.close();}
});