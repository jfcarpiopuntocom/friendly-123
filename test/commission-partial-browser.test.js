const {test}=require('node:test');
const assert=require('node:assert/strict');
const {chromium,webkit}=require('playwright');
const {pathToFileURL}=require('node:url');
const path=require('node:path');
for(const [name,engine] of [['Chromium',chromium],['WebKit',webkit]]){
 test(`partial commission (${name}): failed durable write preserves due and photos; retry survives reload`,async()=>{
  const browser=await engine.launch({headless:true});
  try{
   const page=await browser.newPage({viewport:{width:390,height:844}});
   await page.goto(pathToFileURL(path.resolve(__dirname,'../docs/index.html')).href,{waitUntil:'domcontentloaded'});
   // Application readiness, rather than a quiet network, is the prerequisite.
   await page.waitForFunction(()=>window.OCAuth&&window.OCPayoutLedger&&typeof cargarComisiones==='function');
   const result=await page.evaluate(async()=>{
    window.OCAuth.rolActual=()=> 'dueno';
    const req=async(url,body)=>{const r=await fetch(url,body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:undefined);return {status:r.status,body:await r.json()}};
    const a=(await req('/api/promotoras',{nombre:'Synthetic Partial',comisionBase:40})).body;
    const r=(await req('/api/ubicaciones',{nombre:'Synthetic rack',tipo:'socio'})).body;
    await fetch('/api/ubicaciones/'+r.id,{method:'PUT',body:JSON.stringify({promotoraId:a.id})});
    const p=(await req('/api/productos',{nombre:'Synthetic cup',barcode:'PARTIAL-BROWSER',precio:100,costo:20,stockInicial:2,ubicacionId:r.id})).body;
    await req('/api/productos/'+p.id+'/venta',{cantidad:1});
    const payload={ubicacionId:r.id,payeeId:a.id,opId:'synthetic-durable-browser',amountCents:1500,medioPago:'efectivo'};
    localStorage.setItem('f123_foto_percha_fixture','synthetic-photo-bytes');
    const original=Storage.prototype.setItem,mirror=window.OCEstadoIDB;let failure=true;
    Storage.prototype.setItem=function(...args){if(failure)throw new DOMException('Synthetic full','QuotaExceededError');return original.apply(this,args)};
    window.OCEstadoIDB={guardar:async()=>false};
    const failed=await req('/api/payouts',payload);
    const photo=localStorage.getItem('f123_foto_percha_fixture');
    const failedPayouts=(await req('/api/payouts')).body;
    failure=false;Storage.prototype.setItem=original;window.OCEstadoIDB=mirror;
    await cargarComisiones();
    const initialText=document.querySelector('[data-comm-person-card][data-payee-id="'+a.id+'"]').innerText;
    const saved=await req('/api/payouts',payload);const retry=await req('/api/payouts',payload);
    await cargarComisiones();
    const card=document.querySelector('[data-comm-person-card][data-payee-id="'+a.id+'"]');
    const rect=card.getBoundingClientRect();
    return {failedStatus:failed.status,failedPayouts:failedPayouts.length,photo,initialText,savedStatus:saved.status,retryExisting:retry.body.existing,
     cardText:card.innerText,left:rect.left,right:rect.right,width:innerWidth,payeeId:a.id,rackId:r.id};
   });
   assert.equal(result.failedStatus,507);assert.equal(result.failedPayouts,0);assert.equal(result.photo,'synthetic-photo-bytes');
   assert.match(result.initialText,/40\.00/);assert.equal(result.savedStatus,200);assert.equal(result.retryExisting,true);
   assert.match(result.cardText,/15\.00/);assert.match(result.cardText,/25\.00/);assert.match(result.cardText,/partially paid/i);
   assert.ok(result.left>=0&&result.right<=result.width+1);
   await page.reload({waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.OCAuth&&window.OCPayoutLedger);
   const restored=await page.evaluate(async(rackId)=>{
    window.OCAuth.rolActual=()=> 'dueno';const r=await fetch('/api/liquidaciones');return (await r.json()).find(x=>x.ubicacionId===rackId).stillDue;
   },result.rackId);
   assert.equal(restored,25);
  }finally{await browser.close()}
 });
}
