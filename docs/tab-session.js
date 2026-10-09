// Browser adapter: one authenticated UI session per notebook, with shared data
// still handled by the existing backend. No PIN or business records in leases.
(function(){
 'use strict';
 var id=crypto.randomUUID(),scopeKey='',claimed=false,pending=false,channel=null;
 var PUBLIC_URL='https://jfcarpiopuntocom.github.io/friendly-123/';
 var strings={
  es:{title:'Tu sesión continúa en otra pestaña',body:'Esta sesión se cerró. Puedes seguir en la otra pestaña o volver a entrar aquí con tu PIN.',resume:'Retomar aquí con PIN',tips:'Ideas para empezar',tip1:'Agrega un producto con su precio y stock.',tip2:'Registra una venta y revisa lo vendido.',tip3:'Si trabajas en equipo, asigna un PIN a cada persona.',recommend:'¿Conoces a alguien con negocio?',pitch:'Comparte Friendly con un amigo o familiar que venda productos o trabaje con comisiones.',share:'Recomendar Friendly',copy:'Copiar enlace',copied:'Enlace copiado.',manual:'Selecciona y copia el enlace.',opened:'El menú de compartir se abrió.',cancelled:'Puedes compartirlo cuando quieras.',shareText:'Friendly te ayuda a llevar inventario, ventas y comisiones. Prueba la demo.'},
  en:{title:'Your session continues in another tab',body:'This session is closed. Continue in the other tab, or sign in here again with your PIN.',resume:'Sign in here with PIN',tips:'Getting started',tip1:'Add a product with its price and stock.',tip2:'Record a sale and review what sold.',tip3:'If you work with a team, give each person a PIN.',recommend:'Know someone with a business?',pitch:'Share Friendly with a friend or relative who sells products or works with commissions.',share:'Recommend Friendly',copy:'Copy link',copied:'Link copied.',manual:'Select and copy the link.',opened:'The share menu opened.',cancelled:'You can share it whenever you like.',shareText:'Friendly helps you track inventory, sales and commissions. Try the demo.'}
 };
 function copy(){return strings[window.OCI18n&&OCI18n.getLang()==='en'?'en':'es'];}
 function lease(){try{return JSON.parse(localStorage.getItem(scopeKey)||'null');}catch(_){return null;}}
 function current(){if(pending)return false;if(!claimed)return true;var l=lease();return !!l&&l.owner===id;}
 function epoch(){window.OC_AUTH_SESSION_EPOCH=(window.OC_AUTH_SESSION_EPOCH||0)+1;}
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
  if(!claimed||!window.OCAuth||!OCAuth.rolActual()||current())return;
  // Uses the existing logout path: credentials, named user and role classes
  // are cleared. Marketing appears only in the session that actually closed.
  OCAuth.salir();render();
 }
 async function claim(){
  epoch();var claimEpoch=window.OC_AUTH_SESSION_EPOCH;clearPanel();pending=true;
  try{
   var owned={};try{owned=JSON.parse(localStorage.getItem('f123_owned')||'{}');}catch(_){}
   var notebook=localStorage.getItem('f123_tienda_activa')||owned.licenseCode||'demo';
   var digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(notebook));
   if(claimEpoch!==window.OC_AUTH_SESSION_EPOCH || !OCAuth.rolActual())return;
   scopeKey='f123_auth_tab_lease_'+Array.from(new Uint8Array(digest)).map(function(b){return b.toString(16).padStart(2,'0');}).join('');
   function take(){if(claimEpoch!==window.OC_AUTH_SESSION_EPOCH || !OCAuth.rolActual())return;localStorage.setItem(scopeKey,JSON.stringify({owner:id}));claimed=true;pending=false;try{channel?.postMessage({key:scopeKey});}catch(_){}check();}
   // Session handoff waits for a write already executing to finish. A queued
   // old-session write behind this claim is fenced by the authoritative lease.
   if(navigator.locks&&navigator.locks.request)await navigator.locks.request('f123-escrituras',take);else take();
  }catch(_){/* A failed lease never pretends the prior session was closed. */}
  finally{if(claimEpoch===window.OC_AUTH_SESSION_EPOCH)pending=false;}
 }
 try{channel=new BroadcastChannel('friendly-123-auth-session');channel.onmessage=function(ev){if(ev.data&&ev.data.key===scopeKey)check();};}catch(_){}
 window.addEventListener('storage',function(ev){if(ev.key===scopeKey||ev.key?.endsWith('::'+scopeKey))check();});
 window.addEventListener('focus',check);window.addEventListener('pageshow',check);
 document.addEventListener('visibilitychange',function(){if(!document.hidden)check();});
 window.addEventListener('oc-login',claim);
 window.addEventListener('oc-logout',function(){epoch();if(claimed&&lease()?.owner===id){try{localStorage.removeItem(scopeKey);}catch(_){}}claimed=false;pending=false;});
 window.addEventListener('oc-lang-change',function(){if(document.getElementById('oc-tab-handoff'))render();});
 window.OCTabSession={isCurrent:current,get pending(){return pending;}};
 var style=document.createElement('style');style.textContent='#oc-gate[data-tab-handoff="1"] > .caja:not(#oc-tab-handoff){display:none}#oc-tab-handoff{max-width:520px;color:#211C14!important;text-align:left!important}#oc-tab-handoff h2,#oc-tab-handoff h3{color:#211C14!important;-webkit-text-fill-color:#211C14!important}#oc-tab-handoff h2{font-size:22px;line-height:1.25}#oc-tab-handoff p,#oc-tab-handoff li{font-size:16px;line-height:1.5;color:#211C14!important;-webkit-text-fill-color:#211C14!important}#oc-tab-handoff button,#oc-tab-handoff summary{min-height:44px;font:inherit;font-weight:700;cursor:pointer}#oc-tab-resume{width:100%;border:2px solid #1C3049;border-radius:6px;padding:12px;background:#1C3049;color:#FFFFFF!important;-webkit-text-fill-color:#FFFFFF!important}#oc-tab-tips{margin:18px 0;border-top:2px solid #5294AC;border-bottom:2px solid #5294AC}#oc-tab-tips summary{padding:12px 0;color:#211C14!important}#oc-tab-tips ul{padding-left:22px}#oc-tab-handoff h3{font-size:18px;margin:0}#oc-tab-handoff .oc-tab-share-actions{display:flex;flex-wrap:wrap;gap:8px}#oc-tab-share,#oc-tab-copy{flex:1;border:2px solid #5294AC;border-radius:6px;padding:10px;background:#FFF8E8;color:#211C14!important;-webkit-text-fill-color:#211C14!important}#oc-tab-handoff input{width:100%;box-sizing:border-box;padding:10px;font-size:16px;color:#211C14;background:#FFFFFF;border:2px solid #5294AC}#oc-tab-handoff :focus-visible{outline:3px solid #E86040;outline-offset:3px}#oc-tab-share-status:empty{display:none}';document.head.appendChild(style);
 if(window.OCAuth&&OCAuth.rolActual())claim();
})();
