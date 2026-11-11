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

   const denied=await page.evaluate(async({productId,label})=>{
     localStorage.setItem('f123_owned',JSON.stringify({licenseCode:'SYNTHETIC-ACTIVATED-FALLBACK-'+label}));
     localStorage.setItem('f123_tienda_activa','SYNTHETIC-NOTEBOOK-'+label);
     window.__trueIDB=window.OCEstadoIDB;
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
