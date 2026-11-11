'use strict';
// P0 RED contract: the legacy A/B localStorage path must never masquerade as
// a durable IDB sale on an activated business after IDB becomes unavailable.
// Synthetic notebooks only; no real network, customer license or deployment.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {chromium,webkit}=require('playwright');
const INDEX=pathToFileURL(path.resolve(__dirname,'../docs/index.html')).href;
const WS_STUB='window.WebSocket=class{constructor(){this.readyState=3;}send(){}close(){}addEventListener(){}removeEventListener(){}};window.WebSocket.CONNECTING=0;window.WebSocket.OPEN=1;window.WebSocket.CLOSING=2;window.WebSocket.CLOSED=3;';

for(const [name,engine] of [['Chromium',chromium],['WebKit',webkit]]){
 test('P0 activated '+name+': IDB absent means NO localStorage sale ACK, no phantom stock, recovery with IDB',
 {timeout:90000},async()=>{
  const browser=await engine.launch({headless:true});
  try{
   const ctx=await browser.newContext();
   await ctx.route(url=>!/^(file|data|blob|about):/.test(url.protocol),route=>route.abort());
   const page=await ctx.newPage();
   await page.addInitScript(WS_STUB);
   await page.goto(INDEX,{waitUntil:'domcontentloaded'});
   await page.waitForFunction(()=>!!window.OCAuth&&typeof window.OCEstadoIDB?.guardarConRevision==='function');
   const id=await page.evaluate(async label=>{
    OCAuth.rolActual=()=> 'dueno';
    document.getElementById('oc-gate')?.remove();
    const r=await fetch('/api/productos',{method:'POST',body:JSON.stringify({
      nombre:'Synthetic fallback guard '+label,barcode:'P0-NO-FALLBACK-'+label,
      precio:15,costo:4,stockInicial:3
    })});
    const p=await r.json();
    if(!r.ok)throw Error('synthetic seed rejected '+r.status+' '+JSON.stringify(p));
    return p.id;
   },name);
   await page.waitForFunction(async productId=>{
     const s=await window.OCEstadoIDB.leer();
     return !!s?.productos?.find(p=>p.id===productId);
   },id,{timeout:10000});

   const proof=await page.evaluate(()=>OCEstadoIDB.capacidad());
   assert.equal(proof,'opened_once','first confirmed IDB commit leaves a sticky capability proof');
   const denied=await page.evaluate(async({productId,label})=>{
     localStorage.setItem('f123_owned',JSON.stringify({licenseCode:'SYNTHETIC-ACTIVATED-FALLBACK-'+label}));
     localStorage.setItem('f123_tienda_activa','SYNTHETIC-NOTEBOOK-'+label);
     window.__trueIDB=window.OCEstadoIDB;
     // Simulate an older installed customer upgrading without capability flag.
     // Missing historical metadata MUST NEVER be read as 'never_opened'.
     localStorage.removeItem('f123_idb_capability_v1');
     // Simulate an unsupported/disabled IDB *after* the business has been seeded.
     // Never turn a strict sale into a successful A/B localStorage-only receipt.
     window.OCEstadoIDB={soportado:false,ultimoError:()=>null};
     const r=await fetch('/api/productos/'+productId+'/venta',{
       method:'POST',body:JSON.stringify({cantidad:1,info:{formaPago:'cash'}})
     });
     const payload=await r.json();
     const state=await(await fetch('/api/respaldo/exportar')).json();
     return {status:r.status,code:payload.code||null,
       stock:state.productos.find(p=>p.id===productId)?.stockActual,
       sales:state.ventas.filter(v=>v.productoId===productId).length};
   },{productId:id,label:name});
   assert.ok(denied.status===503||denied.status===507,
     'activated business MUST fail closed without IDB; legacy A/B must not ACK sale: '+JSON.stringify(denied));
   assert.equal(denied.sales,0,'refused sale writes no financial receipt');
   assert.equal(denied.stock,3,'refused sale does not spend stock');
   const stored=await page.evaluate(async productId=>{
    window.OCEstadoIDB=window.__trueIDB;
    const snapshot=await OCEstadoIDB.leer();
    return {stock:snapshot?.productos?.find(p=>p.id===productId)?.stockActual,
      sales:snapshot?.ventas?.filter(v=>v.productoId===productId).length};
   },id);
   assert.deepEqual(stored,{stock:3,sales:0},
     'the original durable IDB snapshot remains unchanged after aborted sale');
   // Clearing storage pressure (restoring IDB) should allow exactly one sale.
   const response=await page.evaluate(async productId=>{
    const r=await fetch('/api/productos/'+productId+'/venta',{
      method:'POST',body:JSON.stringify({cantidad:1,info:{formaPago:'cash'}})
    });
    return {status:r.status,body:await r.json()};
   },id);
   assert.equal(response.status,200,'a working IDB must let local-first selling resume');
   await page.reload({waitUntil:'domcontentloaded'});
   await page.waitForFunction(()=>!!window.OCEstadoIDB&&!!window.OCAuth);
   const reopened=await page.evaluate(async productId=>{
    const state=await(await fetch('/api/respaldo/exportar')).json();
    return {stock:state.productos.find(p=>p.id===productId)?.stockActual,
      sales:state.ventas.filter(v=>v.productoId===productId).length};
   },id);
   assert.deepEqual(reopened,{stock:2,sales:1},
     'one strict sale survives reload, no false A/B sale');
  }finally{await browser.close();}
 });
}

for(const [name,engine] of [['Chromium',chromium],['WebKit',webkit]]){
 test('P0 '+name+': a truly IDB-less NEW device sells autonomously using A/B and survives reload',
 {timeout:90000},async()=>{
  const browser=await engine.launch({headless:true});
  try{
   const ctx=await browser.newContext();
   await ctx.route(url=>!/^(file|data|blob|about):/.test(url.protocol),route=>route.abort());
   const page=await ctx.newPage();
   // Remove native IndexedDB BEFORE any application script executes.
   // Not an adapter fake on an older device: initial capability is 'never'.
   await page.addInitScript(WS_STUB);
   // Instrument the REAL A/B module only in this synthetic browser run; do
   // not mutate its return value or inject an in-memory success.
   await page.addInitScript(() => {
     let api;
     Object.defineProperty(window,'OCEstadoAB',{configurable:true,
       get(){return api;},set(v){
         api=v;
         const original=v.crear.bind(v);
         v.crear=(opts)=>{
           const ab=original(opts),realSave=ab.guardarAhora.bind(ab);
           ab.guardarAhora=raw=>{
             const accepted=realSave(raw);
             if(!accepted){
               let requestedRev=null,physicalRev=null,cause=null;
               try{requestedRev=JSON.parse(raw)._rev;}catch(_){}
               try{physicalRev=ab.leer().revMax;}catch(_){}
               try{cause=ab.ultimoError()?.name||null;}catch(_){}
               window.__p0ABFail={requestedRev,physicalRev,cause};
             }
             return accepted;
           };
           return ab;
         };
       }});
   });
   await page.addInitScript(() => {
     try{Object.defineProperty(window,'indexedDB',{configurable:true,value:undefined});}
     catch(_){try{window.indexedDB=undefined;}catch(__){}}
   });
   await page.goto(INDEX,{waitUntil:'domcontentloaded'});
   await page.waitForFunction(()=>!!window.OCEstadoIDB&&!!window.OCAuth);
   const afterBoot=await page.evaluate(()=>({
      native:!!(window.indexedDB&&window.indexedDB.open),
      cap:window.OCEstadoIDB.capacidad()
   }));
   assert.deepEqual(afterBoot,{native:false,cap:'never_opened'});
   const productId=await page.evaluate(async(label)=>{
      OCAuth.rolActual=()=> 'dueno';
      document.getElementById('oc-gate')?.remove();
      const r=await fetch('/api/productos',{method:'POST',
        body:JSON.stringify({nombre:'No native IDB '+label,
          barcode:'P0-NEVER-IDB-'+label,precio:15,costo:4,stockInicial:3})});
      const j=await r.json();if(!r.ok)throw Error('seed '+r.status);
      // This fixture deliberately stays on the canonical local notebook:
      // switching tienda_activa after seeding would load a DIFFERENT book on
      // reload and manufacture a data-loss signal unrelated to storage.
      localStorage.setItem('f123_owned',JSON.stringify({licenseCode:'F123-TEST-NO-IDB-'+label}));
      return j.id;
   },name);
   // Restart the SAME apparatus. This proves the previous non-financial A/B
   // seed was recoverable and that the sale is based on a recovered disk
   // revision, not on a fast ephemeral fixture's in-memory revision.
   await page.waitForFunction(()=>{
     try {
       const j=JSON.parse(localStorage.getItem('f123_estado_v4_journal')||'null');
       return j&&j.phase==='COMMITTED'&&j.revision>=1;
     } catch(_){return false;}
   });
   await page.reload({waitUntil:'domcontentloaded'});
   await page.waitForFunction(()=>!!window.OCEstadoIDB&&!!window.OCAuth);
   const recovered=await page.evaluate(async id=>{
     OCAuth.rolActual=()=> 'dueno';
     document.getElementById('oc-gate')?.remove();
     const s=await(await fetch('/api/respaldo/exportar')).json();
     return {product:!!s.productos.find(p=>p.id===id),cap:OCEstadoIDB.capacidad()};
   },productId);
   assert.deepEqual(recovered,{product:true,cap:'never_opened'},
     'a genuinely IDB-less notebook must reload its confirmed A/B state');
   const sale=await page.evaluate(async id=>{
     window.__p0WriteReasons=[];
     if(window.OCCanarios&&typeof OCCanarios.fallo==='function'){
       const original=OCCanarios.fallo.bind(OCCanarios);
       OCCanarios.fallo=function(...args){
         window.__p0WriteReasons.push(args.map(v=>String(v).slice(0,48)));
         return original(...args);
       };
     }
     const r=await fetch('/api/productos/'+id+'/venta',{method:'POST',
       body:JSON.stringify({cantidad:1})});
     return {status:r.status,body:await r.json()};
   },productId);
   const diagnostics=await page.evaluate(()=>({
     capability:OCEstadoIDB.capacidad(),idbSupported:OCEstadoIDB.soportado,
     writeReasons:window.__p0WriteReasons||[],abLastRefusal:window.__p0ABFail||null,
     localKeys:Array.from({length:localStorage.length},(_,i)=>localStorage.key(i))
       .filter(k=>k&&k.startsWith('f123_estado_v4'))
       .map(k=>({key:k,length:(localStorage.getItem(k)||'').length})),
     ab:(()=>{
       try {const a=OCEstadoAB.crear({storage:localStorage,claveBase:'f123_estado_v4',
         leer:k=>localStorage.getItem(k)}),v=a.leer();
         return {revMax:v.revMax,phase:v.registro&&v.registro.phase,
           conflictos:v.conflictos.length,danados:v.danados.length,
           lastError:a.ultimoError()?.name||null};}
       catch(e){return {error:e.name,message:e.message.slice(0,180)};}
     })()
   }));
   assert.equal(sale.status,200,
     'offline A/B sale MUST work without native IDB or other devices: '+
     JSON.stringify({sale,diagnostics}));
   const local=await page.evaluate(async id=>{
     const a=await(await fetch('/api/respaldo/exportar')).json();
     return {stock:a.productos.find(p=>p.id===id)?.stockActual,
       sales:a.ventas.filter(v=>v.productoId===id).length,
       cap:OCEstadoIDB.capacidad()};
   },productId);
   assert.deepEqual(local,{stock:2,sales:1,cap:'never_opened'});
   await page.reload({waitUntil:'domcontentloaded'});
   await page.waitForFunction(()=>!!window.OCEstadoIDB);
   const persisted=await page.evaluate(async id=>{
     const a=await(await fetch('/api/respaldo/exportar')).json();
     return {stock:a.productos.find(p=>p.id===id)?.stockActual,
       sales:a.ventas.filter(v=>v.productoId===id).length,
       cap:OCEstadoIDB.capacidad()};
   },productId);
   assert.deepEqual(persisted,{stock:2,sales:1,cap:'never_opened'},
     'same exact sale survives reopening without native IDB, internet or relay');
  }finally{await browser.close();}
 });
}
