const {test}=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const fs=require('node:fs');
const {chromium,webkit}=require('playwright');
const DOCS=path.resolve(__dirname,'../docs'),ORIGIN='http://localhost:18477';
const api=(page,u,m='GET',b)=>page.evaluate(async({u,m,b})=>{
 const r=await fetch(u,{method:m,body:b?JSON.stringify(b):undefined});
 if(!r.ok)throw Error(await r.text());return r.json();
},{u,m,b});
for(const [engineName,engine] of [['Chromium',chromium],['WebKit',webkit]])for(const mode of ['excess','conflict']){
 test(`local dashboard preserves money review in product and rack views (${engineName}, ${mode})`,async()=>{
  const web=await engine.launch({headless:true});
  try{
   // file:// storage sharing is undefined. Use one real browser origin for
   // app/dashboard; fulfill static files locally and block every external URL.
   const ctx=await web.newContext({serviceWorkers:'block'});
   await ctx.route('**/*',async route=>{
    const url=new URL(route.request().url());
    if(url.origin!==ORIGIN)return route.abort();
    const file=path.resolve(DOCS,decodeURIComponent(url.pathname).slice(1));
    if(!file.startsWith(DOCS+path.sep))return route.abort();
    const type={'.html':'text/html','.js':'application/javascript','.css':'text/css','.json':'application/json','.png':'image/png','.woff2':'font/woff2'}[path.extname(file)]||'application/octet-stream';
    try{await route.fulfill({status:200,contentType:type,body:fs.readFileSync(file)});}catch(_){await route.fulfill({status:404,body:'Not found'});}
   });
   await ctx.addInitScript(()=>{
    window.WebSocket=class{constructor(){this.readyState=3}send(){}close(){}addEventListener(){}removeEventListener(){}};
    localStorage.setItem('f123::f123_owned',JSON.stringify({licenseCode:'SYNTHETIC-DASHBOARD-ONLY',instanceId:'synthetic-dashboard-device',nombreNegocio:'Synthetic money review'}));
   });
   const app=await ctx.newPage();
   await app.goto(ORIGIN+'/index.html',{waitUntil:'load'});
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
   const dash=await ctx.newPage();await dash.goto(ORIGIN+'/dashboard.html#/comisiones',{waitUntil:'load'});
   const prepared=await dash.evaluate(productId=>{
    const base='f123_estado_v4'+(localStorage.getItem('f123_tienda_activa')||'');
    const ptr=localStorage.getItem(base+'_ptr')||'B';
    const state=JSON.parse(localStorage.getItem(base+'_'+ptr)||'null');
    const receipts=(state?.payouts||[]).concat((state?.payoutConflicts||[]).flatMap(conflict=>conflict.records||[]));
    return {ownsNotebook:!!localStorage.getItem('f123_owned'),localStateReady:!!state,productPresent:!!state?.productos?.some(p=>p.id===productId),receiptEvidence:new Set(receipts.map(receipt=>receipt.id)).size};
   },product.id);
   assert.deepEqual(prepared,{ownsNotebook:true,localStateReady:true,productPresent:true,receiptEvidence:2},'same-origin dashboard must read the durable fixture before attempting login');
   await dash.locator('#pin').fill('789');await dash.locator('#entrar').click();
   try {
    await dash.waitForFunction(()=>getComputedStyle(document.getElementById('tablero')).display!=='none');
   } catch(error) {
    // Preserve the failing condition; report state instead of retrying a PIN or
    // silently treating a timed-out login as a passed financial assertion.
    const state=await dash.evaluate(()=>({message:document.getElementById('msg')?.textContent,busy:document.getElementById('entrar')?.disabled,cryptoLoaded:!!window.OCSecure,tableroVisible:getComputedStyle(document.getElementById('tablero')).display!=='none'}));
    error.message+='; dashboard login state: '+JSON.stringify(state);
    throw error;
   }
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
