const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium,webkit}=require('playwright');
const DOCS=path.resolve(__dirname,'../docs'),ORIGIN='http://localhost:18497';
for(const [name,engine] of [['Chromium',chromium],['WebKit',webkit]])test(`Belén UI: price wheel, expiry sort, settled walk-in credit and dashboard stock (${name})`,async()=>{
 const browser=await engine.launch({headless:true});
 try{
  const ctx=await browser.newContext({viewport:{width:1280,height:900},serviceWorkers:'block'});
  await ctx.route('**/*',async route=>{
   const u=new URL(route.request().url());if(u.origin!==ORIGIN)return route.abort();
   const file=path.resolve(DOCS,u.pathname.slice(1));if(!file.startsWith(DOCS+path.sep))return route.abort();
   try{let body=fs.readFileSync(file);if(u.pathname==='/dashboard.html')body=Buffer.from(body.toString().replace('  window.OCDashComisiones =','  window.__stockAudit = {receive:recibirTrozo,refresh:refrescarLocal};\n  window.OCDashComisiones ='));
    await route.fulfill({status:200,contentType:({'.html':'text/html','.js':'application/javascript','.json':'application/json','.css':'text/css'})[path.extname(file)]||'application/octet-stream',body});
   }catch(_){await route.fulfill({status:404,body:'fixture asset absent'});}
  });
  await ctx.addInitScript(()=>{window.WebSocket=class{constructor(){this.readyState=3}send(){}close(){}addEventListener(){}removeEventListener(){}};});
  const app=await ctx.newPage();await app.goto(ORIGIN+'/index.html');await app.waitForFunction(()=>window.OCAuth&&window.OCSecure&&window.AMG?.Hechos);
  const fx=await app.evaluate(async()=>{
   OCAuth.rolActual=()=> 'dueno';if(window.OCTabSession)OCTabSession.isCurrent=()=>true;
   localStorage.setItem('f123_owned',JSON.stringify({licenseCode:'F123-TEST-0000-0000-00000',nombreNegocio:'Synthetic Belén regression'}));
   await OCSecure.guardarSecreto('789',[],'357','');
   document.querySelectorAll('[id*="gate"]').forEach(e=>e.style.display='none');document.body.style.overflow='';
   const req=async(u,b)=>{const r=await fetch(u,{method:'POST',body:JSON.stringify(b)});if(!r.ok)throw Error(await r.text());return r.json()};
   const client=await req('/api/clientes',{nombre:'Synthetic first debtor'});
   const person=await req('/api/promotoras',{nombre:'Synthetic paid associate',comisionBase:40});
   const rack=await req('/api/ubicaciones',{nombre:'Synthetic expiry rack',tipo:'socio'});
   const put=await fetch('/api/ubicaciones/'+rack.id,{method:'PUT',body:JSON.stringify({promotoraId:person.id})});if(!put.ok)throw Error(await put.text());
   const p=await req('/api/productos',{nombre:'Synthetic later',barcode:'BELEN-LATER',precio:10,costo:2,stockInicial:2,ubicacionId:rack.id,perecible:true,fechaCaducidad:'2099-12-10'});
   const soon=await req('/api/productos',{nombre:'Synthetic soon',barcode:'BELEN-SOON',precio:10,costo:2,stockInicial:4,ubicacionId:rack.id,perecible:true,fechaCaducidad:'2099-10-15'});
   const sold=await req('/api/productos/'+p.id+'/venta',{cantidad:2,info:{formaPago:'cash'}});
   await req('/api/liquidaciones/'+rack.id+'/marcar-pagado',{payeeId:person.id,amountCents:400,medioPago:'efectivo',opId:'belen-first-debtor-browser'});
   const sale=(await(await fetch('/api/ventas/todas')).json()).find(v=>v.id===sold.ventaId);
   document.querySelectorAll('.vista').forEach(e=>e.classList.remove('activa'));document.getElementById('vista-escanear').classList.add('activa');
   await mostrarFormNuevoProducto('');return {client:client.id,p:p.id,soon:soon.id,sale:sold.ventaId,commission:sale.comisionAsociado};
  });
  const price=app.locator('#np-precio');await price.fill('100');await price.focus();await price.hover();
  const scrollBefore=await app.evaluate(()=>[...document.querySelectorAll('*')].reduce((n,e)=>n+e.scrollTop,0));
  await app.mouse.wheel(0,100);await app.waitForTimeout(120);assert.equal(await price.inputValue(),'100');
  const scrollAfter=await app.evaluate(()=>[...document.querySelectorAll('*')].reduce((n,e)=>n+e.scrollTop,0));
  assert.ok(scrollAfter>scrollBefore,'wheel must continue scrolling the form');
  assert.equal(await price.evaluate(e=>document.activeElement===e),false,'wheel leaves price editing and scrolls normally');
  await price.fill('101.50');assert.equal(await price.inputValue(),'101.50','explicit typing still works');
  await app.evaluate(async()=>{document.querySelectorAll('.vista').forEach(e=>e.classList.remove('activa'));document.getElementById('vista-inventario').classList.add('activa');await cargarInventario();});
  const expiry=app.locator('[data-ord-inv-col="fechaCaducidad"]');await expiry.waitFor({state:'visible'});assert.match(await expiry.innerText(),/Expiry|caducidad/i);await expiry.click();
  await app.waitForFunction(()=>{const txt=document.getElementById('gridInventario').innerText;return txt.indexOf('Synthetic soon')<txt.indexOf('Synthetic later')&&txt.includes('Synthetic later')});
  await app.evaluate(async()=>{document.querySelectorAll('.vista').forEach(e=>e.classList.remove('activa'));document.getElementById('vista-escanear').classList.add('activa');await cargarVentasSold();});
  await app.locator('#ventasSold > summary').click();const row=()=>app.locator('.oc-vs-row[data-id="'+fx.sale+'"]');
  await row().locator('.oc-vs-edit').click();await row().locator('.vs-pago').selectOption('fiado');
  assert.equal(await row().locator('.vs-cliente').isEnabled(),true);await row().locator('.vs-cliente').selectOption(fx.client);await row().locator('.oc-vs-save').click();
  await app.waitForFunction(id=>!document.querySelector('.oc-vs-row[data-id="'+id+'"] .oc-vs-editor[style*="block"]'),fx.sale);
  const result=await app.evaluate(async({client,p,sale})=>({debt:(await(await fetch('/api/clientes/'+client+'/cartera')).json()).saldo,stock:(await(await fetch('/api/productos/'+p)).json()).stockActual,sale:(await(await fetch('/api/ventas/todas')).json()).find(v=>v.id===sale),charges:(await AMG.Hechos.todos()).filter(h=>h.tipo==='cartera_cargo').length}),fx);
  assert.equal(result.debt,-20);assert.equal(result.stock,0);assert.equal(result.charges,1);assert.equal(result.sale.comisionAsociado,fx.commission);
  const dash=await ctx.newPage();await dash.goto(ORIGIN+'/dashboard.html');await dash.locator('#pin').fill('789');await dash.locator('#entrar').click();await dash.locator('#tablero').waitFor({state:'visible'});await dash.locator('a[data-ruta="inventario"]').click();
  const remote={id:fx.p,nombre:'Synthetic later',stockActual:5,precio:10,costo:2};
  await dash.evaluate(p=>__stockAudit.receive({fotoId:'synthetic-new-photo',generadaEn:new Date().toISOString(),tabla:'productos',total:1,i:0,k:0,deTotal:1,filas:[p]}),remote);
  await dash.evaluate(()=>__stockAudit.refresh(true));
  assert.match(await dash.locator('#tabla').innerText(),/Synthetic later/);
  const values=await dash.locator('#tabla tbody tr').first().locator('td').allTextContents();assert.ok(values.includes('5'),'unchanged local zero must not replace newer remote five');
  await dash.evaluate(p=>__stockAudit.receive({fotoId:'synthetic-pending-photo',generadaEn:new Date(Date.now()+10).toISOString(),tabla:'productos',total:1,i:0,k:0,deTotal:1,filas:[p]}),{id:'missing-stock',nombre:'Synthetic pending',precio:10,costo:2});
  assert.match(await dash.locator('#tabla').innerText(),/Stock pending/);
  const missing=await app.evaluate(async()=>{
   const original=window.fetch;window.fetch=async(u,o)=>String(u).startsWith('/api/productos?')?new Response(JSON.stringify([{id:'missing-stock',nombre:'Synthetic pending',categoria:'',sku:'',precio:10,costo:2,estado:'rojo'}]),{status:200,headers:{'Content-Type':'application/json'}}):original(u,o);
   try{document.querySelectorAll('.vista').forEach(e=>e.classList.remove('activa'));document.getElementById('vista-escanear').classList.add('activa');await cargarGridVender();const tile=document.querySelector('[data-vender-tile="missing-stock"]');return {text:tile.innerText,disabled:tile.disabled};}finally{window.fetch=original;}
  });assert.match(missing.text,/Stock pending|Stock pendiente/i);assert.ok(!missing.text.includes('SIN STOCK'));assert.equal(missing.disabled,true);
 }finally{await browser.close()}
});
