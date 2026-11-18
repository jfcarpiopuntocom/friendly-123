'use strict';
const {test}=require('node:test'), assert=require('node:assert/strict'), fs=require('node:fs'), path=require('node:path'), crypto=require('node:crypto');
const {chromium}=require('playwright');
const source=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8');
test('P0 native browser: E2E PIN denied then Owner token then two encrypted photo parts across public Supabase',{timeout:120000},async()=>{
 const browser=await chromium.launch({headless:true});
 const room=crypto.randomBytes(20).toString('hex');
 const url='wss://friendly123-sync-relay.jfcarpio.workers.dev/sala/'+room;
 const pin='123', licence='F123-SYNTHETIC-DASH-'+crypto.randomBytes(10).toString('hex').toUpperCase();
 const contexts=[await browser.newContext(),await browser.newContext()],pages=[];
 try{
  for(const ctx of contexts){
   const page=await ctx.newPage();pages.push(page);
   await page.goto('https://jfcarpiopuntocom.github.io/friendly-123/dashboard.html',{waitUntil:'domcontentloaded'});
   await page.addScriptTag({content:source('docs/vendor/supabase-relay.min.js')});
   await page.addScriptTag({content:source('docs/dashboard-broadcast.js')});
   await page.evaluate(async ({url,licence})=>{
    const enc=new TextEncoder(), base=await crypto.subtle.importKey('raw',enc.encode(licence),'PBKDF2',false,['deriveKey']);
    const key=await crypto.subtle.deriveKey({name:'PBKDF2',salt:enc.encode('amigable-sync-v1'),iterations:100000,hash:'SHA-256'},base,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);
    const sock=window.F123DashboardBroadcast.connect(url);
    window.__qa={sock,ready:false,messages:[],errors:[],key};
    sock.addEventListener('open',()=>window.__qa.ready=true);
    sock.addEventListener('error',()=>window.__qa.errors.push('socket'));
    sock.addEventListener('message',async ev=>{
     try{
      const b=new Uint8Array(ev.data),plain=await crypto.subtle.decrypt({name:'AES-GCM',iv:b.subarray(0,12)},key,b.subarray(12));
      window.__qa.messages.push(JSON.parse(new TextDecoder().decode(plain)));
     }catch{window.__qa.errors.push('auth-tag');}
    });
    window.__qa.send=async obj=>{
      const iv=crypto.getRandomValues(new Uint8Array(12)),cipher=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv},key,enc.encode(JSON.stringify(obj))));
      const b=new Uint8Array(12+cipher.length);b.set(iv);b.set(cipher,12);sock.send(b.buffer);
    };
   },{url,licence});
  }
  await Promise.all(pages.map(p=>p.waitForFunction(()=>window.__qa.ready===true,null,{timeout:30000})));
  // First invalid PIN: never opens a snapshot.
  await pages[1].evaluate(()=>window.__qa.send({tipo:'__pin__',deviceId:'synthetic-dashboard',opId:'bad',payload:{pedidoId:'bad',pin:'999'}}));
  await pages[0].waitForFunction(()=>window.__qa.messages.some(x=>x.opId==='bad'),null,{timeout:12000});
  await pages[0].evaluate(async()=>{
   const q=window.__qa.messages.find(x=>x.opId==='bad');
   if(q.payload.pin!=='123') await window.__qa.send({tipo:'__respuesta__',payload:{pedido:'bad',ok:false}});
  });
  await pages[1].waitForFunction(()=>window.__qa.messages.some(x=>x.tipo==='__respuesta__'&&x.payload.pedido==='bad'),null,{timeout:12000});
  assert.equal(await pages[1].evaluate(()=>window.__qa.messages.find(x=>x.payload?.pedido==='bad').payload.ok),false);
  await pages[1].evaluate(()=>window.__qa.send({tipo:'__pin__',deviceId:'synthetic-dashboard',opId:'good',payload:{pedidoId:'good',pin:'123'}}));
  await pages[0].waitForFunction(()=>window.__qa.messages.some(x=>x.opId==='good'),null,{timeout:12000});
  await pages[0].evaluate(()=>window.__qa.send({tipo:'__respuesta__',payload:{pedido:'good',ok:true,datos:{rol:'dueno',fotoToken:'synthetic-ephemeral-token'}}}));
  await pages[1].waitForFunction(()=>window.__qa.messages.some(x=>x.tipo==='__respuesta__'&&x.payload.pedido==='good'),null,{timeout:12000});
  const allowed=await pages[1].evaluate(()=>window.__qa.messages.find(x=>x.payload?.pedido==='good').payload);
  assert.equal(allowed.ok,true);assert.equal(allowed.datos.fotoToken,'synthetic-ephemeral-token');
  await pages[1].evaluate(()=>window.__qa.send({tipo:'__foto_pedida__',deviceId:'synthetic-dashboard',payload:{fotoToken:'synthetic-ephemeral-token'}}));
  await pages[0].waitForFunction(()=>window.__qa.messages.some(x=>x.tipo==='__foto_pedida__'),null,{timeout:12000});
  await pages[0].evaluate(async()=>{
   const req=window.__qa.messages.find(x=>x.tipo==='__foto_pedida__');
   if(req.payload.fotoToken!=='synthetic-ephemeral-token')return;
   await window.__qa.send({tipo:'__foto_trozo__',payload:{fotoId:'qa-1',generadaEn:'2026-11-18T00:00:00Z',negocio:'QA Only',tabla:'productos',i:0,total:1,k:0,deTotal:2,filas:[{nombre:'Taza QA',stockActual:9}]}});
   await window.__qa.send({tipo:'__foto_trozo__',payload:{fotoId:'qa-1',generadaEn:'2026-11-18T00:00:00Z',negocio:'QA Only',tabla:'resumen',i:0,total:1,k:1,deTotal:2,filas:[{resumenDia:{entra:27}}]}});
  });
  await pages[1].waitForFunction(()=>window.__qa.messages.filter(x=>x.tipo==='__foto_trozo__').length===2,null,{timeout:20000});
  const result=await pages[1].evaluate(()=>{
    const parts=window.__qa.messages.filter(x=>x.tipo==='__foto_trozo__');
    return {stock:parts.find(x=>x.payload.tabla==='productos')?.payload.filas[0]?.stockActual,entras:parts.find(x=>x.payload.tabla==='resumen')?.payload.filas[0]?.resumenDia?.entra,errors:window.__qa.errors};
  });
  assert.equal(result.stock,9);assert.equal(result.entras,27);assert.deepEqual(result.errors,[]);
  console.log('P0 DASHBOARD ENCRYPTED BROWSER GREEN:',JSON.stringify({browsers:2,wrongPinDenied:true,ownerApproved:true,photoParts:2,stock:9,entras:27,errors:0}));
 }catch(e){
   const states=await Promise.all(pages.map(p=>p.evaluate(()=>({ready:window.__qa?.ready,errors:window.__qa?.errors,types:window.__qa?.messages?.map(x=>x.tipo)})).catch(()=>null)));
   console.error('P0 DASHBOARD BROWSER DIAG:',JSON.stringify(states));throw e;
 }finally{await Promise.all(contexts.map(c=>c.close()));await browser.close();}
});
