const {test}=require('node:test');
const assert=require('node:assert/strict');
const {chromium,webkit}=require('playwright');
const {pathToFileURL}=require('node:url');
const path=require('node:path');
for(const [engineName,engine] of [['Chromium',chromium],['WebKit',webkit]]) for(const lang of ['en','es']) {
 test(`Belen product payment (${engineName}, ${lang}): visible action stays by product and pays only its sales`,async()=>{
  const browser=await engine.launch({headless:true});
  try {
   const page=await browser.newPage({viewport:{width:390,height:844}});
   await page.goto(pathToFileURL(path.resolve(__dirname,'../docs/index.html')).href,{waitUntil:'domcontentloaded'});
   await page.waitForFunction(()=>window.OCAuth&&window.OCPayoutLedger&&typeof cargarComisiones==='function');
   const fx=await page.evaluate(async lang=>{
    window.OCAuth.rolActual=()=> 'dueno';window.OCI18n.setLang(lang);
    document.querySelectorAll('[id*="gate"]').forEach(x=>x.style.display='none');
    document.querySelectorAll('.vista').forEach(x=>x.classList.remove('activa'));document.getElementById('vista-comisiones').classList.add('activa');
    const req=async(u,m='GET',b)=> (await fetch(u,{method:m,body:b?JSON.stringify(b):undefined})).json();
    const a=await req('/api/promotoras','POST',{nombre:'Synthetic recipient',comisionBase:40});
    const r=await req('/api/ubicaciones','POST',{nombre:'Synthetic rack',tipo:'socio'});
    await req('/api/ubicaciones/'+r.id,'PUT',{promotoraId:a.id});
    const make=async(name,code)=>req('/api/productos','POST',{nombre:name,barcode:code,precio:100,costo:0,stockInicial:3,ubicacionId:r.id});
    const p=await make('Selected product','BELEN-A'),q=await make('Other product','BELEN-B');
    await req('/api/productos/'+p.id+'/venta','POST',{cantidad:1});await req('/api/productos/'+q.id+'/venta','POST',{cantidad:1});
    await cargarComisiones();return {p:p.id,q:q.id,r:r.id,a:a.id};
   },lang);
   await page.locator(`[data-product-id="${fx.p}"] [data-comm-pay-from-product]`).click();
   await page.waitForSelector('[data-ui="commissions.product-sheet"]');
   assert.equal(await page.locator('#comm-tab-product').getAttribute('aria-selected'),'true','Pay must not switch to racks');
   assert.equal(await page.locator('[data-ui="commissions.product-sheet"]').count(),1,'Product payment opens its existing scoped sheet');
   await page.evaluate(()=>{window._ocModalMostrar=async()=> 'efectivo';window.ocPrompt=async()=> '15.00';window.ocConfirm=async()=>false;
    const pay=window._marcarComisionPagadaUnaVez;window._marcarComisionPagadaUnaVez=async(...args)=>{try{return await pay(...args);}finally{window.__paymentFinished=true;}};
    const original=window.fetch;window.fetch=async(u,o)=>{const r=await original(u,o);if(o&&o.method==='POST')window.__paymentResponse={url:String(u),status:r.status,body:await r.clone().json()};return r;};
   });
   await page.locator('[data-ficha-pay]').click();
   await page.waitForFunction(()=>window.__paymentFinished);
   const response=await page.evaluate(()=>window.__paymentResponse);
   assert.equal(response?.status,200,JSON.stringify(response));
   const result=await page.evaluate(async fx=>{
    const req=async u=>(await fetch(u)).json();const ps=await req('/api/payouts');const sales=await req('/api/ventas/todas?ubicacionId=todas');
    return {amount:ps[0].amountCents,items:ps[0].items.map(i=>i.sourceId),selected:sales.find(v=>v.productoId===fx.p).comisionPendiente,other:sales.find(v=>v.productoId===fx.q).comisionPendiente,tab:window._ocVistaComisiones};
   },fx);
   assert.equal(result.amount,1500);assert.equal(result.items.length,1);assert.equal(result.selected,25);assert.equal(result.other,40);assert.equal(result.tab,'product');
   await page.locator('#comm-tab-rack').click();assert.ok(await page.locator('[data-comm-pay-person]').count()>0,'Grouped payment remains available');
  } finally {await browser.close();}
 });
}
