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
 // ===== JFC order 2026-11-11 (P0, real shop could not sell) ==================
 // New contract: the shared tab lease NEVER closes a session and NEVER rejects a
 // business write. Only a real sign-out or a real role change rejects a queued
 // write. Durable conflicts between screens are decided by the IndexedDB
 // revision check (OCEstadoIDB.guardarConRevision), not by the lease.
 // The previous test here (closed session, 403 for a queued sale, #oc-tab-handoff
 // panel, share/copy buttons) asserted the OLD behaviour that JFC ordered removed.
 // It is replaced, not lowered: the data-integrity assertions (one sale row,
 // price 34, stock) are kept below. The panel code stays in tab-session.js, DORMANT.
 const GATE_MSGS=/Your session continues in another tab|Tu sesión continúa en otra pestaña|Your session changed while this action was waiting/;
 const sale=(page,id,qty=1,opId)=>page.evaluate(async({id,qty,opId})=>{const r=await fetch('/api/productos/'+id+'/venta',{method:'POST',body:JSON.stringify({cantidad:qty,opId,info:{formaPago:'cash'}})});return {status:r.status,body:await r.text()};},{id,qty,opId});
 const visible=page=>page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,get:()=>false});});
 const leaseRaw=page=>page.evaluate(()=>{const k=Array.from({length:localStorage.length},(_,i)=>localStorage.key(i)).find(k=>k.includes('auth_tab_lease_')&&!k.endsWith('_claim'));return k?localStorage.getItem(k):null;});
 const leaseWrites=page=>page.evaluate(()=>window.__leaseWrites||0);
 const countLeaseWrites=page=>page.evaluate(()=>{window.__leaseWrites=0;const o=Storage.prototype.setItem;Storage.prototype.setItem=function(k,...a){if(String(k).includes('auth_tab_lease_')&&!String(k).endsWith('_claim'))window.__leaseWrites++;return o.call(this,k,...a);};});
 async function secondScreen(ctx,first,stage){
  const second=await ctx.newPage();await second.goto(ORIGIN+'/index.html',{waitUntil:'load'});
  const before=await leaseRaw(first);
  await ownerLogin(second,stage,first);
  await second.waitForFunction(()=>!!window.OCTabSession&&!OCTabSession.pending&&OCTabSession.isCurrent(),null,{timeout:15000});
  // Wait until the FIRST screen has really seen the lease move, then give its
  // storage/channel listeners time to run: the old code closed the session here.
  await first.waitForFunction(b=>{const k=Array.from({length:localStorage.length},(_,i)=>localStorage.key(i)).find(k=>k.includes('auth_tab_lease_')&&!k.endsWith('_claim'));return !!k&&localStorage.getItem(k)!==b;},before,{timeout:5000});
  await first.waitForTimeout(600);
  return second;
 }
 test(`P0 2026-11-11 (${name}): old screen stays signed in, shows no panel and its sale is saved once`,async()=>{
  const web=await engine.launch({headless:true});try{
   const ctx=await context(web),{page:first,ids}=await seed(ctx);await ownerLogin(first,'first initial PIN');
   await first.waitForFunction(()=>!window.OCTabSession?.pending);await visible(first);
   await secondScreen(ctx,first,'second screen takes over');
   const state=await first.evaluate(()=>({role:OCAuth.rolActual(),session:!!sessionStorage.getItem('f123_sesion'),panel:!!document.getElementById('oc-tab-handoff'),gate:document.getElementById('oc-gate')?.dataset.tabHandoff||null,current:OCTabSession.isCurrent(),canSync:OCTabSession.canSync(),text:document.body.innerText}));
   assert.equal(state.role,'dueno','the previous screen must stay signed in');
   assert.equal(state.session,true);assert.equal(state.panel,false,'no "continues in another tab" panel');assert.equal(state.gate,null);
   assert.doesNotMatch(state.text,GATE_MSGS);
   assert.equal(state.current,false,'lease really moved to the new screen');assert.equal(state.canSync,false,'sync pauses on the screen that lost the lease');
   const r=await sale(first,ids.product,1,'p0-old-screen-sale-1');
   assert.equal(r.status,200,'a sale from the screen that lost the lease must be accepted: '+r.body);
   assert.doesNotMatch(r.body,GATE_MSGS);
   // Durable check from a THIRD page (fresh load from IndexedDB): exactly one new sale.
   const third=await ctx.newPage();await third.goto(ORIGIN+'/index.html',{waitUntil:'load'});
   const rows=await api(third,'/api/ventas/todas');assert.equal(rows.length,2,'seed sale + the old-screen sale, once');
   assert.equal(rows.some(x=>x.cantidad*x.precioUnit===34),true,'seed sale untouched');
   assert.equal((await api(third,'/api/productos')).find(p=>p.id===ids.product).stockActual,1);
  }finally{await web.close();}
 });
 test(`P0 2026-11-11 (${name}): a sale queued while the lease moves completes once (no 403)`,async()=>{
  const web=await engine.launch({headless:true});try{
   const ctx=await context(web),{page:first,ids}=await seed(ctx);await ownerLogin(first,'queued sale');
   await first.waitForFunction(()=>!window.OCTabSession?.pending&&OCTabSession.isCurrent());
   // The request is queued (role/epoch captured), then the lease moves to another
   // screen BEFORE the queued write runs. This is the instant the real bug hit.
   const r=await first.evaluate(async id=>{const k=Array.from({length:localStorage.length},(_,i)=>localStorage.key(i)).find(k=>k.includes('auth_tab_lease_')&&!k.endsWith('_claim'));
    const p=fetch('/api/productos/'+id+'/venta',{method:'POST',body:JSON.stringify({cantidad:1,opId:'p0-queued-1',info:{formaPago:'cash'}})});
    localStorage.setItem(k,JSON.stringify({owner:'another-screen'}));const res=await p;return {status:res.status,body:await res.text(),current:OCTabSession.isCurrent()};},ids.product);
   assert.equal(r.current,false,'precondition: this screen no longer owns the lease');
   assert.equal(r.status,200,'queued sale must complete: '+r.body);
   const rows=await api(first,'/api/ventas/todas');assert.equal(rows.length,2);
   assert.equal((await api(first,'/api/productos')).find(p=>p.id===ids.product).stockActual,1);
  }finally{await web.close();}
 });
 test(`P0 2026-11-11 (${name}): Belen case, a new oc-login of the same role while the action waits does not reject the sale`,async()=>{
  const web=await engine.launch({headless:true});try{
   const ctx=await context(web),{page:first,ids}=await seed(ctx);await ownerLogin(first,'epoch change');
   await first.waitForFunction(()=>!window.OCTabSession?.pending&&OCTabSession.isCurrent());
   const r=await first.evaluate(async id=>{const e0=window.OC_AUTH_SESSION_EPOCH;
    const p=fetch('/api/productos/'+id+'/venta',{method:'POST',body:JSON.stringify({cantidad:1,opId:'p0-epoch-1',info:{formaPago:'cash'}})});
    window.dispatchEvent(new CustomEvent('oc-login',{detail:{rol:OCAuth.rolActual(),demo:false}}));
    const res=await p;return {status:res.status,body:await res.text(),epochMoved:window.OC_AUTH_SESSION_EPOCH!==e0};},ids.product);
   assert.equal(r.epochMoved,true,'precondition: the epoch changed while the action was waiting');
   assert.equal(r.status,200,'same role, only the epoch moved: the sale must pass: '+r.body);
   await first.waitForFunction(()=>!OCTabSession.pending);
   assert.equal((await api(first,'/api/ventas/todas')).length,2);
   assert.equal((await api(first,'/api/productos')).find(p=>p.id===ids.product).stockActual,1);
   assert.equal(await first.evaluate(()=>OCAuth.rolActual()),'dueno');
  }finally{await web.close();}
 });
 test(`P0 2026-11-11 (${name}): a REAL role change or sign-out still rejects the queued write with 403`,async()=>{
  const web=await engine.launch({headless:true});try{
   const ctx=await context(web),{page:first,ids}=await seed(ctx);await ownerLogin(first,'real changes');
   await first.waitForFunction(()=>!window.OCTabSession?.pending&&OCTabSession.isCurrent());
   const role=await first.evaluate(async id=>{const orig=OCAuth;
    const p=fetch('/api/productos/'+id+'/venta',{method:'POST',body:JSON.stringify({cantidad:1,opId:'p0-role-1',info:{formaPago:'cash'}})});
    window.OCAuth=Object.assign({},orig,{rolActual:()=> 'empleado'});
    try{const r=await p;return {status:r.status,body:await r.text()};}finally{window.OCAuth=orig;}},ids.product);
   assert.equal(role.status,403);assert.match(role.body,/Your session changed while this action was waiting/);
   const out=await first.evaluate(async id=>{
    const p=fetch('/api/productos/'+id+'/venta',{method:'POST',body:JSON.stringify({cantidad:1,opId:'p0-out-1',info:{formaPago:'cash'}})});
    OCAuth.salir();const r=await p;return {status:r.status,body:await r.text()};},ids.product);
   assert.equal(out.status,403);assert.match(out.body,/Your session changed while this action was waiting/);
   const third=await ctx.newPage();await third.goto(ORIGIN+'/index.html',{waitUntil:'load'});
   assert.equal((await api(third,'/api/ventas/todas')).length,1,'rejected writes left no sale behind');
   assert.equal((await api(third,'/api/productos')).find(p=>p.id===ids.product).stockActual,2);
  }finally{await web.close();}
 });
 test(`P0 2026-11-11 (${name}): focus takes the lease back silently, sync resumes, two visible screens never ping-pong`,async()=>{
  const web=await engine.launch({headless:true});try{
   const ctx=await context(web),{page:first}=await seed(ctx);await ownerLogin(first,'first');
   await first.waitForFunction(()=>!window.OCTabSession?.pending);await visible(first);
   const second=await secondScreen(ctx,first,'second takes over');await visible(second);
   await countLeaseWrites(first);await countLeaseWrites(second);
   assert.equal(await first.evaluate(()=>OCTabSession.canSync()),false);
   assert.equal(await second.evaluate(()=>OCTabSession.canSync()),true);
   // Old screen comes back to the front: it wins the lease, sync resumes there.
   await first.evaluate(()=>window.dispatchEvent(new Event('focus')));
   await first.waitForFunction(()=>OCTabSession.isCurrent()&&OCTabSession.canSync(),null,{timeout:3000});
   await second.waitForFunction(()=>!OCTabSession.isCurrent()&&!OCTabSession.canSync(),null,{timeout:3000});
   await first.waitForTimeout(800);
   // The loser must NOT react to the lease event by claiming again (no ping-pong).
   assert.equal(await leaseWrites(first),1,'exactly one silent lease write on focus');
   assert.equal(await leaseWrites(second),0,'the screen that lost the lease never writes it back from storage/channel events');
   for(const page of [first,second])assert.equal(await page.evaluate(()=>OCAuth.rolActual()),'dueno');
   for(const page of [first,second])assert.equal(await page.evaluate(()=>!!document.getElementById('oc-tab-handoff')),false);
   // And back again with pageshow on the other screen.
   await second.evaluate(()=>window.dispatchEvent(new Event('pageshow')));
   await second.waitForFunction(()=>OCTabSession.isCurrent()&&OCTabSession.canSync(),null,{timeout:3000});
   await first.waitForFunction(()=>!OCTabSession.isCurrent()&&!OCTabSession.canSync(),null,{timeout:3000});
   await second.waitForTimeout(800);
   assert.equal(await leaseWrites(first),1);assert.equal(await leaseWrites(second),1);
   // Focus on the screen that already owns the lease writes nothing.
   await second.evaluate(()=>window.dispatchEvent(new Event('focus')));await second.waitForTimeout(300);
   assert.equal(await leaseWrites(second),1);
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
  test(`Fable P1-4 native quota-failed second claim (${name}, ${stage}): original owner persists, contender cannot sync (writes are not blocked by the lease)`,async()=>{
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
      if(k.includes('auth_tab_lease_') &&
         (stage==='intent'?k.endsWith('_claim'):!k.endsWith('_claim'))){
       window.__quotaLeaseThrown++;
       throw new DOMException('Synthetic storage pressure','QuotaExceededError');
      }
      return original.call(this,key,value);
     };
    },stage);
    await ownerLogin(second,`quota contender (${name}, ${stage})`,first);
    try{
     await second.waitForFunction(()=>window.__quotaLeaseThrown>0&&!window.OCTabSession.pending,null,{timeout:10000});
    }catch(error){
     console.error('QUOTA_LEASE_NATIVE_FORENSIC',JSON.stringify(await second.evaluate(()=>({
      role:OCAuth?.rolActual?.(),pending:OCTabSession?.pending,current:OCTabSession?.isCurrent?.(),
      quotaThrows:window.__quotaLeaseThrown,authMessage:document.getElementById('oc-msg')?.textContent,
      trace:window.__tabTrace?.slice(-12),mutations:window.__leaseMutations?.slice(-12)
     }))));
     throw error;
    }
    const secondState=await sessionSnapshot(second),firstState=await sessionSnapshot(first);
    assert.equal(firstState.current,true,'legitimate previous owner must remain active');
    assert.equal(firstState.role,'dueno','storage pressure must not expel the previous authenticated owner');
    assert.equal(secondState.current,false,'failed new session cannot mutate without a committed lease');
    assert.equal(await second.evaluate(()=>OCTabSession.canSync()),false,'failed contender must not sync');
    const leases=firstState.leases.filter(x=>x.key.includes('auth_tab_lease'));
    assert.equal(leases.length,1,'only original durable lease remains, never an intent');
    assert.ok(!leases[0].key.endsWith('_claim'),'never strand the two-minute takeover intent');
    // JFC order 2026-11-11: the lease no longer authorizes business writes. This
    // used to assert that the contender write FAILED (>=400); now it is accepted
    // (the IndexedDB revision check arbitrates durable conflicts). What stays
    // fenced is SYNC (canSync false above) and the previous owner's lease/role.
    const contender=await second.evaluate(async()=>{const r=await fetch('/api/ubicaciones',{method:'POST',body:JSON.stringify({nombre:'Quota contender allowed',tipo:'propio'})});return r.status;});
    assert.ok(contender>=200&&contender<300,`contender write is not blocked by the lease; status ${contender}`);
    assert.equal(await second.evaluate(()=>OCTabSession.canSync()),false,'contender still must not sync');
    const accepted=await first.evaluate(async()=>{const r=await fetch('/api/ubicaciones',{method:'POST',body:JSON.stringify({nombre:'Quota legitimate owner',tipo:'propio'})});return r.status;});
    assert.ok(accepted>=200&&accepted<300,`existing owner must still be able to work; status ${accepted}`);
   }finally{await web.close();}
  });
 }
}
