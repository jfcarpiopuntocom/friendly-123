'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const http=require('node:http'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {chromium}=require('playwright');
const A='SYNTHETIC-NATIVE-A',B='SYNTHETIC-NATIVE-B';
const docs=path.join(__dirname,'../docs');
const files=['estado-ab.js','core/payout-ledger.js','core/business-read-model.js','crypto-store.js','mock-backend.js','vendor/yjs-bundle.min.js','sync-yjs.js'];
test('native persistent profiles keep active notebook room, encrypted identity and real backend after reopen',async()=>{
  const profileA=fs.mkdtempSync(path.join(os.tmpdir(),'f123-identity-A-'));
  const profileB=fs.mkdtempSync(path.join(os.tmpdir(),'f123-identity-B-'));
  const server=http.createServer((q,r)=>{
    const f=files.find(f=>q.url==='/'+f);
    if(f){r.setHeader('Content-Type','text/javascript');r.end(fs.readFileSync(path.join(docs,f)));}
    else{r.setHeader('Content-Type','text/html');r.end('<!doctype html><title>Synthetic identity fixture</title><body></body>');}
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const origin='http://127.0.0.1:'+server.address().port;
  let joined,owner;
  async function open(profile,own,active){
    const context=await chromium.launchPersistentContext(profile,{headless:true,viewport:{width:1080,height:620},...(process.env.PLAYWRIGHT_EXECUTABLE_PATH?{executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH}:{})});
    await context.route('**/*',route=>route.request().url().startsWith(origin+'/')?route.continue():route.abort());
    const page=context.pages()[0]||await context.newPage();
    await page.goto(origin);
    await page.evaluate(({own,active})=>{
      if(!localStorage.getItem('f123_owned')){
        localStorage.setItem('f123_owned',JSON.stringify({licenseCode:own,instanceId:own==='SYNTHETIC-NATIVE-A'?'actor-a':'actor-b'}));
        localStorage.setItem('f123_tienda_activa',active);
        localStorage.setItem('f123_notebook_unificado_v2','1');
      }
      window.OCAuth={rolActual:()=> 'dueno',esDemo:()=>false};
      window.F123Relay={connect(){throw Error('Synthetic fixture forbids external relay');}};
    },{own,active});
    for(const f of files)await page.addScriptTag({url:origin+'/'+f});
    await page.waitForFunction(()=>window.OCYjs?.estado==='activo'&&OCYjs.idb?.synced,{},{timeout:10000});
    return {context,page};
  }
  async function identity(p){return p.evaluate(()=>({room:OCYjs.roomId,active:OCTienda.licenciaActual(),namespace:localStorage.getItem('f123_tienda_activa'),db:OCYjs.idb.name}));}
  async function idbBarrier(p){await p.evaluate(()=>new Promise((resolve,reject)=>{const t=OCYjs.idb.db.transaction('updates','readonly');t.objectStore('updates').count();t.oncomplete=resolve;t.onabort=()=>reject(t.error);}));}
  try{
    joined=await open(profileA,A,'::'+B);owner=await open(profileB,B,'');
    const j=await identity(joined.page),o=await identity(owner.page);
    assert.equal(j.active,B);assert.equal(j.room,o.room);assert.equal(j.db,o.db);
    const created=await joined.page.evaluate(async()=>{
      const r=await fetch('/api/productos',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({nombre:'Synthetic native product B',barcode:'NATIVE-IDENTITY-B',stockInicial:4,precio:12.5,costo:3})});
      const value=await r.json();if(!r.ok)throw Error(JSON.stringify(value));OCYjs._store.sembrar();return value;
    });
    const pid=created.id||created.producto?.id;assert.ok(pid,'real API creates an identifiable product');
    await joined.page.waitForFunction(pid=>OCYjs.getProductos()[pid]?.stockActual===4,pid);
    const packet=await joined.page.evaluate(async()=>{
      const iv=crypto.getRandomValues(new Uint8Array(12));
      const data=await crypto.subtle.encrypt({name:'AES-GCM',iv},OCYjs.clave,Y.encodeStateAsUpdate(OCYjs.doc));
      return{iv:[...iv],data:[...new Uint8Array(data)]};
    });
    await owner.page.evaluate(async packet=>{
      const bytes=await crypto.subtle.decrypt({name:'AES-GCM',iv:new Uint8Array(packet.iv)},OCYjs.clave,new Uint8Array(packet.data));
      Y.applyUpdate(OCYjs.doc,new Uint8Array(bytes),'red');OCYjs._store.aplicar();
    },packet);
    await owner.page.waitForFunction(async pid=>{const r=await fetch('/api/productos/'+pid);return r.ok&&(await r.json()).stockActual===4;},pid);
    await Promise.all([idbBarrier(joined.page),idbBarrier(owner.page)]);
    await joined.context.close();joined=null;await owner.context.close();owner=null;
    joined=await open(profileA,A,'::'+B);owner=await open(profileB,B,'');
    for(const p of [joined.page,owner.page]){
      assert.equal((await identity(p)).room,j.room);
      const got=await p.evaluate(async pid=>(await(await fetch('/api/productos/'+pid)).json()),pid);
      assert.equal(got.stockActual,4);assert.equal(got.nombre,'Synthetic native product B');
      assert.equal(await p.evaluate(pid=>OCYjs.getProductos()[pid]?.stockActual,pid),4,'native Yjs IndexedDB also survives profile close/reopen');
    }
    // A separate synthetic profile verifies the other license without deleting B data.
    await joined.context.close();joined=null;
    const profileC=fs.mkdtempSync(path.join(os.tmpdir(),'f123-identity-C-'));
    const other=await open(profileC,A,'');
    try{
      assert.notEqual((await identity(other.page)).room,j.room);
      const isolated=await other.page.evaluate(async({pid,packet})=>{
        const missing=!(await fetch('/api/productos/'+pid)).ok;
        let rejected=false;try{await crypto.subtle.decrypt({name:'AES-GCM',iv:new Uint8Array(packet.iv)},OCYjs.clave,new Uint8Array(packet.data));}catch{rejected=true;}
        return{missing,rejected};
      },{pid,packet});
      assert.deepEqual(isolated,{missing:true,rejected:true});
    }finally{await other.context.close();}
    console.log('Native identity evidence:',JSON.stringify({joinedRoomEqualsOwner:true,reopenedBackendStock:4,reopenedYjsStock:4,foreignLicenseDecryptRejected:true,profiles:[profileA,profileB,profileC]}));
  }finally{
    await joined?.context.close();await owner?.context.close();await new Promise(r=>server.close(r));
  }
});
