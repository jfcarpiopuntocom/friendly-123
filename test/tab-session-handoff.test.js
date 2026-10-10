const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium,webkit}=require('playwright');
const DOCS=process.env.TAB_TEST_DOCS || path.resolve(__dirname,'../docs'),ORIGIN='http://localhost:18479';
const api=(page,url,method='GET',body)=>page.evaluate(async({url,method,body})=>{const r=await fetch(url,{method,body:body?JSON.stringify(body):undefined});if(!r.ok)throw Error(await r.text());return r.json();},{url,method,body});
async function context(browser){
 const ctx=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'});
 await ctx.route('**/*',async route=>{const url=new URL(route.request().url());if(url.origin!==ORIGIN)return route.abort();const file=path.resolve(DOCS,decodeURIComponent(url.pathname).slice(1));if(!file.startsWith(DOCS+path.sep))return route.abort();try{await route.fulfill({status:200,contentType:{'.html':'text/html','.js':'application/javascript','.json':'application/json','.css':'text/css'}[path.extname(file)]||'application/octet-stream',body:fs.readFileSync(file)});}catch(_){await route.fulfill({status:404,body:'Not found'});}});
 await ctx.addInitScript(()=>{window.WebSocket=class{constructor(){this.readyState=3}send(){}close(){}addEventListener(){}removeEventListener(){}};localStorage.setItem('f123::f123_owned',JSON.stringify({licenseCode:'SYNTHETIC-TAB-ONLY',instanceId:'synthetic-tab-device'}));});
 await ctx.addInitScript(()=>{const Original=BroadcastChannel;window.BroadcastChannel=class extends Original{set onmessage(handler){super.onmessage=this.name==='friendly-123-auth-session'&&typeof handler==='function'?event=>{if(!window.__suppressLeaseEvents)handler(event);}:handler;}};window.addEventListener('storage',event=>{if(window.__suppressLeaseEvents&&event.key?.includes('auth_tab_lease'))event.stopImmediatePropagation();},true);});
 return ctx;
}
async function seed(ctx){
 const page=await ctx.newPage();await page.goto(ORIGIN+'/index.html',{waitUntil:'load'});
 const ids=await page.evaluate(async()=>{const original=OCAuth;window.OCAuth=Object.assign({},original,{rolActual:()=> 'dueno'});try{await OCSecure.guardarSecreto('789',['260'],'357','');const req=async(u,b)=>{const r=await fetch(u,{method:'POST',body:JSON.stringify(b)});if(!r.ok)throw Error(await r.text());return r.json();};const rack=await req('/api/ubicaciones',{nombre:'Synthetic immediate rack',tipo:'propio'});const p=await req('/api/productos',{nombre:'Synthetic immediate product',barcode:'TAB-TIMING',precio:17,stockInicial:4,ubicacionId:rack.id});await req('/api/productos/'+p.id+'/venta',{cantidad:2,info:{formaPago:'cash'}});return {product:p.id,rack:rack.id};}finally{window.OCAuth=original;}});
 return {page,ids};
}
async function ownerLogin(page){await page.waitForFunction(()=>!!window.OCAuth);for(const digit of ['7','8','9'])await page.locator('#oc-pad').getByRole('button',{name:digit,exact:true}).click();await page.waitForFunction(()=>window.OCAuth?.rolActual()==='dueno',{},{timeout:5000});}
async function sessionSnapshot(page){return page.evaluate(()=>({pending:OCTabSession.pending,current:OCTabSession.isCurrent(),epoch:window.OC_AUTH_SESSION_EPOCH,role:OCAuth.rolActual(),notebook:localStorage.getItem('f123_tienda_activa'),owned:localStorage.getItem('f123_owned'),leases:Array.from({length:localStorage.length},(_,i)=>localStorage.key(i)).filter(k=>k.includes('auth_tab_lease')).map(key=>({key,value:localStorage.getItem(key)})),requests:window.__lockCalls,fences:window.__fenceReads}));}
for(const [name,engine] of [['Chromium',chromium],['WebKit',webkit]]){
 test(`native tab session handoff (${name}): old session closes, queued writes fail, sharing is public and honest`,async()=>{
  const web=await engine.launch({headless:true});try{
   const ctx=await context(web),{page:first,ids}=await seed(ctx);await ownerLogin(first);
   await first.waitForFunction(()=>!window.OCTabSession?.pending);
   const initialSession=await sessionSnapshot(first);
   assert.equal(initialSession.leases.length,1,'the original session must own its lease before testing handoff');
   await first.evaluate(()=>{const original=OCTabSession.isCurrent;window.__fenceReads=[];OCTabSession.isCurrent=function(){const result=original();__fenceReads.push({result,time:performance.timeOrigin+performance.now(),leases:Array.from({length:localStorage.length},(_,i)=>localStorage.key(i)).filter(k=>k.includes('auth_tab_lease')).map(key=>({key,value:localStorage.getItem(key)}))});return result;};});
   await first.evaluate(()=>{navigator.locks.request('f123-escrituras',()=>new Promise(resolve=>{window.__releaseWriteLock=resolve;}));});
   await first.waitForFunction(()=>typeof __releaseWriteLock==='function');
   // The write fence must work even before notification delivery closes the UI.
   await first.evaluate(()=>{window.__suppressLeaseEvents=true;});
   const second=await ctx.newPage();await second.goto(ORIGIN+'/index.html',{waitUntil:'load'});
   // A startup API write can also be pending on this lock. Observe the actual
   // session claim instead of mistaking any pending write for that claim.
   await second.evaluate(()=>{const request=navigator.locks.request.bind(navigator.locks);window.__lockCalls=[];window.__observedLockRequest=function(name,...args){const result=request(name,...args);window.__lockCalls.push({lock:name,callback:args.at(-1).name});if(name==='f123-escrituras'&&args.at(-1).name==='take')window.__handoffClaimQueued=true;return result;};navigator.locks.request=window.__observedLockRequest;});
   assert.equal(await second.evaluate(()=>navigator.locks.request===window.__observedLockRequest),true,'the test must actually observe the browser lock requests');
   await ownerLogin(second);
   if(await second.evaluate(()=>!!window.OCTabSession))await second.waitForFunction(()=>window.__handoffClaimQueued===true).catch(async error=>{error.message+=' Claim diagnostics: '+JSON.stringify(await second.evaluate(()=>({requests:window.__lockCalls,pending:OCTabSession.pending,epoch:window.OC_AUTH_SESSION_EPOCH,role:OCAuth.rolActual(),leases:Object.keys(localStorage).filter(k=>k.includes('auth_tab_lease')).length})));throw error;});
   // The old session must be fenced as soon as takeover is queued. This
   // assertion accepts either an early intent marker or a completed takeover.
   const preHandoff=await first.evaluate(()=>({current:OCTabSession.isCurrent(),leases:Array.from({length:localStorage.length},(_,i)=>localStorage.key(i)).filter(k=>k.includes('auth_tab_lease')).map(k=>({key:k,value:localStorage.getItem(k)}))}));
   assert.equal(preHandoff.current,false,'old-tab mutation authorization must be revoked before its queued write: '+JSON.stringify(preHandoff));
   // This request waits behind the new session claim. A write already running
   // before that claim is allowed to finish; it must not be cancelled or lost.
   await first.evaluate(()=>{fetch('/api/ubicaciones',{method:'POST',body:JSON.stringify({nombre:'Queued forbidden rack',tipo:'propio'})}).then(r=>window.__queuedWriteStatus=r.status);});
   await first.evaluate(()=>__releaseWriteLock());
   await first.waitForFunction(()=>typeof __queuedWriteStatus==='number');
   console.log(name+' session fence '+JSON.stringify({initial:initialSession,first:await sessionSnapshot(first),second:await sessionSnapshot(second)}));
   assert.equal(await first.evaluate(()=>__queuedWriteStatus),403,'permissions are checked again after waiting for the write lock: '+JSON.stringify({initial:initialSession,first:await sessionSnapshot(first),second:await sessionSnapshot(second)}));
   await first.evaluate(()=>{window.__suppressLeaseEvents=false;window.dispatchEvent(new Event('focus'));});
   await first.waitForFunction(()=>OCAuth.rolActual()===null,{},{timeout:2000});
   assert.equal(await first.evaluate(()=>sessionStorage.getItem('f123_sesion')),null);
   await first.locator('#oc-tab-handoff').waitFor({state:'visible'});
   assert.equal((await api(second,'/api/ubicaciones')).some(x=>x.nombre==='Queued forbidden rack'),false);
   const rows=await api(second,'/api/ventas/todas');assert.equal(rows.length,1);assert.equal(rows[0].cantidad*rows[0].precioUnit,34);
   assert.equal((await api(second,'/api/productos')).find(p=>p.id===ids.product).stockActual,2);
   await first.evaluate(()=>{Object.defineProperty(navigator,'share',{configurable:true,value:async data=>{window.__shared=data;throw new DOMException('Cancelled','AbortError');}});});
   await first.locator('#oc-tab-share').click();
   const sharing=await first.evaluate(()=>({data:__shared,status:document.getElementById('oc-tab-share-status').textContent,overflow:document.documentElement.scrollWidth>innerWidth+1}));
   assert.equal(sharing.data.url,'https://jfcarpiopuntocom.github.io/friendly-123/');assert.doesNotMatch(JSON.stringify(sharing.data),/SYNTHETIC-TAB|789|instanceId|licenseCode/);
   assert.doesNotMatch(sharing.status,/sent|shared|enviado|compartido/i);assert.equal(sharing.overflow,false);
   await first.evaluate(()=>{Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async()=>{throw Error('Denied');}}});});
   await first.locator('#oc-tab-copy').click();assert.equal(await first.locator('#oc-tab-share-url').isVisible(),true);
   assert.doesNotMatch(await first.locator('#oc-tab-share-status').innerText(),/copied|copiado/i);
   await first.evaluate(()=>{Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>{window.__copied=text;}}});});
   await first.locator('#oc-tab-copy').click();assert.match(await first.locator('#oc-tab-share-status').innerText(),/copied|copiado/i);
   assert.equal(await first.evaluate(()=>__copied),'https://jfcarpiopuntocom.github.io/friendly-123/');
   await first.locator('#oc-tab-resume').click();await ownerLogin(first);await second.waitForFunction(()=>OCAuth.rolActual()===null,{},{timeout:2000});
  }finally{await web.close();}
 });
 test(`same-browser durable edit reaches inventory DOM directly (${name})`,async()=>{
  const web=await engine.launch({headless:true});try{
   const ctx=await context(web),{page:first,ids}=await seed(ctx),second=await ctx.newPage();await second.goto(ORIGIN+'/index.html',{waitUntil:'load'});
   for(const page of [first,second])await page.evaluate(()=>{window.OCAuth=Object.assign({},OCAuth,{rolActual:()=> 'dueno'});document.getElementById('oc-gate').style.display='none';});
   await second.locator('button[data-vista="inventario"]').click();await second.waitForFunction(()=>document.getElementById('gridInventario').textContent.includes('Synthetic immediate product'));
   await second.evaluate(()=>{window.__localDomMs=null;window.__tabEvents=[];window.addEventListener('storage',e=>__tabEvents.push({key:e.key}));window.addEventListener('oc-sync-merge',e=>__tabEvents.push({merge:e.detail}));new MutationObserver(()=>{if(document.getElementById('gridInventario').textContent.includes('Synthetic changed directly'))window.__localDomMs=performance.timeOrigin+performance.now();}).observe(document.getElementById('gridInventario'),{subtree:true,childList:true,characterData:true});});
   const origin=await first.evaluate(()=>performance.timeOrigin+performance.now());
   await api(first,'/api/productos/'+ids.product,'PATCH',{nombre:'Synthetic changed directly',precio:19});
   try { await second.waitForFunction(()=>__localDomMs!==null,{},{timeout:2000}); }
   catch(error){ console.log(await second.evaluate(async()=>({events:__tabEvents,dom:document.getElementById('gridInventario').textContent,data:await (await fetch('/api/productos')).json(),active:document.getElementById('vista-inventario').className})));throw error; }
   const ms=await second.evaluate(start=>__localDomMs-start,origin);assert.ok(ms>=0&&ms<500,`direct local edit took ${ms.toFixed(1)}ms; no relay or 400ms debounce`);
   console.log(`${name} durable action-to-DOM: ${ms.toFixed(1)}ms`);
   assert.equal((await api(second,'/api/ventas/todas'))[0].precioUnit,17,'editing today price does not rewrite the sale');
   assert.equal((await api(second,'/api/productos')).find(p=>p.id===ids.product).stockActual,2);
  }finally{await web.close();}
 });
}
