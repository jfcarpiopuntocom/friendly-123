// Browser adapter: one authenticated UI session per notebook, with shared data
// still handled by the existing backend. No PIN or business records in leases.
(function(){
 'use strict';
 var id=crypto.randomUUID(),scopeKey='',claimed=false,pending=false,suspendida=false,channel=null;
 var PUBLIC_URL='https://jfcarpiopuntocom.github.io/friendly-123/';
 var strings={
  es:{title:'Tu sesión continúa en otra pestaña',body:'Esta sesión se cerró. Puedes seguir en la otra pestaña o volver a entrar aquí con tu PIN.',resume:'Ingresar al dashboard con PIN',tips:'Herramientas amigas',tip1:'JFCarpio.com: más herramientas para negocios.',tip2:'BuscaClientes: encuentra oportunidades comerciales.',tip3:'La Escuela del Dinero: formación práctica.',recommend:'¿Conoces a alguien con negocio?',pitch:'Comparte Friendly con un amigo o familiar que venda productos o trabaje con comisiones.',share:'Recomendar Friendly',copy:'Copiar enlace',copied:'Enlace copiado.',manual:'Selecciona y copia el enlace.',opened:'El menú de compartir se abrió.',cancelled:'Puedes compartirlo cuando quieras.',shareText:'Friendly te ayuda a llevar inventario, ventas y comisiones. Prueba la demo.'},
  en:{title:'Your session continues in another tab',body:'This session is closed. Continue in the other tab, or sign in here again with your PIN.',resume:'Enter dashboard with PIN',tips:'Friendly tools',tip1:'JFCarpio.com: more tools for businesses.',tip2:'FindClients: find sales opportunities.',tip3:'The Money School: practical education.',recommend:'Know someone with a business?',pitch:'Share Friendly with a friend or relative who sells products or works with commissions.',share:'Recommend Friendly',copy:'Copy link',copied:'Link copied.',manual:'Select and copy the link.',opened:'The share menu opened.',cancelled:'You can share it whenever you like.',shareText:'Friendly helps you track inventory, sales and commissions. Try the demo.'}
 };
 function copy(){return strings[window.OCI18n&&OCI18n.getLang()==='en'?'en':'es'];}
 function lease(){try{return JSON.parse(localStorage.getItem(scopeKey)||'null');}catch(_){return null;}}
 // A new authenticated tab announces intent before waiting on Web Locks.
 // Queued writes from the former owner are fenced; in-flight writes can finish.
 function pendingClaim(){try{var p=JSON.parse(localStorage.getItem(scopeKey+'_claim')||'null');var age=Date.now()-Number(p&&p.at);return !!(p&&p.owner!==id&&age>=0&&age<120000);}catch(_){return false;}}
 function current(){if(pending)return false;if(!claimed)return true;var l=lease();return !!l&&l.owner===id&&!pendingClaim();}
 function puedeSincronizar(){return !document.hidden&&!suspendida&&current();}
 function avisarSync(){try{window.dispatchEvent(new Event("oc-tab-session-changed"));}catch(_){}}
 function epoch(reason){
  window.OC_AUTH_SESSION_EPOCH=(window.OC_AUTH_SESSION_EPOCH||0)+1;
  // Diagnostic only: reason codes contain no credentials or notebook data.
  try{
   var k='f123_p0_auth_epoch_trace_v1';
   var a=JSON.parse(localStorage.getItem(k)||'[]');
   var next=(Array.isArray(a)?a:[]).slice(-49);
   next.push({at:Date.now(),reason:reason||'unknown',hidden:document.hidden,pending:pending,claimed:claimed});
   localStorage.setItem(k,JSON.stringify(next));
  }catch(_){}
 }
 // P0 observation only, NEVER consulted by the authorization fence.
 // A pageshow(false) is not evidence of a WebKit process kill: normal loads
 // also fire it. pageshow(true) is evidence of a bfcache restoration.
 var p0LoadId=crypto.randomUUID(),p0HiddenAt=null;
 try{var p0Stored=Number(sessionStorage.getItem('f123_p0_hidden_at_v1'));if(Number.isFinite(p0Stored)&&p0Stored>0)p0HiddenAt=p0Stored;}catch(_){}
 function p0Lifecycle(kind,persisted){
  try{
   var now=Date.now(),visible=document.visibilityState==='visible';
   if((kind==='pagehide'||kind==='visibilitychange')&&!visible&&p0HiddenAt===null){
    p0HiddenAt=now;
    try{sessionStorage.setItem('f123_p0_hidden_at_v1',String(now));}catch(_){}
   }
   var duration=visible&&p0HiddenAt!==null?Math.max(0,now-p0HiddenAt):null;
   var row={at:now,kind:kind,loadId:p0LoadId,epoch:window.OC_AUTH_SESSION_EPOCH||0,
    visibility:document.visibilityState||'unknown',
    pageshowPersisted:kind==='pageshow'&&typeof persisted==='boolean'?persisted:null,
    hiddenDurationMs:duration,wasDiscarded:document.wasDiscarded===true};
   var k='f123_p0_page_lifecycle_v1';
   var rows=JSON.parse(localStorage.getItem(k)||'[]');
   var next=(Array.isArray(rows)?rows:[]).slice(-49);next.push(row);
   localStorage.setItem(k,JSON.stringify(next));
   if(visible&&p0HiddenAt!==null){p0HiddenAt=null;try{sessionStorage.removeItem('f123_p0_hidden_at_v1');}catch(_){}}
  }catch(_){}
 }
 p0Lifecycle('init',null);
 function clearPanel(){var gate=document.getElementById('oc-gate');if(gate)delete gate.dataset.tabHandoff;document.getElementById('oc-tab-handoff')?.remove();}
 function render(){
  var gate=document.getElementById('oc-gate');if(!gate)return;
  var c=copy(),panel=document.getElementById('oc-tab-handoff');
  if(!panel){panel=document.createElement('section');panel.id='oc-tab-handoff';panel.className='caja';panel.setAttribute('aria-labelledby','oc-tab-handoff-title');gate.appendChild(panel);}
  gate.dataset.tabHandoff='1';
  panel.innerHTML='<h2 id="oc-tab-handoff-title"></h2><p id="oc-tab-handoff-body"></p><button id="oc-tab-resume" type="button"></button><details id="oc-tab-tips"><summary></summary><ul><li></li><li></li><li></li></ul></details><div class="oc-tab-recommend"><h3></h3><p></p><div class="oc-tab-share-actions"><button id="oc-tab-share" type="button"></button><button id="oc-tab-copy" type="button"></button></div><p id="oc-tab-share-status" role="status" aria-live="polite"></p><input id="oc-tab-share-url" type="text" readonly hidden></div>';
  var q=function(s){return panel.querySelector(s);};
  q('h2').textContent=c.title;q('#oc-tab-handoff-body').textContent=c.body;q('#oc-tab-resume').textContent=c.resume;
  q('summary').textContent=c.tips;[c.tip1,c.tip2,c.tip3].forEach(function(t,i){panel.querySelectorAll('li')[i].textContent=t;});
  var toolsLink=document.createElement('a');toolsLink.href='https://jfcarpio.com';toolsLink.target='_blank';toolsLink.rel='noopener noreferrer';
  toolsLink.textContent=(window.OCI18n&&OCI18n.getLang()==='en'?'Explore business tools':'Explorar herramientas');
  q('#oc-tab-tips').appendChild(toolsLink);
  q('h3').textContent=c.recommend;q('.oc-tab-recommend > p').textContent=c.pitch;
  q('#oc-tab-share').textContent=c.share;q('#oc-tab-copy').textContent=c.copy;
  q('#oc-tab-share-url').value=PUBLIC_URL;q('#oc-tab-share-url').setAttribute('aria-label',c.copy);
  function status(t){q('#oc-tab-share-status').textContent=t;}
  function manual(){var input=q('#oc-tab-share-url');input.hidden=false;input.focus();input.select();status(copy().manual);}
  q('#oc-tab-resume').onclick=function(){clearPanel();var msg=document.getElementById('oc-msg');if(msg)msg.textContent='';document.querySelector('#oc-pad button')?.focus();};
  q('#oc-tab-share').onclick=async function(){
   if(!navigator.share){manual();return;}
   try{await navigator.share({title:'friendly-123',text:copy().shareText,url:PUBLIC_URL});status(copy().opened);}
   catch(error){if(error&&error.name==='AbortError')status(copy().cancelled);else manual();}
  };
  q('#oc-tab-copy').onclick=async function(){try{if(!navigator.clipboard||!navigator.clipboard.writeText)return manual();await navigator.clipboard.writeText(PUBLIC_URL);status(copy().copied);}catch(_){manual();}};
 }
 function check(){
  // Focus/storage events during our own PIN claim must never self-expel.
  // current() still fences writes while pending; take() checks after claim.
  if(pending)return;
  if(!claimed||!window.OCAuth||!OCAuth.rolActual()||current())return;
  // Uses the existing logout path: credentials, named user and role classes
  // are cleared. Marketing appears only in the session that actually closed.
  suspendida=true;avisarSync();OCAuth.salir();render();
 }
 async function claim(){
  epoch('pin-claim');var claimEpoch=window.OC_AUTH_SESSION_EPOCH;clearPanel();pending=true;avisarSync();
  try{
   var owned={};try{owned=JSON.parse(localStorage.getItem('f123_owned')||'{}');}catch(_){}
   var notebook=localStorage.getItem('f123_tienda_activa')||owned.licenseCode||'demo';
   var digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(notebook));
   if(claimEpoch!==window.OC_AUTH_SESSION_EPOCH || !OCAuth.rolActual())return;
   scopeKey='f123_auth_tab_lease_'+Array.from(new Uint8Array(digest)).map(function(b){return b.toString(16).padStart(2,'0');}).join('');
   // Fence queued old-tab writes BEFORE waiting. The actual lease remains
   // with the old owner until its currently executing write finishes.
   var claimKey=scopeKey+'_claim';
   localStorage.setItem(claimKey,JSON.stringify({owner:id,at:Date.now()}));
   function take(){
    if(claimEpoch!==window.OC_AUTH_SESSION_EPOCH || !OCAuth.rolActual())return;
    var intent;try{intent=JSON.parse(localStorage.getItem(claimKey)||'null');}catch(_){}
    if(!intent||intent.owner!==id){claimed=true;pending=false;check();return;}
    localStorage.setItem(scopeKey,JSON.stringify({owner:id}));
    if((JSON.parse(localStorage.getItem(claimKey)||'null')||{}).owner===id)localStorage.removeItem(claimKey);
    claimed=true;pending=false;suspendida=false;try{channel?.postMessage({key:scopeKey});}catch(_){}avisarSync();check();
   }
   // Claim is fenced by the shared lease + BroadcastChannel; never queue
   // a PIN login behind iOS Web Locks that can remain zombie after backgrounding.
   take();
  }catch(error){
   // An outdated claim must never undo logout (or a newer login).
   if(claimEpoch!==window.OC_AUTH_SESSION_EPOCH)return;
   // If writing the actual lease failed after writing our intent, do not
   // block the prior owner for two minutes. Never delete another tab's intent.
   try {
    if(scopeKey){
     var key=scopeKey+'_claim', intent=JSON.parse(localStorage.getItem(key)||'null');
     if(intent&&intent.owner===id)localStorage.removeItem(key);
    }
   }catch(_){}
   // The legacy !claimed shortcut is intended for non-claimed/guest contexts,
   // not for an authenticated tab that failed to acquire an exclusive lease.
   claimed=true;
   // Also work when a stripped-down session fixture lacks the helper.
   var held=null;
   try{held=scopeKey?JSON.parse(localStorage.getItem(scopeKey)||'null'):null;}catch(_){}
   suspendida=!(held&&held.owner===id);
   try{console.warn('[tab-session] Lease claim failed: writes fenced',error&&error.name||'Error');}catch(_){}
  }
  finally{if(claimEpoch===window.OC_AUTH_SESSION_EPOCH){pending=false;avisarSync();}}
 }
 try{channel=new BroadcastChannel('friendly-123-auth-session');channel.onmessage=function(ev){if(ev.data&&ev.data.key===scopeKey)check();};}catch(_){}
 window.addEventListener('storage',function(ev){if(ev.key===scopeKey||ev.key?.endsWith('::'+scopeKey))check();});
 window.addEventListener('focus',check);
 window.addEventListener('pagehide',function(){p0Lifecycle('pagehide',null);});
 window.addEventListener('pageshow',function(ev){p0Lifecycle('pageshow',!!(ev&&ev.persisted));check();});
 window.addEventListener('freeze',function(){p0Lifecycle('freeze',null);});
 window.addEventListener('resume',function(){p0Lifecycle('resume',null);});
 document.addEventListener('visibilitychange',function(){p0Lifecycle('visibilitychange',null);if(!document.hidden)check();avisarSync();});
 window.addEventListener('oc-login',claim);
 window.addEventListener('oc-logout',function(){
  epoch('logout');
  // Never check-then-delete shared lease: a second tab may own it already.
  // Fence this tab locally; next PIN login overwrites the shared lease.
  claimed=false;pending=false;suspendida=true;avisarSync();
 });
 window.addEventListener('oc-lang-change',function(){if(document.getElementById('oc-tab-handoff'))render();});
 // A snapshot is deliberately opaque: never expose notebook or license values.
 // A new PIN claim must finish before any fresh snapshot is accepted.
 function activeLicense(){
  try{
   var owned=JSON.parse(localStorage.getItem('f123_owned')||'{}');
   var code=String(owned.licenseCode||'').trim().toUpperCase();
   return /^F123-/i.test(code)?code:null;
  }catch(_){return null;}
 }
 // License is never returned as plaintext. Digest is distinct from notebook scope.
 async function authoritySnapshot(){
  if(!claimed||pending||suspendida||!scopeKey||!current())return null;
  var held=lease(),license=activeLicense();
  if(!held||held.owner!==id||pendingClaim()||!license)return null;
  var bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(license));
  if(!claimed||pending||suspendida||!current()||pendingClaim()||activeLicense()!==license)return null;
  return {scope:scopeKey,licenseHash:Array.from(new Uint8Array(bytes)).map(function(b){return b.toString(16).padStart(2,'0');}).join(''),role:window.OCAuth&&OCAuth.rolActual()||'',owner:id};
 }
 async function authorityContinuity(before){
  var after=await authoritySnapshot();
  return {
   sameNotebook:!!(before&&after&&before.scope===after.scope),
   sameLicense:!!(before&&after&&before.licenseHash===after.licenseHash),
   sameRole:!!(before&&after&&before.role===after.role),
   sameTab:!!(before&&after&&before.owner===after.owner),
   leaseCurrent:!!after,
   otherClaimPending:pendingClaim()
  };
 }
 window.OCTabSession={isCurrent:current,canSync:puedeSincronizar,authoritySnapshot:authoritySnapshot,authorityContinuity:authorityContinuity,get pending(){return pending;}};
 var style=document.createElement('style');style.textContent='#oc-gate[data-tab-handoff="1"] > .caja:not(#oc-tab-handoff){display:none}#oc-tab-handoff{max-width:520px;color:#211C14!important;text-align:left!important}#oc-tab-handoff h2,#oc-tab-handoff h3{color:#211C14!important;-webkit-text-fill-color:#211C14!important}#oc-tab-handoff h2{font-size:22px;line-height:1.25}#oc-tab-handoff p,#oc-tab-handoff li{font-size:16px;line-height:1.5;color:#211C14!important;-webkit-text-fill-color:#211C14!important}#oc-tab-handoff button,#oc-tab-handoff summary{min-height:44px;font:inherit;font-weight:700;cursor:pointer}#oc-tab-resume{width:100%;border:2px solid #1C3049;border-radius:6px;padding:12px;background:#1C3049;color:#FFFFFF!important;-webkit-text-fill-color:#FFFFFF!important}#oc-tab-tips{margin:18px 0;border-top:2px solid #5294AC;border-bottom:2px solid #5294AC}#oc-tab-tips summary{padding:12px 0;color:#211C14!important}#oc-tab-tips ul{padding-left:22px}#oc-tab-handoff h3{font-size:18px;margin:0}#oc-tab-handoff .oc-tab-share-actions{display:flex;flex-wrap:wrap;gap:8px}#oc-tab-share,#oc-tab-copy{flex:1;border:2px solid #5294AC;border-radius:6px;padding:10px;background:#FFF8E8;color:#211C14!important;-webkit-text-fill-color:#211C14!important}#oc-tab-handoff input{width:100%;box-sizing:border-box;padding:10px;font-size:16px;color:#211C14;background:#FFFFFF;border:2px solid #5294AC}#oc-tab-handoff :focus-visible{outline:3px solid #E86040;outline-offset:3px}#oc-tab-share-status:empty{display:none}';document.head.appendChild(style);
 if(window.OCAuth&&OCAuth.rolActual())claim();
})();
