'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {webkit}=require('playwright');
const {startServer,openDevice,go}=require('./helpers/e2e-app.cjs');

test('Owner screen and explicit edit use the confirmed credential despite stale local copies',{timeout:35000},async()=>{
 const {srv,base}=await startServer();let browser;
 try{
  browser=await webkit.launch({headless:true});
  const {page}=await openDevice(browser,base,{width:390,height:650});
  page.setDefaultTimeout(5000);
  await page.waitForFunction(()=>OCYjs.estado==='activo'&&OCYjs.meta);
  await page.evaluate(async()=>{
   await OCSecure.guardarSecreto('642',['583'],'914','synthetic@example.invalid');
   OCYjs.canal.recuperando=false;
   OCYjs.meta.set('pinsRol',{owner:'731',emp:'583',acct:'914'});
   OCYjs.meta.set('ownerPinConfirmado','731');
  });
  for(const d of '731')await page.locator('#oc-pad button[data-d="'+d+'"]').click();
  await page.waitForFunction(()=>OCAuth.rolActual()==='dueno');
  if(await page.locator('#am-welcome.abierto').isVisible())await page.locator('#am-welcome button').last().click();
  const product=await page.evaluate(async()=>{
   const r=await fetch('/api/productos',{method:'POST',body:JSON.stringify({nombre:'Synthetic PIN preservation item',barcode:'PIN-CURRENT-UI',precio:12,costo:4,stockInicial:3})});
   if(!r.ok)throw Error('Synthetic product rejected '+r.status+': '+await r.text());return r.json();
  });
  // A restored session may still hold the old successful-PIN sidecar.
  await page.evaluate(()=>OCSecure.recordarPinQueAbre('642','dueno'));
  await go(page,'avanzado');
  const shown=await page.locator('#oc-pins-visibles-cuerpo > div').first().locator('[data-pin]').getAttribute('data-pin');
  const before=await page.evaluate(()=>JSON.parse(localStorage.getItem('f123_secure')));
  // A legacy peer may already carry the requested PIN in pinsRol while the
  // separate explicit credential still holds its previous value.
  await page.evaluate(()=>OCYjs.meta.set('pinsRol',{owner:'846',emp:'583',acct:'914'}));
  const replies=['846','846',null];page.on('dialog',d=>{const answer=replies.shift();return answer==null?d.dismiss():d.accept(answer);});
  await page.locator('[data-pin-edit="owner"]').click();
  await page.waitForFunction(()=>document.getElementById('oc-codes-msg')?.textContent.trim());
  const after=await page.evaluate(async id=>({
   confirmed:OCYjs.meta.get('ownerPinConfirmado'),role:await OCSecure.identificarPin('846'),
   oldRole:await OCSecure.identificarPin('731'),secure:JSON.parse(localStorage.getItem('f123_secure')),
   product:await(await fetch('/api/productos/'+id)).json(),message:document.getElementById('oc-codes-msg').textContent
  }),product.id);
  assert.equal(shown,'731','the screen must show the credential that admitted the owner, not the stale sidecar');
  assert.equal(after.confirmed,'846','partial pinsRol equality must not skip the explicit credential update');
  assert.equal(after.role,'dueno');assert.equal(after.oldRole,null);
  assert.deepEqual(after.secure.employeeHashes,before.employeeHashes);assert.equal(after.secure.acctHash,before.acctHash);
  assert.equal(after.secure.email,before.email);assert.equal(after.product.stockActual,3);assert.equal(after.product.precio,12);
  assert.doesNotMatch(after.message,/could not update/i);
 }finally{await browser?.close();await new Promise(resolve=>srv.close(resolve));}
});
