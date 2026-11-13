'use strict';
// v761: a resolvable A/B conflict must not stop sales. Highest valid revision wins;
// every other copy is kept as evidence. No valid copy -> 507 as before.
const {test}=require('node:test'),assert=require('node:assert/strict');
const {chromium,startServer,openDevice,enterAs}=require('./helpers/e2e-app.cjs');

const committed=()=>{try{const j=JSON.parse(localStorage.getItem('f123_estado_v4_journal'));
  return !!(j&&j.phase==='COMMITTED'&&localStorage.getItem('f123_estado_v4_'+j.destino)===j.candidateRaw);}catch(_){return false;}};

async function escenario(t,inyectar){
  const {srv,base}=await startServer();let browser;
  try{
    browser=await chromium.launch({headless:true});
    const {ctx,page}=await openDevice(browser,base);page.setDefaultTimeout(5000);
    await enterAs(page);
    const pid=await page.evaluate(async()=>{
      const ub=await(await fetch('/api/ubicaciones',{method:'POST',body:JSON.stringify({nombre:'Synthetic v761 rack',tipo:'socio'})})).json();
      const r=await fetch('/api/productos',{method:'POST',body:JSON.stringify({nombre:'Synthetic v761',barcode:'V761-1',precio:10,costo:2,stockInicial:20,ubicacionId:ub.id})});
      if(!r.ok)throw Error(await r.text());return (await r.json()).id;});
    await page.waitForFunction(committed,null,{timeout:8000});
    const inj=await page.evaluate(inyectar);
    await page.reload({waitUntil:'domcontentloaded'});
    await page.waitForFunction(()=>window.OCAuth&&window.OCSync);
    await enterAs(page);
    const vender=()=>page.evaluate(async id=>{const r=await fetch('/api/productos/'+id+'/venta',{method:'POST',body:JSON.stringify({cantidad:1,info:{formaPago:'cash'}})});
      return {status:r.status,body:await r.text()};},pid);
    const leer=()=>page.evaluate(()=>({nombre:JSON.parse(localStorage.getItem('f123_estado_v4_'+JSON.parse(localStorage.getItem('f123_estado_v4_journal')).destino)).nombreNegocio,
      evidencia:JSON.parse(localStorage.getItem('f123_estado_v4_evidencia_ab')||'[]'),alerta:!!document.getElementById('oc-ab-conflicto')}));
    return await t({page,pid,inj,vender,leer,recargar:async()=>{await page.reload({waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.OCAuth&&window.OCSync);await enterAs(page);},ctx});
  }finally{if(browser)await browser.close();await new Promise(r=>srv.close(r));}
}

test('two valid A/B copies: highest revision wins, the other is kept as evidence, sale 200 before and after reload',()=>escenario(async({inj,vender,leer,recargar})=>{
  const v1=await vender();
  assert.equal(v1.status,200,'sale after resolvable conflict: '+v1.body);
  let s=await leer();
  assert.equal(s.nombre,'Synthetic higher copy','higher revision is now the current copy');
  assert.equal(s.alerta,false,'no conflict banner when resolved');
  assert.ok(s.evidencia.some(e=>e.raw===inj.confirmed&&e.motivo&&e.revision===inj.revConfirmed&&e.ts),'lower copy preserved with revision and time');
  await recargar();
  s=await leer();
  assert.equal(s.nombre,'Synthetic higher copy');
  assert.equal((await vender()).status,200,'sale continues after reload');
  assert.ok((await leer()).evidencia.some(e=>e.raw===inj.confirmed),'evidence survives reload');
},()=>{
  const j=JSON.parse(localStorage.getItem('f123_estado_v4_journal'));
  const b=JSON.parse(j.candidateRaw);b.nombreNegocio='Synthetic higher copy';b._rev+=50;
  localStorage.setItem('f123_estado_v4_'+j.destino,JSON.stringify(b));
  return {confirmed:j.candidateRaw,revConfirmed:j.revision};
}));

test('conflicting copy is invalid: the valid confirmed copy wins and the invalid one is kept as evidence',()=>escenario(async({inj,vender,leer})=>{
  const v=await vender();
  assert.equal(v.status,200,v.body);
  const s=await leer();
  assert.notEqual(s.nombre,'Synthetic broken copy');
  assert.ok(s.evidencia.some(e=>e.raw===inj.broken),'invalid copy preserved');
},()=>{
  const j=JSON.parse(localStorage.getItem('f123_estado_v4_journal'));
  const b=JSON.parse(j.candidateRaw);b.nombreNegocio='Synthetic broken copy';b.productos='not-a-list';b._rev+=50;
  const broken=JSON.stringify(b);localStorage.setItem('f123_estado_v4_'+j.destino,broken);
  return {broken};
}));

test('no valid copy: writes still answer 507 and nothing is overwritten',()=>escenario(async({page,inj,vender})=>{
  const v=await vender();
  assert.equal(v.status,507,v.body);
  assert.match(v.body,/Conflicting saved copies/);
  const after=await page.evaluate(()=>({j:localStorage.getItem('f123_estado_v4_journal'),a:localStorage.getItem('f123_estado_v4_A'),b:localStorage.getItem('f123_estado_v4_B')}));
  assert.deepEqual(after,inj.before);
},()=>{
  const j=JSON.parse(localStorage.getItem('f123_estado_v4_journal'));
  const c=JSON.parse(j.candidateRaw);c.productos='not-a-list';const craw=JSON.stringify(c);
  j.candidateRaw=craw;localStorage.setItem('f123_estado_v4_journal',JSON.stringify(j));localStorage.setItem('f123_estado_v4_'+j.destino,craw);
  const otra=j.destino==='A'?'B':'A';const f=JSON.parse(craw);f._rev+=50;f.nombreNegocio='Synthetic broken foreign';
  localStorage.setItem('f123_estado_v4_'+otra,JSON.stringify(f));
  return {before:{j:localStorage.getItem('f123_estado_v4_journal'),a:localStorage.getItem('f123_estado_v4_A'),b:localStorage.getItem('f123_estado_v4_B')}};
}));
