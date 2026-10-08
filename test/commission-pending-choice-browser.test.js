const {test}=require('node:test');
const assert=require('node:assert/strict');
const {chromium,webkit}=require('playwright');
const {pathToFileURL}=require('node:url');
const path=require('node:path');
for(const [name,engine] of [['Chromium',chromium],['WebKit',webkit]])for(const lang of ['en','es']){
 test(`leave commission owed (${name}, ${lang}): no payout, partial cash and remaining balance are explicit`,async()=>{
  const browser=await engine.launch({headless:true});
  try{
   const page=await browser.newPage({viewport:{width:390,height:844}});
   await page.goto(pathToFileURL(path.resolve(__dirname,'../docs/index.html')).href,{waitUntil:'domcontentloaded'});
   await page.waitForFunction(()=>window.OCAuth&&typeof marcarComisionPagada==='function'&&window.OCI18n);
   const ids=await page.evaluate(async lang=>{
    OCAuth.rolActual=()=> 'dueno';OCI18n.setLang(lang);
    const req=async(u,m='GET',b)=>(await fetch(u,{method:m,body:b?JSON.stringify(b):undefined})).json();
    const person=await req('/api/promotoras','POST',{nombre:'Synthetic Pending',comisionBase:40});
    const rack=await req('/api/ubicaciones','POST',{nombre:'Synthetic Pending rack',tipo:'socio'});
    await req('/api/ubicaciones/'+rack.id,'PUT',{promotoraId:person.id});
    const prod=await req('/api/productos','POST',{nombre:'Synthetic Pending cup',barcode:'PENDING-CUP',precio:100,costo:20,stockInicial:2,ubicacionId:rack.id});
    await req('/api/productos/'+prod.id+'/venta','POST',{cantidad:1});
    await cargarComisiones();
    window.__paymentPostCount=0;const orig=window.fetch;
    window.fetch=(u,o)=>{if(String(u).includes('marcar-pagado')&&o&&o.method==='POST')window.__paymentPostCount++;return orig(u,o);};
    return {rack:rack.id,person:person.id};
   },lang);
   await page.evaluate(ids=>{window.__pendingRun=marcarComisionPagada(ids.rack,'Synthetic Pending',40,ids.person);},ids);
   const pending=lang==='es'?'Dejar saldo pendiente':'Leave balance owed';
   const button=page.locator('#oc-modal-botones button').filter({hasText:pending});
   await button.waitFor({timeout:5000});
   const b=await button.boundingBox();assert.ok(b.x>=0&&b.x+b.width<=390,'pending action fits mobile');
   await button.click();
   await page.waitForFunction(()=>document.getElementById('oc-modal-msg').textContent.includes('40.00'));
   const notice=await page.locator('#oc-modal-msg').innerText();
   assert.match(notice,lang==='es'?/no.*registr.*pago/i:/no payment.*recorded/i);
   assert.match(notice,lang==='es'?/compras.*todavía|compras.*aún/i:/purchases.*not available yet/i);
   await page.locator('#oc-modal-botones button').first().click();
   const unchanged=await page.evaluate(async ids=>{
    await window.__pendingRun;const rows=await (await fetch('/api/liquidaciones')).json();
    return {posts:window.__paymentPostCount,payouts:(await (await fetch('/api/payouts')).json()).length,due:rows.find(x=>x.ubicacionId===ids.rack).stillDue};
   },ids);
   assert.deepEqual(unchanged,{posts:0,payouts:0,due:40});
   // Actual partial payment follows the existing durable, idempotent path.
   await page.evaluate(ids=>{window.__paymentRun=marcarComisionPagada(ids.rack,'Synthetic Pending',40,ids.person);},ids);
   await page.locator('#oc-modal-botones button').filter({hasText:lang==='es'?'Efectivo':'Cash'}).click();
   await page.waitForSelector('#oc-prompt-input');
   await page.locator('#oc-prompt-input').fill('15.00');
   await page.locator('#oc-modal-botones button').last().click();
   await page.waitForFunction(()=>document.getElementById('oc-modal-msg').textContent.includes('25.00'),null,{timeout:5000}).catch(async error=>{
    error.message+=' Current payment dialog: '+await page.locator('#oc-modal-msg').innerText();throw error;
   });
   const confirmation=await page.locator('#oc-modal-msg').innerText();
   assert.match(confirmation,/15\.00/);assert.match(confirmation,/25\.00/);
   assert.match(confirmation,lang==='es'?/saldo a favor/i:/balance in their favor/i);
   await page.locator('#oc-modal-botones button').first().click();
   const paid=await page.evaluate(async ids=>{
    await window.__paymentRun;const rows=await (await fetch('/api/liquidaciones')).json();
    const payouts=await (await fetch('/api/payouts')).json();
    return {posts:window.__paymentPostCount,payouts:payouts.length,method:payouts[0].method,amount:payouts[0].amountCents,due:rows.find(x=>x.ubicacionId===ids.rack).stillDue};
   },ids);
   assert.deepEqual(paid,{posts:1,payouts:1,method:'efectivo',amount:1500,due:25});
  }finally{await browser.close();}
 });
}
