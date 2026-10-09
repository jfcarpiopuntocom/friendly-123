const {test}=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {chromium,webkit}=require('playwright');
const api=(page,u,m='GET',b)=>page.evaluate(async({u,m,b})=>{
 const r=await fetch(u,{method:m,body:b?JSON.stringify(b):undefined});
 if(!r.ok)throw Error(await r.text());return r.json();
},{u,m,b});
for(const [engineName,engine] of [['Chromium',chromium],['WebKit',webkit]])for(const mode of ['excess','conflict']){
 test(`local dashboard preserves money review in product and rack views (${engineName}, ${mode})`,async()=>{
  const web=await engine.launch({headless:true});
  try{
   const ctx=await web.newContext();
   await ctx.route(u=>!/^(file|data|blob|about):/i.test(String(u)),r=>r.abort());
   await ctx.addInitScript(()=>{
    window.WebSocket=class{constructor(){this.readyState=3}send(){}close(){}addEventListener(){}removeEventListener(){}};
    localStorage.setItem('f123::f123_owned',JSON.stringify({licenseCode:'SYNTHETIC-DASHBOARD-ONLY',instanceId:'synthetic-dashboard-device',nombreNegocio:'Synthetic money review'}));
   });
   const app=await ctx.newPage();
   await app.goto(pathToFileURL(path.resolve(__dirname,'../docs/index.html')).href,{waitUntil:'load'});
   await app.evaluate(async()=>{
    OCAuth.rolActual=()=> 'dueno';localStorage.setItem('f123_owned',JSON.stringify({licenseCode:'SYNTHETIC-DASHBOARD-ONLY',nombreNegocio:'Synthetic money review'}));
    await OCSecure.guardarSecreto('789',['260'],'357','');
   });
   const person=await api(app,'/api/promotoras','POST',{nombre:'Synthetic payee',comisionBase:40});
   const rack=await api(app,'/api/ubicaciones','POST',{nombre:'Synthetic review rack',tipo:'socio'});
   await api(app,'/api/ubicaciones/'+rack.id,'PUT',{promotoraId:person.id});
   const product=await api(app,'/api/productos','POST',{nombre:'Synthetic review item',barcode:'DASH-REVIEW',precio:100,costo:20,stockInicial:3,ubicacionId:rack.id});
   await api(app,'/api/productos/'+product.id+'/venta','POST',{cantidad:1});
   await api(app,'/api/payouts','POST',{ubicacionId:rack.id,payeeId:person.id,amountCents:mode==='excess'?3000:1000,medioPago:'efectivo',opId:'synthetic-review-a'});
   await app.evaluate(mode=>{
    const cat=OCSync.catalogoPropio(),original=cat.payouts.find(p=>p.opId==='synthetic-review-a');
    const other=JSON.parse(JSON.stringify(original));other.id='synthetic-review-b';
    if(mode==='excess')other.opId='synthetic-review-b';
    else{other.amountCents=2000;other.amount=20;other.items[0].amountCents=2000;}
    OCSync.aplicarCatalogo({...cat,payouts:[...cat.payouts,other]},'dueno');
   },mode);
   await app.evaluate(async()=>{document.getElementById('oc-gate')?.remove();await cargarComisiones();cambiarVistaComisiones('product');});
   const card=app.locator('[data-comm-product-card][data-product-id="'+product.id+'"]');
   assert.match(await card.innerText(),/review payments/i);
   assert.equal(await card.locator('[data-comm-pay-from-product]').count(),0);
   assert.equal(await card.locator('.badge-estado.verde').count(),0);
   if(mode==='excess')assert.match(await card.innerText(),/Overpaid: \$20\.00/);
   else assert.match(await card.innerText(),/\$10\.00 \/ \$20\.00|\$20\.00 \/ \$10\.00/);
   const saleRows=await api(app,'/api/ventas/todas');
   assert.equal(saleRows.find(v=>v.productoId===product.id).comisionPendiente,mode==='conflict'?40:-20,'all summaries use verified receipts and retain excess cents');
   const dash=await ctx.newPage();await dash.goto(pathToFileURL(path.resolve(__dirname,'../docs/dashboard.html')).href+'#/comisiones',{waitUntil:'load'});
   await dash.locator('#pin').fill('789');await dash.locator('#entrar').click();
   await dash.waitForFunction(()=>getComputedStyle(document.getElementById('tablero')).display!=='none');
   for(const view of ['producto','percha']){
    await dash.locator('[data-cm-vista='+view+']').click();
    const text=await dash.locator('#cm').innerText();
    assert.match(text,/review payments/i);assert.equal(await dash.locator('#cm a.pagar').count(),0,text);
    assert.equal(await dash.locator('#cm .cm-chip.ok').count(),0);
    assert.ok(await dash.locator('[data-dashboard-money-review]').count());
    if(mode==='excess'){assert.match(text,/Overpaid: \$20\.00/);assert.match(text,/\$-20\.00|-\$20\.00/);assert.match(text,/Recorded paid: \$60\.00/);}
    else{assert.match(text,/Conflicting receipts:/);assert.match(text,/\$10\.00 \/ \$20\.00|\$20\.00 \/ \$10\.00/);assert.match(text,/\$40\.00/);}
   }
   assert.equal((await api(app,'/api/productos')).find(p=>p.id===product.id).stockActual,2);
  }finally{await web.close();}
 });
}
