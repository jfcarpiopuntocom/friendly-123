// Belen 2026-10-12 (idiomARTE): sold 12 IPA to a registered customer. The old
// 2026-09-02 rule hid Quantity when a customer was chosen, so the sale was
// recorded as walk-in + cash. In Sold she could not fix it: v488 added
// "On account (fiado)" to the editor but required a customer that the editor
// had no way to choose. These tests cover the full correction path.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {browser}=require('./helpers/browser.cjs');
const {chromium,webkit}=require('playwright');

// Pinning test for the backend (it already accepted clienteId): walk-in cash ->
// customer + fiado in one PATCH charges the chosen customer exactly once.
test('backend: walk-in cash sale corrected to customer on account charges once',async()=>{
 const facts=[];const w=browser();w.OCAuth={rolActual:()=> 'dueno'};
 w.AMG={Hechos:{todos:async()=>facts.slice(),verificarCadenas:async()=>({ok:true}),registrar:async(tipo,datos)=>{const h={id:'synthetic-'+facts.length,tipo,datos:JSON.parse(JSON.stringify(datos)),ts:Date.now()+facts.length};facts.push(h);return h;}}};
 vm.runInContext(fs.readFileSync(path.join(__dirname,'../docs/cartera.js'),'utf8'),w);
 const c=await w.request('/api/clientes','POST',{nombre:'Synthetic walk-in fix'});
 const p=await w.request('/api/productos','POST',{nombre:'Synthetic IPA',barcode:'SYNTH-WALKIN-489',precio:5,costo:2,stockInicial:30});
 const {ventaId}=await w.request('/api/productos/'+p.id+'/venta','POST',{cantidad:12,info:{formaPago:'cash'}});
 await w.request('/api/ventas/'+ventaId,'PATCH',{clienteId:c.id,info:{formaPago:'fiado'}});
 await w.request('/api/ventas/'+ventaId,'PATCH',{clienteId:c.id,info:{formaPago:'fiado'}});
 const v=(await w.request('/api/ventas/todas')).find(x=>x.id===ventaId);
 assert.equal(v.clienteId,c.id);assert.equal(v.cantidad,12);assert.equal(v.formaPago,'fiado');
 assert.equal((await w.request('/api/clientes/'+c.id+'/cartera')).saldo,-60);
 assert.equal(facts.filter(h=>h.tipo==='cartera_cargo').length,1);
});

const ORIGIN='http://localhost:18490',DOCS=path.resolve(__dirname,'../docs');
for(const [name,engine] of [['Chromium',chromium],['WebKit',webkit]]){
 test('Sold editor lets a walk-in cash sale become a customer on-account sale ('+name+')',async()=>{
 const web=await engine.launch({headless:true});try{
 const ctx=await web.newContext({viewport:{width:390,height:844},serviceWorkers:'block'});
 await ctx.route('**/*',async r=>{const u=new URL(r.request().url());if(u.origin!==ORIGIN)return r.abort();const f=path.resolve(DOCS,u.pathname.slice(1));if(!f.startsWith(DOCS+path.sep))return r.abort();try{await r.fulfill({status:200,contentType:({'.html':'text/html','.js':'application/javascript','.json':'application/json','.css':'text/css'})[path.extname(f)]||'application/octet-stream',body:fs.readFileSync(f)});}catch{await r.fulfill({status:404,body:'Missing fixture asset'});}});
 await ctx.addInitScript(()=>{window.WebSocket=class{constructor(){this.readyState=3}addEventListener(){}send(){}close(){}};});
 const page=await ctx.newPage();await page.goto(ORIGIN+'/index.html');
 await page.waitForFunction(()=>window.AMG&&AMG.Hechos&&window.OCAuth&&typeof cargarVentasSold==='function');
 const fx=await page.evaluate(async()=>{
  OCAuth.rolActual=()=> 'dueno';if(window.OCTabSession)OCTabSession.isCurrent=()=>true;
  document.querySelectorAll('[id*="gate"]').forEach(e=>e.style.display='none');
  const req=async(u,m,b)=>{const r=await fetch(u,{method:m,body:JSON.stringify(b)});if(!r.ok)throw Error(await r.text());return r.json()};
  const c=await req('/api/clientes','POST',{nombre:'Synthetic Sold customer'});
  const p=await req('/api/productos','POST',{nombre:'Synthetic Sold IPA',barcode:'SYNTH-SOLD-489',precio:5,costo:2,stockInicial:30});
  const s=await req('/api/productos/'+p.id+'/venta','POST',{cantidad:12,info:{formaPago:'cash'}});
  await cargarVentasSold();
  document.querySelectorAll('.vista').forEach(e=>e.classList.remove('activa'));
  document.querySelector('.oc-vs-row[data-id="'+s.ventaId+'"]').closest('.vista').classList.add('activa');
  return {c:c.id,id:s.ventaId};});
 const row=()=>page.locator('.oc-vs-row[data-id="'+fx.id+'"]');
 await page.locator('#ventasSold > summary').click();
 await row().locator('.oc-vs-edit').click();
 await row().locator('.vs-cliente').selectOption(fx.c);
 await row().locator('.vs-pago').selectOption('fiado');
 await row().locator('.oc-vs-save').click();
 await page.waitForFunction(id=>!document.querySelector('.oc-vs-row[data-id="'+id+'"] .oc-vs-editor[style*="block"]'),fx.id);
 const r=await page.evaluate(async fx=>({v:(await(await fetch('/api/ventas/todas')).json()).find(x=>x.id===fx.id),bal:await(await fetch('/api/clientes/'+fx.c+'/cartera')).json(),n:(await AMG.Hechos.todos()).filter(h=>h.tipo==='cartera_cargo').length}),fx);
 assert.equal(r.v.clienteId,fx.c);assert.equal(r.v.cantidad,12);assert.equal(r.v.formaPago,'fiado');
 assert.equal(r.bal.saldo,-60);assert.equal(r.n,1);
 }finally{await web.close();}
 });
}
