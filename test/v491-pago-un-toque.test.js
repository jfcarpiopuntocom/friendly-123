// v491 (JFC 2026-10-13): "tuve que aplastar 3 veces este boton para que funcione".
// The product card button "Record full/partial payment" must open the payment
// choices with ONE tap when there is exactly one person to pay.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium,webkit}=require('playwright');
const ORIGIN='http://localhost:18491',DOCS=path.resolve(__dirname,'../docs');
for(const [name,engine] of [['Chromium',chromium],['WebKit',webkit]]){
 test('one tap on the product payment button opens the payment choices ('+name+')',async()=>{
 const web=await engine.launch({headless:true});try{
 const ctx=await web.newContext({viewport:{width:390,height:844},serviceWorkers:'block'});
 await ctx.route('**/*',async r=>{const u=new URL(r.request().url());if(u.origin!==ORIGIN)return r.abort();const f=path.resolve(DOCS,u.pathname.slice(1));if(!f.startsWith(DOCS+path.sep))return r.abort();try{await r.fulfill({status:200,contentType:({'.html':'text/html','.js':'application/javascript','.json':'application/json','.css':'text/css'})[path.extname(f)]||'application/octet-stream',body:fs.readFileSync(f)});}catch{await r.fulfill({status:404,body:'Missing fixture asset'});}});
 await ctx.addInitScript(()=>{window.WebSocket=class{constructor(){this.readyState=3}addEventListener(){}send(){}close(){}};});
 const page=await ctx.newPage();await page.goto(ORIGIN+'/index.html');
 await page.waitForFunction(()=>window.AMG&&window.OCAuth&&typeof cargarComisiones==='function');
 const pid=await page.evaluate(async()=>{
  OCAuth.rolActual=()=> 'dueno';if(window.OCTabSession)OCTabSession.isCurrent=()=>true;
  document.querySelectorAll('[id*="gate"]').forEach(e=>e.style.display='none');
  const req=async(u,m,b)=>{const r=await fetch(u,{method:m,body:JSON.stringify(b)});if(!r.ok)throw Error(await r.text());return r.json()};
  const person=await req('/api/promotoras','POST',{nombre:'Synthetic payee v491',comisionBase:40});
  const rack=await req('/api/ubicaciones','POST',{nombre:'Synthetic rack v491',tipo:'socio'});
  await req('/api/ubicaciones/'+rack.id,'PUT',{promotoraId:person.id});
  const p=await req('/api/productos','POST',{nombre:'Synthetic v491 item',barcode:'SYNTH-V491',precio:10,costo:2,stockInicial:5,ubicacionId:rack.id});
  await req('/api/productos/'+p.id+'/venta','POST',{cantidad:2,info:{formaPago:'cash'}});
  await cargarComisiones();
  const btn=document.querySelector('[data-comm-pay-from-product="'+rack.id+'"]');
  if(!btn)throw Error('payment button not rendered');
  document.querySelectorAll('.vista').forEach(e=>e.classList.remove('activa'));btn.closest('.vista').classList.add('activa');
  return p.id;});
 await page.locator('[data-comm-pay-product="'+pid+'"]').click();
 await page.locator('#oc-modal-botones button',{hasText:/^(Cash|Efectivo)$/}).waitFor({state:'visible',timeout:5000});
 }finally{await web.close();}
 });
}
