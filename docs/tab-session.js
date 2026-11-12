// Browser adapter: one authenticated UI session per notebook, with shared data
// still handled by the existing backend. No PIN or business records in leases.
//
// P0 HOTFIX, ORDEN DE JFC (dueno) 2026-11-11: el turno (lease) compartido de
// localStorage YA NO cierra la sesion de la pantalla anterior ni bloquea sus
// escrituras. Una vendedora real no podia vender porque otra pantalla (pestana o
// PWA instalada en el mismo perfil) tomaba el turno con PIN y la pantalla vieja
// se cerraba sola y su venta recibia 403. Ahora:
//   * el turno SOLO gobierna la sincronizacion (canSync): la pantalla que lo
//     pierde pausa su sync y SIGUE trabajando, sin panel, banner ni modal;
//   * al volver a la pantalla (focus / pageshow / visibilitychange visible)
//     reclaim() retoma el turno en silencio y la sync se reanuda ahi;
//   * las escrituras de negocio ya no consultan el turno (mock-backend.js
//     _fetchConCandado: solo rol); la integridad la da el control de revision de
//     IndexedDB (guardarConRevision) y _recargarSiOtraPestanaEscribio.
// Para revertir TODO el hotfix: ver los comentarios "PARA REVERTIR" en check(),
// reclaim() y en mock-backend.js, y la entrada changeApproval de
// release/capabilities.json (same-browser-session-handoff).
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
 function epoch(){window.OC_AUTH_SESSION_EPOCH=(window.OC_AUTH_SESSION_EPOCH||0)+1;}
 function clearPanel(){var gate=document.getElementById('oc-gate');if(gate)delete gate.dataset.tabHandoff;document.getElementById('oc-tab-handoff')?.remove();}
 /* FEATURE - DORMANT (desactivada por orden de JFC, 2026-11-11). NO BORRAR.
    render() pinta el panel "Tu sesion continua en otra pestana" (copy, consejos,
    "Recomendar Friendly", compartir/copiar enlace). JFC ordeno que ese mensaje
    NO vuelva a salir: nadie llama a render() desde check() y el panel nunca se
    crea. El codigo, el copy (strings) y los estilos de abajo se conservan intactos.
    PARA REACTIVAR (solo con orden expresa de JFC): en check() reemplazar la rama
    activa por `suspendida=true;avisarSync();OCAuth.salir();render();` (ver el
    bloque DORMANT dentro de check()) y revertir el guard de mock-backend.js.
    El unico llamador restante es el listener oc-lang-change (solo repinta si el
    panel ya existe, es decir nunca mientras este dormido). */
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
  /* P0 HOTFIX (ORDEN DE JFC, dueno, 2026-11-11): perder el turno YA NO cierra la
     sesion. Antes aqui se llamaba OCAuth.salir() y render(): la pantalla vieja se
     cerraba sola, mostraba el panel "Tu sesion continua en otra pestana" y sus
     ventas pendientes recibian 403, de modo que una vendedora real (Belen) no
     podia vender. Ahora solo se PAUSA la sincronizacion desde esta pantalla
     (suspendida=true -> canSync()=false -> avisarSync() hace que sync-yjs.js y
     sync-realtime.js pausen sus salas); el usuario sigue trabajando, sin panel,
     banner ni modal ni texto nuevo. La sync se reanuda cuando la pantalla vuelve
     a primer plano y retoma el turno (reclaim(), abajo).
     OJO: check() se llama desde los eventos storage y channel: NUNCA retomar el
     turno desde aqui, o dos ventanas visibles se lo quitarian una a otra sin fin.
     FEATURE - DORMANT (desactivada por orden de JFC, 2026-11-11). NO BORRAR.
     Comportamiento anterior, conservado como referencia para reactivar:
       // Uses the existing logout path: credentials, named user and role classes
       // are cleared. Marketing appears only in the session that actually closed.
       // suspendida=true;avisarSync();OCAuth.salir();render();
     PARA REACTIVAR (solo con orden expresa de JFC): descomentar esa linea y
     quitar la de abajo; revertir tambien el guard de mock-backend.js
     (_fetchConCandado) y el contrato changeApproval de release/capabilities.json. */
  suspendida=true;avisarSync();
  /* v739 (revision de Fable 5.2, riesgo 1): si ESTA pantalla es la que esta en uso (visible y con foco) y perdio el turno
     porque otra pantalla oculta lo tomo (p. ej. una pestana que se recargo por version nueva), ningun evento de foco
     volveria a dispararse y su sincronizacion quedaria pausada en silencio. Solo la pantalla con foco lo retoma,
     como mucho una vez cada 2 s, y SOLO cuando el turno lo tiene una pantalla oculta (el turno anota v:0/1 al tomarlo):
     asi dos ventanas visibles no se lo quitan una a otra sin fin (lo prueba el test de dos pantallas visibles).
     PARA REVERTIR: quitar estas lineas. */
  try{
   // Solo si el turno lo tiene una pantalla OCULTA (v:0): dos pantallas visibles nunca se lo quitan una a otra.
   var dueno=lease();
   if(!document.hidden&&typeof document.hasFocus==='function'&&document.hasFocus()&&dueno&&dueno.v===0)reclaim();
  }catch(_){}
 }
 /* P0 HOTFIX (JFC 2026-11-11): toma de turno silenciosa al volver a la pantalla.
    Si esta pantalla esta autenticada y NO es la duena del turno, lo retoma sin
    pedir nada: gana la ultima pantalla en uso y la sincronizacion no queda
    pausada para siempre. Solo se registra para los eventos focus, pageshow y
    visibilitychange (visible), ver abajo. NUNCA llamarlo desde storage ni channel:
    con dos ventanas visibles cada una retomaria el turno al ver que la otra lo
    tomo (ping-pong). No toca la sesion, el rol ni ningun dato de negocio.
    Respeta una toma en curso de otra pantalla (pendingClaim) y no hace nada si
    localStorage falla (cuota): entonces la sync sigue pausada, igual que antes.
    PARA REVERTIR: quitar los tres listeners de reclaim() y esta funcion. */
 var ultimoReclaim=0;
 function reclaim(){
  if(!claimed||pending||!scopeKey||!window.OCAuth||!OCAuth.rolActual())return;
  if(current()||pendingClaim())return;
  if(Date.now()-ultimoReclaim<2000)return; ultimoReclaim=Date.now();
  try{
   localStorage.setItem(scopeKey,JSON.stringify({owner:id,v:document.hidden?0:1}));
   suspendida=false;
   try{channel?.postMessage({key:scopeKey});}catch(_){}
   avisarSync();
  }catch(_){}
 }
 async function claim(){
  epoch();var claimEpoch=window.OC_AUTH_SESSION_EPOCH;clearPanel();pending=true;avisarSync();
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
    localStorage.setItem(scopeKey,JSON.stringify({owner:id,v:document.hidden?0:1}));
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
 // reclaim() va registrado ANTES que check() para el mismo evento: si esta
 // pantalla vuelve a primer plano, primero retoma el turno y check() ya no la
 // suspende (evita pausar y reanudar la sync en cada vuelta). Solo estos tres
 // eventos retoman el turno; storage y channel NUNCA (ver reclaim()).
 window.addEventListener('focus',reclaim);window.addEventListener('pageshow',reclaim);
 document.addEventListener('visibilitychange',function(){if(!document.hidden)reclaim();});
 window.addEventListener('focus',check);window.addEventListener('pageshow',check);
 document.addEventListener('visibilitychange',function(){if(!document.hidden)check();avisarSync();});
 window.addEventListener('oc-login',claim);
 window.addEventListener('oc-logout',function(){
  epoch();
  // Never check-then-delete shared lease: a second tab may own it already.
  // Fence this tab locally; next PIN login overwrites the shared lease.
  claimed=false;pending=false;suspendida=true;avisarSync();
 });
 window.addEventListener('oc-lang-change',function(){if(document.getElementById('oc-tab-handoff'))render();});
 window.OCTabSession={isCurrent:current,canSync:puedeSincronizar,get pending(){return pending;}};
 var style=document.createElement('style');style.textContent='#oc-gate[data-tab-handoff="1"] > .caja:not(#oc-tab-handoff){display:none}#oc-tab-handoff{max-width:520px;color:#211C14!important;text-align:left!important}#oc-tab-handoff h2,#oc-tab-handoff h3{color:#211C14!important;-webkit-text-fill-color:#211C14!important}#oc-tab-handoff h2{font-size:22px;line-height:1.25}#oc-tab-handoff p,#oc-tab-handoff li{font-size:16px;line-height:1.5;color:#211C14!important;-webkit-text-fill-color:#211C14!important}#oc-tab-handoff button,#oc-tab-handoff summary{min-height:44px;font:inherit;font-weight:700;cursor:pointer}#oc-tab-resume{width:100%;border:2px solid #1C3049;border-radius:6px;padding:12px;background:#1C3049;color:#FFFFFF!important;-webkit-text-fill-color:#FFFFFF!important}#oc-tab-tips{margin:18px 0;border-top:2px solid #5294AC;border-bottom:2px solid #5294AC}#oc-tab-tips summary{padding:12px 0;color:#211C14!important}#oc-tab-tips ul{padding-left:22px}#oc-tab-handoff h3{font-size:18px;margin:0}#oc-tab-handoff .oc-tab-share-actions{display:flex;flex-wrap:wrap;gap:8px}#oc-tab-share,#oc-tab-copy{flex:1;border:2px solid #5294AC;border-radius:6px;padding:10px;background:#FFF8E8;color:#211C14!important;-webkit-text-fill-color:#211C14!important}#oc-tab-handoff input{width:100%;box-sizing:border-box;padding:10px;font-size:16px;color:#211C14;background:#FFFFFF;border:2px solid #5294AC}#oc-tab-handoff :focus-visible{outline:3px solid #E86040;outline-offset:3px}#oc-tab-share-status:empty{display:none}';document.head.appendChild(style);
 if(window.OCAuth&&OCAuth.rolActual())claim();
})();
