'use strict';
// P0 JFC 2026-11-11: accept-and-reconcile. IDB failure may use a verified
// local A/B commit; never claim global/peer ACK or apply one opId twice.
// Synthetic notebooks only; no real network, customer license or deployment.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {chromium,webkit}=require('playwright');
const INDEX=pathToFileURL(path.resolve(__dirname,'../docs/index.html')).href;
const WS_STUB='window.WebSocket=class{constructor(){this.readyState=3;}send(){}close(){}addEventListener(){}removeEventListener(){}};window.WebSocket.CONNECTING=0;window.WebSocket.OPEN=1;window.WebSocket.CLOSING=2;window.WebSocket.CLOSED=3;';

for(const [name,engine] of [['Chromium',chromium],['WebKit',webkit]]){
 for(const fault of ['adapter-unavailable','IDB-abort']){
 test('P0 JFC '+name+' '+fault+': A/B ACK local + same opId + failback without double sale',
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
      nombre:'Synthetic local sale '+label,barcode:'P0-FALLBACK-'+label,
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
   assert.equal(proof,'opened_once','the device had a real IDB commit BEFORE failure');
   const opId='sale-p0-fallback-'+name.toLowerCase()+'-'+fault;
   const accepted=await page.evaluate(async({productId,fault,opId,label})=>{
     // Emulate a licensed notebook only for this single-page synthetic sale.
     // Keep the canonical A/B notebook unchanged across the forthcoming reload.
     localStorage.setItem('f123_owned',JSON.stringify({licenseCode:'SYNTHETIC-ACTIVATED-FALLBACK-'+label}));
     window.__trueIDB=window.OCEstadoIDB;
     if(fault==='adapter-unavailable'){
       window.OCEstadoIDB={soportado:false,ultimoError:()=>null};
     }else{
       window.OCEstadoIDB={...window.__trueIDB,soportado:true,
         guardarConRevision:async()=>false,
         ultimoError:()=>({name:'AbortError'})};
     }
     const r=await fetch('/api/productos/'+productId+'/venta',{
       method:'POST',body:JSON.stringify({cantidad:1,opId,info:{formaPago:'cash'}})
     });
     const body=await r.json();
     const state=await(await fetch('/api/respaldo/exportar')).json();
     const j=JSON.parse(localStorage.getItem('f123_estado_v4_journal')||'null');
     const saved=j&&j.candidateRaw?JSON.parse(j.candidateRaw):null;
     return {status:r.status,returnedOpId:body.opId,stock:state.productos.find(p=>p.id===productId)?.stockActual,
       sales:state.ventas.filter(v=>v.productoId===productId).length,
       journalPhase:j?.phase,journalRevision:j?.revision,
       durableStock:saved?.productos?.find(p=>p.id===productId)?.stockActual,
       durableSales:saved?.ventas?.filter(v=>v.productoId===productId).length,
       durableOp:saved?.ventas?.find(v=>v.opId===opId)?.opId,
       error:body.error};
   },{productId:id,fault,opId,label:name});
   assert.equal(accepted.status,200,'IDB failure MUST allow durable local A/B sale: '+JSON.stringify(accepted));
   assert.equal(accepted.returnedOpId,opId);
   assert.equal(accepted.stock,2);
   assert.equal(accepted.sales,1);
   assert.equal(accepted.journalPhase,'COMMITTED','local A/B commit complete, not RAM-only');
   assert.equal(accepted.durableStock,2);
   assert.equal(accepted.durableSales,1);
   assert.equal(accepted.durableOp,opId);

   const staleIDB=await page.evaluate(async productId=>{
     window.OCEstadoIDB=window.__trueIDB;
     const s=await OCEstadoIDB.leer();
     // Test-only license marker removed because the initial synthetic product
     // was seeded in the unlicensed *canonical* store. Real licensed apps
     // scope their store at startup and do not switch scopes mid-session.
     localStorage.removeItem('f123_owned');
     return {stock:s?.productos?.find(p=>p.id===productId)?.stockActual,
       sales:s?.ventas?.filter(v=>v.productoId===productId).length};
   },id);
   assert.deepEqual(staleIDB,{stock:3,sales:0},
     'IDB remains stale while unavailable; the newer local journal must win');
   await page.reload({waitUntil:'domcontentloaded'});
   await page.waitForFunction(()=>!!window.OCEstadoIDB&&!!window.OCAuth);
   await page.waitForFunction(async({productId,opId})=>{
     const s=await OCEstadoIDB.leer();
     return !!(s?.ventas?.find(v=>v.opId===opId)&&s.productos.find(p=>p.id===productId)?.stockActual===2);
   },{productId:id,opId},{timeout:15000});
   const after=await page.evaluate(async({productId,opId})=>{
     OCAuth.rolActual=()=> 'dueno';
     document.getElementById('oc-gate')?.remove();
     const before=await(await fetch('/api/respaldo/exportar')).json();
     const dup=await fetch('/api/productos/'+productId+'/venta',{
       method:'POST',body:JSON.stringify({cantidad:1,opId,info:{formaPago:'cash'}})
     });
     const replay=await dup.json();
     const final=await(await fetch('/api/respaldo/exportar')).json();
     return {stockBefore:before.productos.find(p=>p.id===productId)?.stockActual,
       salesBefore:before.ventas.filter(v=>v.productoId===productId).length,
       duplicateStatus:dup.status,duplicate:replay.duplicate,duplicateId:replay.opId,
       stockAfter:final.productos.find(p=>p.id===productId)?.stockActual,
       salesAfter:final.ventas.filter(v=>v.productoId===productId).length,
       movements:final.movimientos.filter(v=>v.detalle?.opId===opId).length};
   },{productId:id,opId});
   assert.deepEqual(after,{stockBefore:2,salesBefore:1,duplicateStatus:200,
     duplicate:true,duplicateId:opId,stockAfter:2,salesAfter:1,movements:1},
     'failback and same-opId retry must NOT apply stock, money or movement twice');
  }finally{await browser.close();}
 });
 }
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
