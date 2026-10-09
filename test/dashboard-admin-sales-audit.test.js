const {test}=require('node:test');
const assert=require('node:assert/strict');
const {chromium,webkit}=require('playwright');
const path=require('node:path');
const fs=require('node:fs');
const DOCS=path.resolve(__dirname,'../docs'),ORIGIN='http://localhost:18478';
for(const [name,engine] of [['Chromium',chromium],['WebKit',webkit]]){
 test(`dashboard.html native admin login (${name}): rejected wrong PIN, prices and cash history accessible after valid PIN`,async()=>{
  const browser=await engine.launch({headless:true});
  try{
   const ctx=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'});
   await ctx.route('**/*',async route=>{
    const url=new URL(route.request().url());if(url.origin!==ORIGIN)return route.abort();
    const file=path.resolve(DOCS,decodeURIComponent(url.pathname).slice(1));if(!file.startsWith(DOCS+path.sep))return route.abort();
    try{await route.fulfill({status:200,contentType:{'.html':'text/html','.js':'application/javascript','.json':'application/json','.css':'text/css'}[path.extname(file)]||'application/octet-stream',body:fs.readFileSync(file)});}catch(_){await route.fulfill({status:404,body:'Not found'});}
   });
   await ctx.addInitScript(()=>{window.WebSocket=class{constructor(){this.readyState=3;}send(){}close(){}addEventListener(){}removeEventListener(){}};});
   const app=await ctx.newPage();await app.goto(ORIGIN+'/index.html',{waitUntil:'load'});
   await app.waitForFunction(()=>window.OCSecure&&window.OCAuth);
   await app.evaluate(async()=>{
    window.OCAuth=Object.assign({},window.OCAuth,{rolActual:()=> 'dueno'});
    localStorage.setItem('f123_owned',JSON.stringify({licenseCode:'F123-TEST-0000-0000-00000',nombreNegocio:'Synthetic admin audit'}));
    await window.OCSecure.guardarSecreto('789',['260'],'357','');
    const req=async(u,m='GET',b)=>{const r=await fetch(u,{method:m,body:b?JSON.stringify(b):undefined});if(!r.ok)throw new Error(await r.text());return r.json();};
    await req('/api/usuarios','POST',{nombre:'Synthetic audit admin',pin:'555',rol:'admin'});
    const rack=await req('/api/ubicaciones','POST',{nombre:'Synthetic admin bar',tipo:'propio'});
    const p=await req('/api/productos','POST',{nombre:'Synthetic admin drink',barcode:'ADMIN-AUDIT',precio:17,costo:0,stockInicial:4,ubicacionId:rack.id});
    await req('/api/productos/'+p.id+'/venta','POST',{cantidad:2,info:{formaPago:'cash'}});
   });
   await app.close();assert.equal(ctx.pages().length,0,'the app is closed before dashboard startup');
   const dash=await ctx.newPage();await dash.goto(ORIGIN+'/dashboard.html',{waitUntil:'load'});
   assert.equal(await dash.locator('#aviso-app-abierta').isVisible(),false,'the old keep-app-open warning must not misdescribe independent local access');
   await dash.locator('#pin').fill('999');await dash.locator('#entrar').click();
   await dash.waitForFunction(()=>/no abre el tablero/i.test(document.getElementById('msg').textContent));
   assert.equal(await dash.locator('#tablero').isVisible(),false);
   await dash.locator('#pin').fill('555');await dash.locator('#entrar').click();await dash.waitForFunction(()=>getComputedStyle(document.getElementById('tablero')).display!=='none');
   await dash.locator('a[data-ruta="hoy"]').click();
   await dash.locator('#sales-audit').waitFor({state:'visible'});
   await dash.waitForFunction(()=>document.getElementById('sales-audit')._salesAuditReport?.cashCents===3400);
   assert.equal(await dash.locator('#sales-audit').isVisible(),true);
   const r=await dash.evaluate(()=>{const h=document.getElementById('sales-audit');return {cash:h._salesAuditReport.cashCents,text:h.innerText,overflow:document.documentElement.scrollWidth>innerWidth+1};});
   assert.equal(r.cash,3400);assert.match(r.text,/17[.,]00/);assert.match(r.text,/Synthetic admin drink/);assert.equal(r.overflow,false,'mobile dashboard remains inside viewport');
  }finally{await browser.close();}
 });
}
