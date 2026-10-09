const {test}=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const fs=require('node:fs');
const {pathToFileURL}=require('node:url');
const {chromium,webkit}=require('playwright');
for(const [name,engine] of [['Chromium',chromium],['WebKit',webkit]])for(const lang of ['en','es']){
 test(`customer payment holds submit and recovers lost response after reload (${name}, ${lang})`,async()=>{
  const web=await engine.launch({headless:true});
  try{
   const page=await web.newPage();await page.goto(pathToFileURL(path.resolve(__dirname,'../docs/index.html')).href,{waitUntil:'domcontentloaded'});
   await page.waitForFunction(()=>window.AMG&&AMG.Hechos&&window.abonarCliente&&window.OCI18n);
   if(process.env.F123_PAYMENT_BASELINE)await page.addScriptTag({content:fs.readFileSync(path.join(process.env.F123_PAYMENT_BASELINE,'plan-pagos-ui.js'),'utf8')});
   const id=await page.evaluate(async lang=>{
    OCAuth.rolActual=()=> 'dueno';OCI18n.setLang(lang);document.getElementById('oc-gate')?.remove();
    const c=await (await fetch('/api/clientes',{method:'POST',body:JSON.stringify({nombre:'Synthetic payment fixture'})})).json();
    await fetch('/api/clientes/'+c.id+'/fiar',{method:'POST',body:JSON.stringify({monto:15})});
    const orig=window.fetch;
    window.fetch=async(u,o)=>{
     const result=await orig(u,o);
     if(String(u).endsWith('/abonar')&&o&&o.method==='POST'){
      window.__paymentBody=JSON.parse(o.body);
      await new Promise(r=>{window.__releasePayment=r});
      throw Error('synthetic lost response');
     }
     return result;
    };
    abonarCliente(c.id,'Synthetic payment fixture');return c.id;
   },lang);
   await page.locator('#pp-ab-monto').fill('15');await page.locator('#pp-ab-ok').click();
   await page.waitForFunction(()=>typeof window.__releasePayment==='function');
   await new Promise(r=>setTimeout(r,1200));
   assert.equal(await page.locator('#pp-ab-ok').isDisabled(),true,'submit remains locked while the payment is pending');
   assert.ok(await page.evaluate(()=>window.__paymentBody.opId),'an intention key travels to the durable receipt');
   await page.evaluate(()=>window.__releasePayment());
   await page.waitForFunction(()=>document.getElementById('pp-ab-msg').textContent.length>0);
   const facts=await page.evaluate(()=>AMG.Hechos.todos());assert.equal(facts.filter(h=>h.tipo==='cartera_abono').length,1);
   await page.reload({waitUntil:'domcontentloaded'});
   await page.waitForFunction(()=>window.abonarCliente&&window.AMG&&AMG.Hechos);
   await page.evaluate(({id,lang})=>{OCAuth.rolActual=()=> 'dueno';OCI18n.setLang(lang);document.getElementById('oc-gate')?.remove();abonarCliente(id,'Synthetic payment fixture');},{id,lang});
   await page.waitForFunction(()=>document.getElementById('pp-ab-monto').value==='15.00');
   await page.locator('#pp-ab-ok').click();await page.waitForFunction(()=>!document.getElementById('pp-modal-abono'));
   const final=await page.evaluate(async id=>({info:await (await fetch('/api/clientes/'+id+'/cartera')).json(),facts:await AMG.Hechos.todos()}),id);
   assert.equal(final.info.saldo,0);assert.equal(final.facts.filter(h=>h.tipo==='cartera_abono').length,1);
   assert.equal(final.info.integridad.ok,true);assert.deepEqual(final.facts,facts,'confirmation retry preserves the exact original receipts');
   await page.evaluate(async id=>{await cargarClientes();await pintarSaldoCartera(id);},id);
   assert.match(await page.locator('#cartera-'+id).innerText(),lang==='es'?/Cuenta saldada/:/Account settled/);
   assert.match(await page.locator('#cartera-'+id).innerText(),/15\.00/);
  }finally{await web.close();}
 });
}
