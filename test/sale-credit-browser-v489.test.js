const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium,webkit}=require('playwright');
const ORIGIN='http://localhost:18489',DOCS=path.resolve(__dirname,'../docs');
for(const [name,engine] of [['Chromium',chromium],['WebKit',webkit]])for(const lang of ['en','es']){
 test('sale correction UI, reload and durable balance ('+name+', '+lang+')',async()=>{
 const web=await engine.launch({headless:true});try{
 const ctx=await web.newContext({viewport:{width:390,height:844},serviceWorkers:'block'});
 await ctx.route('**/*',async r=>{const u=new URL(r.request().url());if(u.origin!==ORIGIN)return r.abort();const f=path.resolve(DOCS,u.pathname.slice(1));if(!f.startsWith(DOCS+path.sep))return r.abort();try{await r.fulfill({status:200,contentType:({'.html':'text/html','.js':'application/javascript','.json':'application/json','.css':'text/css'})[path.extname(f)]||'application/octet-stream',body:fs.readFileSync(f)});}catch{await r.fulfill({status:404,body:'Missing fixture asset'});}});
 await ctx.addInitScript(()=>{window.WebSocket=class{constructor(){this.readyState=3}addEventListener(){}send(){}close(){}};});
 const page=await ctx.newPage();await page.goto(ORIGIN+'/index.html');
 await page.waitForFunction(()=>window.AMG&&AMG.Hechos&&window.OCAuth&&typeof cargarGridVender==='function');
 const fx=await page.evaluate(async lang=>{
 OCAuth.rolActual=()=> 'dueno';if(window.OCTabSession)OCTabSession.isCurrent=()=>true;
 OCI18n.setLang(lang);document.querySelectorAll('[id*="gate"]').forEach(e=>e.style.display='none');
 const req=async(u,m,b)=>{const r=await fetch(u,{method:m,body:JSON.stringify(b)});if(!r.ok)throw Error(await r.text());return r.json()};
 const c=await req('/api/clientes','POST',{nombre:'Synthetic UI customer'});
 const p=await req('/api/productos','POST',{nombre:'Synthetic UI item',barcode:'SYNTH-UI-489',precio:10,costo:2,stockInicial:20});
 document.querySelectorAll('.vista').forEach(e=>e.classList.remove('activa'));document.getElementById('gridVender').closest('.vista').classList.add('activa');
 await cargarGridVender();return{c:c.id,p:p.id};},lang);
 await page.locator('[data-vender-tile="'+fx.p+'"]').click();
 await page.locator('#vi-cliente').selectOption(fx.c);await page.locator('#vi-cantidad').fill('2');
 assert.equal(await page.locator('#vi-cantidad').isVisible(),true);
 await page.locator('[onclick*="confirmarVentaConInfo"]').click();
 await page.waitForFunction(()=>!document.getElementById('vi-cliente'));
 const id=await page.evaluate(async fx=>{
 const rows=await (await fetch('/api/ventas/todas')).json();const s=rows.find(v=>v.productoId===fx.p);if(!s||s.cantidad!==2)throw Error('UI sale quantity mismatch');
 document.querySelectorAll('.vista').forEach(e=>e.classList.remove('activa'));await cargarVentasSold();
 document.querySelector('.oc-vs-row[data-id="'+s.id+'"]').closest('.vista').classList.add('activa');return s.id;},fx);
 const row=()=>page.locator('.oc-vs-row[data-id="'+id+'"]');
 await page.locator('#ventasSold > summary').click();
 await row().waitFor({state:'visible'});
 async function edit(method,price){await row().locator('.oc-vs-edit').click();if(price)await row().locator('.vs-precio').fill(price);await row().locator('.vs-pago').selectOption(method);await row().locator('.oc-vs-save').click();await page.waitForFunction(({id,method})=>!document.querySelector('.oc-vs-row[data-id="'+id+'"] .oc-vs-editor[style*="block"]'),{id,method});}
 await edit('fiado');await edit('cash','12');await edit('fiado');
 const before=await page.evaluate(async c=>({info:await(await fetch('/api/clientes/'+c+'/cartera')).json(),facts:await AMG.Hechos.todos()}),fx.c);
 assert.equal(before.info.saldo,-24);assert.equal(before.facts.filter(h=>h.tipo==='cartera_cargo').length,1);
 await page.reload();await page.waitForFunction(()=>window.AMG&&AMG.Hechos&&window.OCAuth);
 const after=await page.evaluate(async c=>{OCAuth.rolActual=()=> 'dueno';return {info:await(await fetch('/api/clientes/'+c+'/cartera')).json(),facts:await AMG.Hechos.todos()};},fx.c);
 assert.equal(after.info.saldo,-24);assert.deepEqual(after.facts,before.facts);
 }finally{await web.close();}
 });
}
