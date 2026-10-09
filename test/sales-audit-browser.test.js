const {test}=require('node:test');
const assert=require('node:assert/strict');
const {chromium,webkit}=require('playwright');
const {pathToFileURL}=require('node:url');
const path=require('node:path');
for(const [name,engine] of [['Chromium',chromium],['WebKit',webkit]]) for(const lang of ['en','es']){
 test(`sales checking (${name}, ${lang}): Sold and dashboard show the same cash, filtered history and prices`,async()=>{
  const browser=await engine.launch({headless:true});
  try{
   const page=await browser.newPage({viewport:{width:390,height:844}});
   await page.goto(pathToFileURL(path.resolve(__dirname,'../docs/index.html')).href,{waitUntil:'domcontentloaded'});
   await page.waitForFunction(()=>window.OCAuth&&window.OCSalesAuditUI&&typeof cargarVentasSold==='function');
   const fx=await page.evaluate(async lang=>{
    window.OCAuth.rolActual=()=> 'dueno';window.OCI18n.setLang(lang);ubicacionActual='todas';
    document.querySelectorAll('[id*="gate"]').forEach(x=>x.style.display='none');
    document.querySelectorAll('.vista').forEach(x=>x.classList.remove('activa'));document.querySelector('#ventasSold').closest('.vista').classList.add('activa');document.getElementById('ventasSold').open=true;
    const req=async(u,m='GET',b)=>(await fetch(u,{method:m,body:b?JSON.stringify(b):undefined})).json();
    const rack=await req('/api/ubicaciones','POST',{nombre:'Synthetic bar',tipo:'propio'});
    const p=await req('/api/productos','POST',{nombre:'Synthetic drink',barcode:'AUDIT-DRINK',precio:17,costo:0,stockInicial:5,ubicacionId:rack.id});
    await req('/api/productos/'+p.id+'/venta','POST',{cantidad:2,info:{formaPago:'cash',nombreEvento:'Synthetic workshop'}});
    await req('/api/productos/'+p.id+'/venta','POST',{cantidad:1});
    await cargarVentasSold();const rows=await req('/api/ventas/todas?ubicacionId=todas');return {rows,rack:rack.id,p:p.id};
   },lang);
   await page.locator('#ventasSoldAudit [data-audit-rack]').selectOption(fx.rack);
   await page.locator('#ventasSoldAudit [data-audit-query]').fill('Synthetic drink');
   const app=await page.evaluate(()=>{const host=document.getElementById('ventasSoldAudit');return {r:host._salesAuditReport,text:host.innerText};});
   assert.equal(app.r.cashCents,3400);assert.equal(app.r.unspecifiedCents,1700);assert.equal(app.r.netCents,5100);assert.equal(app.r.rows.length,2);assert.match(app.text,/17[.,]00/);
   await page.reload({waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.OCAuth&&window.OCSalesAuditUI);
   const persisted=await page.evaluate(async id=>{window.OCAuth.rolActual=()=> 'dueno';return (await (await fetch('/api/ventas/todas?ubicacionId=todas')).json()).filter(v=>v.productoId===id).length;},fx.p);assert.equal(persisted,2);
   await page.goto(pathToFileURL(path.resolve(__dirname,'../docs/dashboard.html')).href,{waitUntil:'domcontentloaded'});
   await page.waitForFunction(()=>window.OCDashSalesAudit);
   await page.evaluate(({rows,lang})=>{localStorage.setItem('f123_lang',lang);window.OCDashSalesAudit.pintarConDatos({ventas:rows});document.getElementById('puerta').style.display='none';document.getElementById('tablero').style.display='block';document.getElementById('sales-audit').style.display='block';}, {rows:fx.rows,lang});
   await page.locator('#sales-audit [data-audit-rack]').selectOption(fx.rack);await page.locator('#sales-audit [data-audit-query]').fill('Synthetic drink');
   const dash=await page.evaluate(()=>document.getElementById('sales-audit')._salesAuditReport);
   assert.deepEqual(dash,app.r,'same source and filters produce the same financial evidence');
   await page.locator('#sales-audit [data-audit-query]').fill('not a sale');assert.equal(await page.locator('#sales-audit [data-audit-sale]').count(),0);
   await page.locator('#sales-audit [data-audit-reset]').click();assert.equal(await page.locator('#sales-audit [data-audit-query]').inputValue(),'');
  }finally{await browser.close();}
 });
}
