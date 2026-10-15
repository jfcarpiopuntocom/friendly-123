/* Optional, one-time notebook handoff when moving from github.io to friendly123.com.
 * The browser strictly isolates the two origins. Only a deliberate click in
 * BOTH trusted windows transfers a team code via postMessage (never URL,
 * server, log, telemetry or storage copy). Existing notebooks are untouched.
 * The existing OCSyncControl.unirse() performs the actual team join.
 * This cannot promise recovery without the old browser's license/sync peer. */
(function (win) {
  "use strict";
  if (!win || !win.document || !win.location) return;
  const LEGACY = "https://jfcarpiopuntocom.github.io";
  const OFFICIAL = ["https://friendly123.com", "https://www.friendly123.com"];
  const TAG = "f123-origin-handoff-v1";
  const here = win.location.origin;
  function es(){try{return win.localStorage.getItem("f123_lang")==="es";}catch(_){return false;}}
  function mensaje(en,espanol){return es()?espanol:en;}
  function owned(){
    try { return JSON.parse(win.localStorage.getItem("f123_owned") || "null") || {}; }
    catch (_) { return {}; }
  }
  function yaTieneIdentidad() {
    const o=owned();
    if (o.instanceId || /^F123-/i.test(String(o.licenseCode||"").trim())) return true;
    try {
      if (win.localStorage.getItem("f123_tienda_activa")) return true;
      const tiendas=JSON.parse(win.localStorage.getItem("f123_tiendas")||"{}")||{};
      return Object.keys(tiendas).length>0;
    } catch (_) { return true; } // uncertain storage => never risk switching identity
  }
  function validCode(code){
    const str=String(code||"").trim().toUpperCase();
    return /^F123-[0-9A-Z*~$=-]{8,34}$/.test(str) ? str : "";
  }
  function nonce(){
    if (!win.crypto || typeof win.crypto.getRandomValues!=="function") return "";
    const a=new Uint8Array(16);
    win.crypto.getRandomValues(a);
    return Array.from(a,n=>n.toString(16).padStart(2,"0")).join("");
  }
  function display(text,which){
    if (which) which.textContent=text;
  }
  function mountOfficial(){
    const gate=win.document.getElementById("oc-gate");
    const nearby=win.document.getElementById("oc-unirse-equipo");
    if (!gate || !nearby || yaTieneIdentidad() || win.document.getElementById("f123-origin-handoff")) return;
    const btn=win.document.createElement("button");
    btn.id="f123-origin-handoff";btn.type="button";
    btn.style.cssText="display:block;margin:0 auto;width:100%;min-height:44px;border:0;background:transparent;color:#234B67;font-size:14px;font-weight:700;text-decoration:underline;cursor:pointer;";
    btn.textContent=mensaje("My business was on the previous web address","Mi negocio estaba en la dirección anterior");
    const status=win.document.createElement("p");
    status.id="f123-origin-handoff-status";status.setAttribute("role","status");
    status.style.cssText="margin:2px 0 10px;font-size:13px;color:#234B67;text-align:center;";
    nearby.insertAdjacentElement("afterend",btn);btn.insertAdjacentElement("afterend",status);
    btn.addEventListener("click",function(){
      if (yaTieneIdentidad()) {display(mensaje("This device already has a notebook. No changes made.","Este dispositivo ya tiene un cuaderno. No se modificó nada."),status);return;}
      const id=nonce();
      if(!id) {display(mensaje("Secure browser transfer is unavailable. Use Join team above.","Transferencia segura no disponible. Usa Unirme a un equipo arriba."),status);return;}
      // A direct click is needed so Safari/iOS permits opening the old origin.
      const popup=win.open(LEGACY+"/friendly-123/#f123-handoff="+id,"_blank");
      if(!popup){display(mensaje("Allow the old-address window, or use Join team above.","Permite abrir la ventana anterior o usa Unirme a un equipo arriba."),status);return;}
      display(mensaje("Confirm on the old website. Keep both windows open until your notebook appears.","Confirma en el sitio anterior. Mantén ambas ventanas abiertas hasta que aparezca tu cuaderno."),status);
      function receive(ev){
        if(ev.origin!==LEGACY || ev.source!==popup || !ev.data || ev.data.tag!==TAG || ev.data.nonce!==id) return;
        if(ev.data.type==="ready") {
          try{popup.postMessage({tag:TAG,nonce:id,type:"request"},LEGACY);}catch(_){}
          return;
        }
        if(ev.data.type==="no-code"){
          display(mensaje("No existing license was found in that browser. Use Join team with your code.","Ese navegador no tiene una licencia anterior. Usa Unirme a un equipo con tu código."),status);
          win.removeEventListener("message",receive);return;
        }
        if(ev.data.type!=="grant")return;
        win.removeEventListener("message",receive);
        if (yaTieneIdentidad()) {display(mensaje("Existing notebook preserved; transfer was not applied.","Se conservó el cuaderno actual; no se aplicó el traspaso."),status);return;}
        const code=validCode(ev.data.code);
        if(!code || !win.OCSyncControl || typeof win.OCSyncControl.unirse!=="function"){
          display(mensaje("Could not join automatically. Use Join team with your original code.","No se pudo unir automáticamente. Usa Unirme a un equipo con tu código original."),status);
          return;
        }
        try{
          // Reuse the audited join path. No manual writes to financial data,
          // ownership records, device IDs, PINs, IndexedDB or local snapshots.
          const joined=win.OCSyncControl.unirse(code);
          display(joined&&joined.ok
            ? mensaje("Joining your team. Keep the old window open until the original data appears.","Uniendo tu equipo. Mantén abierta la ventana anterior hasta ver tus datos reales.")
            : mensaje("Automatic join was not confirmed. Use Join team above.","No se confirmó la unión. Usa Unirme a un equipo arriba."),status);
        }catch(_){display(mensaje("Join could not be confirmed. Your existing data was not deleted.","No se confirmó la unión. No se borraron tus datos existentes."),status);}
      }
      win.addEventListener("message",receive);
    });
  }
  function mountLegacy(){
    const match=String(win.location.hash||"").match(/^#f123-handoff=([a-f0-9]{32})$/);
    if(!match || !win.opener) return;
    const id=match[1];let requested=false;
    function receive(ev){
      if(!OFFICIAL.includes(ev.origin) || ev.source!==win.opener || !ev.data ||
          ev.data.tag!==TAG || ev.data.nonce!==id || ev.data.type!=="request" || requested)return;
      requested=true;win.removeEventListener("message",receive);
      const code=validCode(owned().licenseCode);
      if(!code) {
        win.opener.postMessage({tag:TAG,nonce:id,type:"no-code"},ev.origin);
        return;
      }
      const cover=win.document.createElement("div");
      cover.id="f123-old-address-approve";
      cover.style.cssText="position:fixed;inset:0;z-index:100100;display:flex;align-items:center;justify-content:center;padding:20px;background:#0F1923EE;";
      const card=win.document.createElement("div");
      card.style.cssText="background:#fff;color:#0F1923;padding:24px;max-width:420px;width:100%;border-radius:12px;box-sizing:border-box;";
      const h=win.document.createElement("h2");h.style.cssText="font-size:21px;color:#0F1923;";
      h.textContent=mensaje("Move my existing team access","Trasladar el acceso a mi equipo");card.appendChild(h);
      const p=win.document.createElement("p");p.style.cssText="font-size:16px;line-height:1.5;color:#0F1923;";
      p.textContent=mensaje("Share your private team code with friendly123.com in this browser only? Keep this old tab open until your original records have synchronized.","¿Compartir el código privado de tu equipo con friendly123.com solo entre estas ventanas? Mantén abierta esta pestaña hasta sincronizar tus registros originales.");
      card.appendChild(p);
      const yes=win.document.createElement("button"),no=win.document.createElement("button");
      [yes,no].forEach(b=>{b.type="button";b.style.cssText="width:100%;min-height:48px;font-size:16px;padding:10px;border:2px solid #19354B;border-radius:8px;margin-top:8px;cursor:pointer;";card.appendChild(b);});
      yes.textContent=mensaje("Authorize this one-time join","Autorizar esta unión única");
      no.textContent=mensaje("Cancel","Cancelar");
      yes.addEventListener("click",function(){
        yes.disabled=true;no.disabled=true;
        win.opener.postMessage({tag:TAG,nonce:id,type:"grant",code},ev.origin);
        p.textContent=mensaje("Authorized. Keep this tab open until the official app shows your real notebook.","Autorizado. Mantén esta pestaña abierta hasta que la app oficial muestre tu cuaderno real.");
      });
      no.addEventListener("click",function(){cover.remove();});
      cover.appendChild(card);win.document.body.appendChild(cover);
    }
    win.addEventListener("message",receive);
    function ready(){try{win.opener.postMessage({tag:TAG,nonce:id,type:"ready"},OFFICIAL[0]);win.opener.postMessage({tag:TAG,nonce:id,type:"ready"},OFFICIAL[1]);}catch(_){}}
    ready();win.setTimeout(ready,800);win.setTimeout(ready,2000);
  }
  if(here===LEGACY) mountLegacy();
  else if(OFFICIAL.includes(here)) mountOfficial();
})(typeof window!=="undefined"?window:null);
