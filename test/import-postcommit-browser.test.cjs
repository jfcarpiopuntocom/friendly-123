'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {startServer,chromium}=require('./helpers/e2e-app.cjs');

test('native persistent browser keeps an imported notebook after a postcommit notification throws and after reopening',{timeout:25000},async()=>{
  const {srv,base}=await startServer();
  const profile=fs.mkdtempSync(path.join(os.tmpdir(),'f123-postcommit-import-'));
  const source=fs.readFileSync(path.join(__dirname,'../docs/mock-backend.js'),'utf8')
    .replace('  function avisarCatalogoCambiado() {','  function avisarCatalogoCambiado() { if(window.__noticeThrows) throw Error("synthetic postcommit notification");');
  let context;
  async function open(){
    context=await chromium.launchPersistentContext(profile,{headless:true,serviceWorkers:'block',...(process.env.PLAYWRIGHT_EXECUTABLE_PATH?{executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH}:{})});
    await context.addInitScript(()=>{
      if(!localStorage.getItem('f123_owned'))localStorage.setItem('f123_owned',JSON.stringify({licenseCode:'F123-SYNTHETIC-POSTCOMMIT-ONLY'}));
      window.WebSocket=class{constructor(){throw Error('No production network in import fixture');}};
    });
    await context.route(u=>!u.href.startsWith(base)&&!u.href.startsWith('data:')&&!u.href.startsWith('blob:'),r=>r.abort());
    await context.route('**/mock-backend.js',route=>route.fulfill({contentType:'application/javascript',body:source}));
    const page=context.pages()[0]||await context.newPage();
    await page.goto(base+'/index.html',{waitUntil:'domcontentloaded'});
    await page.waitForFunction(()=>window.OCSync&&window.OCAuth);
    await page.evaluate(()=>{OCAuth.rolActual=()=> 'dueno';});
    return page;
  }
  try{
    let page=await open();
    const response=await page.evaluate(async()=>{
      const backup=await(await fetch('/api/respaldo/exportar')).json();
      backup.nombreNegocio='Committed synthetic notebook';backup.ventas=[];backup.movimientos=[];
      backup.productos=[{id:'native-import-committed',nombre:'Synthetic imported product',barcode:'NATIVE-POSTCOMMIT',precio:10,costo:4,stockActual:10}];
      window.__noticeThrows=true;
      const r=await fetch('/api/respaldo/importar',{method:'POST',body:JSON.stringify(backup)});
      return {status:r.status,body:await r.json(),live:await(await fetch('/api/respaldo/exportar')).json()};
    });
    assert.equal(response.status,200,'durable import cannot be reported as a failed notification');
    assert.equal(response.body.ok,true);assert.equal(response.live.nombreNegocio,'Committed synthetic notebook');
    await context.close();context=null;
    page=await open();
    const reopened=await page.evaluate(async()=>await(await fetch('/api/respaldo/exportar')).json());
    assert.equal(reopened.nombreNegocio,response.live.nombreNegocio);
    const product=reopened.productos.find(p=>p.id==='native-import-committed');
    assert.ok(product);assert.equal(product.stockActual,10);assert.equal(product.precio,10);assert.equal(product.costo,4);
    assert.equal(reopened.ventas.length,0,'restoration does not invent sales or money');
  }finally{
    await context?.close();await new Promise(resolve=>srv.close(resolve));
    if(path.dirname(path.resolve(profile))===path.resolve(os.tmpdir())&&path.basename(profile).startsWith('f123-postcommit-import-'))fs.rmSync(profile,{recursive:true,force:true});
  }
});
