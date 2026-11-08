'use strict';
// P0 #616: real browser DOM + real strict-IDB boundary, one apparatus.
// All customer records are synthetic and remain in isolated browser contexts.
// No real license, remote transport, Sync3 shutdown, or production changes.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {chromium,webkit}=require('playwright');

const pageURL=pathToFileURL(path.resolve(__dirname,'../docs/index.html')).href;
const fields=async(page,nombre,telefono,email)=>{
  await page.locator('#cliAltaPlegable').evaluate(el=>{el.open=true;});
  await page.locator('#cliNombre').fill(nombre);
  await page.locator('#cliTelefono').fill(telefono);
  await page.locator('#cliEmail').fill(email);
};
const formState=page=>page.evaluate(()=>{
 const get=id=>document.getElementById(id);
 return {
  nombre:get('cliNombre').value,telefono:get('cliTelefono').value,email:get('cliEmail').value,
  disabled:get('btnAltaCliente').disabled,pending:!!window.__f123AltaClientePendiente,
  msg:get('cliMsg').textContent
 };
});

for(const [engineName,engine] of [['Chromium',chromium],['WebKit',webkit]]){
 test('P0 browser '+engineName+': delayed Add is single-flight, durable after reopen, rejected Add keeps full form',
  {timeout:60000},async()=>{
  const browser=await engine.launch({headless:true});
  try{
   const context=await browser.newContext();
   const page=await context.newPage();
   page.setDefaultTimeout(10000);
   await page.goto(pageURL,{waitUntil:'domcontentloaded'});
   await page.waitForFunction(()=>typeof window.cargarClientes==='function'&&
     !!window.OCAuth&&typeof window.OCEstadoIDB?.guardarConRevision==='function');
   await page.evaluate(async()=>{window.OCAuth.rolActual=()=> 'dueno';await cargarClientes();});
   assert.equal(await page.locator('#btnAltaCliente').getAttribute('data-listo'),'1',
     'the actual Add button must have the production click handler');
   const good='Synthetic browser durable customer '+engineName;
   const tel='0000000000',email='customer-browser@example.invalid';
   await fields(page,good,tel,email);
   await page.evaluate(target=>{
     const idb=window.OCEstadoIDB,commit=idb.guardarConRevision.bind(idb);
     let release;
     const held=new Promise(resolve=>{release=resolve;});
     window.__p0CustomerBrowser={calls:0,release:()=>release()};
     idb.guardarConRevision=(state,revision)=>{
       if(!state.clientes?.some(c=>c.nombre===target))return commit(state,revision);
       window.__p0CustomerBrowser.calls++;
       return held.then(()=>commit(state,revision));
     };
   },good);
   await page.locator('#btnAltaCliente').click();
   await page.waitForFunction(()=>window.__p0CustomerBrowser?.calls===1);
   let state=await formState(page);
   assert.equal(state.disabled,true,'button stays disabled while strict IDB ACK is held');
   assert.equal(state.pending,true,'updater guard tracks pending Add');
   assert.equal(state.nombre,good);
   assert.equal(state.telefono,tel);
   assert.equal(state.email,email);
   assert.doesNotMatch(state.msg,/registered|registrado/i,'no success before durable ACK');
   // Dispatch a second click even though browsers normally suppress disabled
   // button clicks. The production handler's own re-entrancy check must hold.
   await page.evaluate(()=>document.getElementById('btnAltaCliente')
     .dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true})));
   assert.equal(await page.evaluate(()=>window.__p0CustomerBrowser.calls),1,
     'double tap must not submit a second strict CAS');
   await page.evaluate(()=>window.__p0CustomerBrowser.release());
   await page.waitForFunction(()=>!window.__f123AltaClientePendiente&&
     /registered|registrad/i.test(document.getElementById('cliMsg')?.textContent||''));
   state=await formState(page);
   assert.equal(state.disabled,false);
   assert.equal(state.nombre,'');
   assert.equal(state.telefono,'');
   assert.equal(state.email,'');
   let records=await page.evaluate(async()=>(await(await fetch('/api/clientes')).json()));
   assert.equal(records.filter(c=>c.nombre===good).length,1,'exactly one durable customer');

   await page.reload({waitUntil:'domcontentloaded'});
   await page.waitForFunction(()=>typeof window.cargarClientes==='function'&&
     !!window.OCAuth&&typeof window.OCEstadoIDB?.guardarConRevision==='function');
   await page.evaluate(async()=>{window.OCAuth.rolActual=()=> 'dueno';await cargarClientes();});
   records=await page.evaluate(async()=>(await(await fetch('/api/clientes')).json()));
   assert.equal(records.filter(c=>c.nombre===good).length,1,'same-device reopening retains the exact client');

   const failed='Synthetic browser rejected customer '+engineName;
   const failTel='0990000000',failEmail='draft-browser@example.invalid';
   await fields(page,failed,failTel,failEmail);
   await page.evaluate(target=>{
     const idb=window.OCEstadoIDB,commit=idb.guardarConRevision.bind(idb);
     idb.guardarConRevision=(snapshot,revision)=>{
       if(snapshot.clientes?.some(c=>c.nombre===target))return Promise.resolve(false);
       return commit(snapshot,revision);
     };
   },failed);
   await page.locator('#btnAltaCliente').click();
   await page.waitForFunction(()=>!window.__f123AltaClientePendiente&&
     !!document.getElementById('cliMsg')?.textContent);
   state=await formState(page);
   assert.equal(state.disabled,false);
   assert.equal(state.nombre,failed,'rejected Add must preserve draft name');
   assert.equal(state.telefono,failTel,'rejected Add must preserve draft phone');
   assert.equal(state.email,failEmail,'rejected Add must preserve draft email');
   assert.match(state.msg,/not saved|could not be saved|no se/i,'rejected Add must display a visible error');
   records=await page.evaluate(async()=>(await(await fetch('/api/clientes')).json()));
   assert.equal(records.filter(c=>c.nombre===failed).length,0,'rejected customer must not appear as saved');
   assert.equal(records.filter(c=>c.nombre===good).length,1,'earlier committed client remains unchanged');
  }finally{await browser.close();}
 });
}
