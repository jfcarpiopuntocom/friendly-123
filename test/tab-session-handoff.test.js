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
async function sessionSnapshot(page){return page.evaluate(()=>({tabSession:typeof window.OCTabSession,role:OCAuth.rolActual(),leases:Array.from({length:localStorage.length},(_,i)=>localStorage.key(i)).filter(k=>k.includes('auth_tab_lease'))}));}
for(const [name,engine] of [['Chromium',chromium],['WebKit',webkit]]){
 // ===== JFC order 2026-11-12: the tab turn (lease) is REMOVED ================
 // tab-session.js is no longer loaded (the file stays, DORMANT). Every screen
 // sells and syncs. A write is rejected ONLY when the role really changed or the
 // session was closed. Session epoch and tab ownership never block. Durable
 // conflicts between screens are decided by the IndexedDB revision check
 // (OCEstadoIDB.guardarConRevision). The data-integrity and idempotency
 // assertions of the previous contract (one sale row per opId, seed price 34,
 // stock) are kept; nothing is lowered.
 const GATE_MSGS=/Your session continues in another tab|Tu sesión continúa en otra pestaña|Your session changed while this action was waiting|cannot safely write from two tabs|cannot coordinate writes across tabs|no puede coordinar escrituras/;
 const sale=(page,id,qty=1,opId)=>page.evaluate(async({id,qty,opId})=>{const r=await fetch('/api/productos/'+id+'/venta',{method:'POST',body:JSON.stringify({cantidad:qty,opId,info:{formaPago:'cash'}})});return {status:r.status,body:await r.text()};},{id,qty,opId});
 const screenState=page=>page.evaluate(()=>({role:OCAuth.rolActual(),session:!!sessionStorage.getItem('f123_sesion'),tabSession:typeof window.OCTabSession,readonly:window.OC_TAB_READONLY,panel:!!document.getElementById('oc-tab-handoff'),doble:!!document.getElementById('oc-doble-tab'),gate:document.getElementById('oc-gate')?.dataset.tabHandoff||null,leaseWrites:(window.__leaseMutations||[]).length,text:document.body.innerText}));
 async function secondScreen(ctx,first,stage){
  const second=await ctx.newPage();await second.goto(ORIGIN+'/index.html',{waitUntil:'load'});
  await ownerLogin(second,stage,first);
  await first.waitForTimeout(600); // let storage/channel listeners of the first screen run
  return second;
 }
 function assertFree(state,who){
  assert.equal(state.role,'dueno',who+' stays signed in');assert.equal(state.session,true);
  assert.equal(state.tabSession,'undefined',who+': the tab turn is not loaded');
  assert.ok(!state.readonly,who+': no read-only tab flag');
  assert.equal(state.panel,false);assert.equal(state.doble,false,'no full-screen double-tab notice');assert.equal(state.gate,null);
  assert.equal(state.leaseWrites,0,who+' never writes a tab lease');
  assert.doesNotMatch(state.text,GATE_MSGS);
 }
 test(`P0 2026-11-12 (${name}): two screens stay signed in with no turn, no panel; sales alternate 1,2,1 and each is saved once`,async()=>{
  const web=await engine.launch({headless:true});try{
   const ctx=await context(web),{page:first,ids}=await seed(ctx);await ownerLogin(first,'first initial PIN');
   const second=await secondScreen(ctx,first,'second screen signs in');
   assertFree(await screenState(first),'first screen');assertFree(await screenState(second),'second screen');
   // Focus/pageshow on either screen changes nothing: there is no turn to take.
   for(const page of [first,second])await page.evaluate(()=>{window.dispatchEvent(new Event('focus'));window.dispatchEvent(new Event('pageshow'));});
   const a=await sale(first,ids.product,1,'p0-turnless-sale-1');assert.equal(a.status,200,a.body);
   const b=await sale(second,ids.product,1,'p0-turnless-sale-2');assert.equal(b.status,200,b.body);
   // Idempotency: the same opId sent again from the OTHER screen is the same sale, not a new one.
   const again=await sale(first,ids.product,1,'p0-turnless-sale-2');assert.equal(again.status,200,again.body);
   assert.equal(JSON.parse(again.body).duplicate,true,'replayed opId is recognised across screens');
   const c=await sale(first,ids.product,1,'p0-turnless-sale-3');assert.equal(c.status,200,c.body);
   for(const r of [a,b,again,c])assert.doesNotMatch(r.body,GATE_MSGS);
   assertFree(await screenState(first),'first screen');assertFree(await screenState(second),'second screen');
   // Durable check from a THIRD page (fresh load from IndexedDB).
   const third=await ctx.newPage();await third.goto(ORIGIN+'/index.html',{waitUntil:'load'});
   const rows=await api(third,'/api/ventas/todas');assert.equal(rows.length,4,'seed sale + three sales, each once');
   const ids3=[a,b,c].map(r=>JSON.parse(r.body).ventaId);assert.equal(new Set(ids3).size,3,'three distinct sales');
   assert.equal(JSON.parse(again.body).ventaId,ids3[1],'the replay returns the SAME sale');
   for(const id of ids3)assert.equal(rows.filter(x=>x.id===id).length,1,'sale '+id+' exactly once');
   assert.equal(rows.some(x=>x.cantidad*x.precioUnit===34),true,'seed sale untouched');
   const p=(await api(third,'/api/productos')).find(p=>p.id===ids.product);
   assert.equal(p.stockActual,0,'4 seeded - 2 - 3 sales: shelf shows 0, never negative');
  }finally{await web.close();}
 });
 test(`P0 2026-11-12 (${name}): a stale lease left by an older version and a moved session epoch do not reject a queued sale`,async()=>{
  const web=await engine.launch({headless:true});try{
   const ctx=await context(web),{page:first,ids}=await seed(ctx);await ownerLogin(first,'queued sale');
   const r=await first.evaluate(async id=>{
    const p=fetch('/api/productos/'+id+'/venta',{method:'POST',body:JSON.stringify({cantidad:1,opId:'p0-queued-1',info:{formaPago:'cash'}})});
    // What an older shell in another screen would leave behind while this write waits.
    localStorage.setItem('f123_auth_tab_lease_legacy',JSON.stringify({owner:'another-screen'}));
    localStorage.setItem('f123_auth_tab_lease_legacy_claim',JSON.stringify({owner:'another-screen',at:Date.now()}));
    window.OC_AUTH_SESSION_EPOCH=(window.OC_AUTH_SESSION_EPOCH||0)+1;
    window.dispatchEvent(new CustomEvent('oc-login',{detail:{rol:OCAuth.rolActual(),demo:false}}));
    const res=await p;return {status:res.status,body:await res.text()};},ids.product);
   assert.equal(r.status,200,'queued sale must complete: '+r.body);assert.doesNotMatch(r.body,GATE_MSGS);
   const rows=await api(first,'/api/ventas/todas');assert.equal(rows.length,2);
   assert.equal((await api(first,'/api/productos')).find(p=>p.id===ids.product).stockActual,1);
   assert.equal(await first.evaluate(()=>OCAuth.rolActual()),'dueno');
  }finally{await web.close();}
 });
 test(`P0 2026-11-12 (${name}): a REAL role change or sign-out still rejects the queued write with 403, without the forbidden message`,async()=>{
  const web=await engine.launch({headless:true});try{
   const ctx=await context(web),{page:first,ids}=await seed(ctx);await ownerLogin(first,'real changes');
   const role=await first.evaluate(async id=>{const orig=OCAuth;
    const p=fetch('/api/productos/'+id+'/venta',{method:'POST',body:JSON.stringify({cantidad:1,opId:'p0-role-change-1',info:{formaPago:'cash'}})});
    window.OCAuth=Object.assign({},orig,{rolActual:()=> 'empleado'});
    try{const r=await p;return {status:r.status,body:await r.text()};}finally{window.OCAuth=orig;}},ids.product);
   assert.equal(role.status,403);assert.doesNotMatch(role.body,GATE_MSGS);
   const out=await first.evaluate(async id=>{
    const p=fetch('/api/productos/'+id+'/venta',{method:'POST',body:JSON.stringify({cantidad:1,opId:'p0-sign-out-1',info:{formaPago:'cash'}})});
    OCAuth.salir();const r=await p;return {status:r.status,body:await r.text()};},ids.product);
   assert.equal(out.status,403);assert.doesNotMatch(out.body,GATE_MSGS);
   const third=await ctx.newPage();await third.goto(ORIGIN+'/index.html',{waitUntil:'load'});
   assert.equal((await api(third,'/api/ventas/todas')).length,1,'rejected writes left no sale behind');
   assert.equal((await api(third,'/api/productos')).find(p=>p.id===ids.product).stockActual,2);
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
  test(`Fable P1-4 storage pressure on the old lease keys (${name}, ${stage}): nobody is expelled, both screens keep writing, no lease or intent is stranded`,async()=>{
   const web=await engine.launch({headless:true});
   try{
    const ctx=await context(web),{page:first}=await seed(ctx);
    await ownerLogin(first,`quota first owner (${name}, ${stage})`);
    const second=await ctx.newPage();await second.goto(ORIGIN+'/index.html',{waitUntil:'load'});
    await second.evaluate(stage=>{
     window.__quotaLeaseThrown=0;
     const original=Storage.prototype.setItem;
     Storage.prototype.setItem=function(key,value){
      const k=String(key);
      if(k.includes('auth_tab_lease_') &&
         (stage==='intent'?k.endsWith('_claim'):!k.endsWith('_claim'))){
       window.__quotaLeaseThrown++;
       throw new DOMException('Synthetic storage pressure','QuotaExceededError');
      }
      return original.call(this,key,value);
     };
    },stage);
    await ownerLogin(second,`quota contender (${name}, ${stage})`,first);
    await second.waitForTimeout(600);
    const secondState=await sessionSnapshot(second),firstState=await sessionSnapshot(first);
    assert.equal(firstState.role,'dueno','storage pressure must not expel the previous authenticated owner');
    assert.equal(secondState.role,'dueno','the new screen signs in too');
    assert.equal(firstState.tabSession,'undefined');assert.equal(secondState.tabSession,'undefined');
    assert.equal(await second.evaluate(()=>window.__quotaLeaseThrown),0,'no lease write is even attempted, so quota cannot fence a screen');
    assert.equal(firstState.leases.length,0,'no lease and never a stranded two-minute takeover intent');
    const contender=await second.evaluate(async()=>{const r=await fetch('/api/ubicaciones',{method:'POST',body:JSON.stringify({nombre:'Quota contender allowed',tipo:'propio'})});return r.status;});
    assert.ok(contender>=200&&contender<300,`contender write is accepted; status ${contender}`);
    const accepted=await first.evaluate(async()=>{const r=await fetch('/api/ubicaciones',{method:'POST',body:JSON.stringify({nombre:'Quota legitimate owner',tipo:'propio'})});return r.status;});
    assert.ok(accepted>=200&&accepted<300,`existing owner must still be able to work; status ${accepted}`);
    // Both racks survive in durable state, each once (IndexedDB revision check arbitrates).
    const third=await ctx.newPage();await third.goto(ORIGIN+'/index.html',{waitUntil:'load'});
    const racks=(await third.evaluate(async()=>(await fetch('/api/ubicaciones')).json())).map(x=>x.nombre);
    for(const n of ['Quota contender allowed','Quota legitimate owner'])assert.equal(racks.filter(x=>x===n).length,1,n+' saved once');
   }finally{await web.close();}
  });
 }
}
