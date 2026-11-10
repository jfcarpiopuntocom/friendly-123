const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium,webkit}=require('playwright');
const DOCS=process.env.TAB_TEST_DOCS || path.resolve(__dirname,'../docs'),ORIGIN='http://localhost:18479';
const api=(page,url,method='GET',body)=>page.evaluate(async({url,method,body})=>{const r=await fetch(url,{method,body:body?JSON.stringify(body):undefined});if(!r.ok)throw Error(await r.text());return r.json();},{url,method,body});
async function context(browser){
 const ctx=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'});
 await ctx.route('**/*',async route=>{const url=new URL(route.request().url());if(url.origin!==ORIGIN)return route.abort();const file=path.resolve(DOCS,decodeURIComponent(url.pathname).slice(1));if(!file.startsWith(DOCS+path.sep))return route.abort();try{await route.fulfill({status:200,contentType:{'.html':'text/html','.js':'application/javascript','.json':'application/json','.css':'text/css','.woff2':'font/woff2'}[path.extname(file)]||'application/octet-stream',body:fs.readFileSync(file)});}catch(_){await route.fulfill({status:404,body:'Not found'});}});
 await ctx.addInitScript(()=>{window.WebSocket=class{constructor(){this.readyState=3}send(){}close(){}addEventListener(){}removeEventListener(){}};localStorage.setItem('f123::f123_owned',JSON.stringify({licenseCode:'SYNTHETIC-TAB-ONLY',instanceId:'synthetic-tab-device'}));});
 await ctx.addInitScript(()=>{const Original=BroadcastChannel;window.BroadcastChannel=class extends Original{set onmessage(handler){super.onmessage=this.name==='friendly-123-auth-session'&&typeof handler==='function'?event=>{if(!window.__suppressLeaseEvents)handler(event);}:handler;}};window.addEventListener('storage',event=>{if(window.__suppressLeaseEvents&&event.key?.includes('auth_tab_lease'))event.stopImmediatePropagation();},true);});
 await ctx.addInitScript(()=>{
  window.__tabTrace=[];
  window.__leaseMutations=[];
  for(const verb of ['setItem','removeItem']){
    const orig=Storage.prototype[verb];
    Storage.prototype[verb]=function(key,...args){
      if(String(key).includes('auth_tab_lease')){
        const stack=String(new Error().stack||'').split('\n').slice(1,5).join(' | ');
        window.__leaseMutations.push({t:Math.round(performance.now()*10)/10,
          action:verb,key:String(key),stack});
        if(window.__leaseMutations.length>30)window.__leaseMutations.shift();
      }
      return orig.call(this,key,...args);
    };
  }
  function trace(event){
    try {
      const keys=Array.from({length:localStorage.length},(_,i)=>localStorage.key(i))
        .filter(k=>k.includes('auth_tab_lease'));
      window.__tabTrace.push({t:Math.round(performance.now()*10)/10,event,
        role:window.OCAuth?.rolActual?.()??null,
        pending:window.OCTabSession?.pending??null,
        current:window.OCTabSession?.isCurrent?.()??null,
        session:!!sessionStorage.getItem('f123_sesion'),
        leases:keys.map(key=>({key,value:localStorage.getItem(key)}))});
      if(window.__tabTrace.length>90)window.__tabTrace.shift();
    }catch(_){}
  }
  for(const name of ['oc-login','oc-logout','oc-tab-session-changed','focus','pageshow','storage'])
    window.addEventListener(name,()=>trace(name),true);
  document.addEventListener('visibilitychange',()=>trace('visibilitychange'),true);
  window.__traceTab=trace;
 });
 return ctx;
}
async function seed(ctx){
 const page=await ctx.newPage();await page.goto(ORIGIN+'/index.html',{waitUntil:'load'});
 const ids=await page.evaluate(async()=>{const original=OCAuth;window.OCAuth=Object.assign({},original,{rolActual:()=> 'dueno'});try{await OCSecure.guardarSecreto('789',['260'],'357','');const req=async(u,b)=>{const r=await fetch(u,{method:'POST',body:JSON.stringify(b)});if(!r.ok)throw Error(await r.text());return r.json();};const rack=await req('/api/ubicaciones',{nombre:'Synthetic immediate rack',tipo:'propio'});const p=await req('/api/productos',{nombre:'Synthetic immediate product',barcode:'TAB-TIMING',precio:17,stockInicial:4,ubicacionId:rack.id});await req('/api/productos/'+p.id+'/venta',{cantidad:2,info:{formaPago:'cash'}});return {product:p.id,rack:rack.id};}finally{window.OCAuth=original;}});
 return {page,ids};
}
async function ownerLogin(page,stage,otherPage=null){
 await page.evaluate(()=>{
   if(!window.__pinTraceWrapped && window.OCSecure?.identificarPin){
     const original=window.OCSecure.identificarPin;
     window.OCSecure.identificarPin=async function(...args){
       window.__traceTab?.('identifyPin-start');
       try {const value=await original.apply(this,args);
         window.__traceTab?.('identifyPin-result-'+String(value));return value;}
       catch(e){window.__traceTab?.('identifyPin-error-'+(e?.name||'unknown'));throw e;}
     };
     window.__pinTraceWrapped=true;
   }
 });
 console.log('TAB_PIN_STAGE',stage);
 await page.waitForFunction(()=>!!window.OCAuth);
 for(const digit of ['7','8','9'])await page.locator('#oc-pad').getByRole('button',{name:digit,exact:true}).click();
 try { await page.waitForFunction(()=>window.OCAuth?.rolActual()==='dueno',{},{timeout:5000}); }
 catch(error){
   // Diagnostics only: retain exactly the original timeout and assertions.
   const facts=await page.evaluate(stage=>({
     role:OCAuth?.rolActual(),gate:document.getElementById('oc-gate')?.style.display,
     handoff:!!document.getElementById('oc-tab-handoff'),
     authMessage:document.getElementById('oc-msg')?.textContent?.slice(0,160),
     pending:OCTabSession?.pending,current:OCTabSession?.isCurrent(),
     slots:[...document.querySelectorAll('#oc-slots .slot')].map(s=>!!s.textContent),
     sessionExists:!!sessionStorage.getItem('f123_sesion'),
     stage,
     trace:window.__tabTrace?.slice(-60),
     leaseMutations:window.__leaseMutations?.slice(-30)
   }),stage).catch(e=>({probeError:String(e)}));
   console.error('TAB_HANDOFF_AUTH_FORENSIC',JSON.stringify(facts));
   if(otherPage){
     const peer=await otherPage.evaluate(()=>({
       trace:window.__tabTrace?.slice(-30),
       leaseMutations:window.__leaseMutations?.slice(-30)
     })).catch(e=>({error:String(e)}));
     console.error('OTHER_TAB_LEASE_FORENSIC',JSON.stringify(peer));
   }
   throw error;
 }
}
async function sessionSnapshot(page){return page.evaluate(()=>({pending:OCTabSession.pending,current:OCTabSession.isCurrent(),epoch:window.OC_AUTH_SESSION_EPOCH,role:OCAuth.rolActual(),notebook:localStorage.getItem('f123_tienda_activa'),owned:localStorage.getItem('f123_owned'),leases:Array.from({length:localStorage.length},(_,i)=>localStorage.key(i)).filter(k=>k.includes('auth_tab_lease')).map(key=>({key,value:localStorage.getItem(key)})),requests:window.__lockCalls,fences:window.__fenceReads}));}
for(const [name,engine] of [['Chromium',chromium],['WebKit',webkit]]){
 test(`native tab session handoff (${name}): old session closes, queued writes fail, sharing is public and honest`,async()=>{
  const web=await engine.launch({headless:true});try{
   const ctx=await context(web),{page:first,ids}=await seed(ctx);await ownerLogin(first,'first initial PIN');
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
   await ownerLogin(second,'second tab takes over',first);
   // S1: a new PIN session MUST take the lease without queuing behind a
   // possibly zombie Web Lock. The old in-flight write still owns the lock.
   await second.waitForFunction(()=>!!window.OCTabSession&&!OCTabSession.pending&&OCTabSession.isCurrent(),null,{timeout:15000}); // handoff under a loaded CI box; behavior asserts below keep their 2 s limits
   assert.equal(await second.evaluate(()=>window.__lockCalls.some(x=>x.callback==='take')),false,
     'PIN handoff must not wait for the former tab to release a Web Lock');
   assert.equal((await sessionSnapshot(second)).leases.length,1,'new tab holds exactly one session lease');
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
   await first.locator('#oc-tab-resume').click();await ownerLogin(first,'first re-entry after handoff',second);await second.waitForFunction(()=>OCAuth.rolActual()===null,{},{timeout:2000});
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


for(const [name,engine] of [['Chromium',chromium],['WebKit',webkit]]){
 for(const stage of ['intent','lease']){
  test(`Fable P1-4 native quota-failed second claim (${name}, ${stage}): original owner persists, contender cannot write`,async()=>{
   const web=await engine.launch({headless:true});
   try{
    const ctx=await context(web),{page:first}=await seed(ctx);
    await ownerLogin(first,`quota first owner (${name}, ${stage})`);
    await first.waitForFunction(()=>!!window.OCTabSession&&!OCTabSession.pending&&OCTabSession.isCurrent());
    const second=await ctx.newPage();await second.goto(ORIGIN+'/index.html',{waitUntil:'load'});
    await second.evaluate(stage=>{
     window.__quotaLeaseThrown=0;
     const original=Storage.prototype.setItem;
     Storage.prototype.setItem=function(key,value){
      const k=String(key);
      if(k.startsWith('f123_auth_tab_lease_') &&
         (stage==='intent'?k.endsWith('_claim'):!k.endsWith('_claim'))){
       window.__quotaLeaseThrown++;
       throw new DOMException('Synthetic storage pressure','QuotaExceededError');
      }
      return original.call(this,key,value);
     };
    },stage);
    for(const digit of ['7','8','9'])
     await second.locator('#oc-pad').getByRole('button',{name:digit,exact:true}).click();
    await second.waitForFunction(()=>window.__quotaLeaseThrown>0&&!window.OCTabSession.pending,null,{timeout:10000});
    const secondState=await sessionSnapshot(second),firstState=await sessionSnapshot(first);
    assert.equal(firstState.current,true,'legitimate previous owner must remain active');
    assert.equal(firstState.role,'dueno','storage pressure must not expel the previous authenticated owner');
    assert.equal(secondState.current,false,'failed new session cannot mutate without a committed lease');
    assert.equal(await second.evaluate(()=>OCTabSession.canSync()),false,'failed contender must not sync');
    const leases=firstState.leases.filter(x=>x.key.includes('auth_tab_lease'));
    assert.equal(leases.length,1,'only original durable lease remains, never an intent');
    assert.ok(!leases[0].key.endsWith('_claim'),'never strand the two-minute takeover intent');
    const denied=await second.evaluate(async()=>{const r=await fetch('/api/ubicaciones',{method:'POST',body:JSON.stringify({nombre:'Quota contender forbidden',tipo:'propio'})});return r.status;});
    assert.ok(denied>=400,`contender write must fail, not status ${denied}`);
    const accepted=await first.evaluate(async()=>{const r=await fetch('/api/ubicaciones',{method:'POST',body:JSON.stringify({nombre:'Quota legitimate owner',tipo:'propio'})});return r.status;});
    assert.ok(accepted>=200&&accepted<300,`existing owner must still be able to work; status ${accepted}`);
   }finally{await web.close();}
  });
 }
}
