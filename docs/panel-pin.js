// Private JFC PIN workflow: inventory existing access, stage, then explicitly activate.
// Never caches PIN values, never touches business notebooks.
(function(){
"use strict";
let selected=null;
const el=id=>document.getElementById(id);
function say(msg,bad){const n=el("lic-pin-state");if(n){n.textContent=msg;n.style.color=bad?"var(--red)":"var(--ink)"}}
function clear(){for(const id of ["lic-pin-new","lic-pin-confirm"]){const n=el(id);if(n)n.value=""}}
function render(s){
 if(!selected)return;
 selected.revision=s.revision;selected.pendingRevision=s.pendingRevision;
 const summary=el("lic-pin-summary");
 if(summary)summary.textContent=(s.configured?"PIN central activo · revisión "+s.revision:"Fase 1 · recopilando PIN anteriores")+
  " · "+s.observedDevices+" / "+(Number.isSafeInteger(s.registeredDevices)?s.registeredDevices:"?")+" aparatos registrados"+
  (s.conflictingReports?" · PIN distintos detectados":"")+
  (s.pendingRevision!==null?" · propuesta "+s.pendingRevision+" pendiente":"");
 const list=el("lic-pin-devices");
 if(list && typeof document.createElement==="function"){
  list.replaceChildren();
  for(const d of (s.deviceReports||[])){
   const cell=document.createElement("span");cell.className="lic-pin-device";
   cell.textContent="Aparato …"+d.deviceSuffix+" · grupo PIN "+d.pinGroup+" · "+new Date(d.reportedAt).toLocaleString()+" · por confirmar";
   list.appendChild(cell);
  }
 }
 const stage=el("lic-pin-stage"),activate=el("lic-pin-activate");
 // Phase 1: JFC must be able to see an existing-PIN report from EVERY
 // registered device before coordinating a forced revision. Missing devices
 // keep their existing access; no silent forced migration in production.
 const censusComplete=s.censusComplete===true; // exact authoritative ID coverage, never count guessed in UI
 selected.censusComplete=censusComplete;
 if(stage)stage.disabled=!censusComplete;
 if(activate)activate.disabled=!censusComplete || s.pendingRevision===null;
 if(!censusComplete && summary)summary.textContent+=" · Faltan aparatos: primero registrar PIN existentes";
}
async function request(route,options={}){
 const cfg=typeof licWorkerUrl==="function"?licWorkerUrl():"";
 const key=typeof licMasterKey==="function"?licMasterKey():"";
 if(!cfg||!key)throw Error("Configura el Worker y la clave maestra del panel.");
 const base=new URL(cfg);
 if(base.protocol!=="https:"||base.hostname!=="friendly123-licencias.jfcarpio.workers.dev")
  throw Error("PIN y clave maestra sólo pueden enviarse al Worker oficial friendly123-licencias.");
 const response=await fetch(base.origin+route,{...options,cache:"no-store",headers:{"Content-Type":"application/json","X-Master-Key":key}});
 const data=await response.json().catch(()=>({ok:false}));
 if(!response.ok||data.ok===false)throw Error(data.reason==="revision-conflict"?"Revisión cambió; vuelve a consultar.":data.reason||"Worker: "+response.status);
 return data;
}
async function refresh(){
 if(!selected)return;
 const before={...selected};const q=new URLSearchParams({licenseCode:before.licenseCode,instanceId:before.instanceId});
 const state=await request("/pin/admin/status?"+q);
 if(!selected||selected.instanceId!==before.instanceId||selected.licenseCode!==before.licenseCode)return;
 render(state);return state;
}
async function open(code,id,knownDevices){
 const licenseCode=String(code||"").trim().toUpperCase(),instanceId=String(id||"");
 if(!/^F123-[A-Z0-9*~$=-]{8,34}$/.test(licenseCode)||!/^[a-zA-Z0-9_-]{6,120}$/.test(instanceId))return;
 selected={licenseCode,instanceId,revision:null,pendingRevision:null,knownDevices:Number.isSafeInteger(Number(knownDevices))&&Number(knownDevices)>0?Number(knownDevices):null};
 const box=el("lic-pin-control");if(box){box.hidden=false;box.scrollIntoView?.({block:"nearest",behavior:"smooth"})}
 el("lic-pin-license").textContent=licenseCode;
 clear();say("Consultando solo metadatos centrales…",false);
 try{await refresh();say("Los PIN actuales de clientes no se sustituyen durante la fase 1.",false)}
 catch(e){if(selected)selected.revision=null;say(String(e.message||e),true)}
}
function getPin(){
 const pin=el("lic-pin-new")?.value||"",confirmation=el("lic-pin-confirm")?.value||"";
 if(!/^\d{3}$/.test(pin)||pin==="456"||pin==="789"||pin!==confirmation)throw Error("El PIN es inválido, reservado o difiere de la confirmación.");
 return pin;
}
async function stage(){
 if(!selected||selected.revision===null)return say("Consulta la revisión central.",true);
 if(!selected.censusComplete)return say("Registra los PIN de todos los aparatos de esta licencia antes de preparar el cambio.",true);
 let pin;try{pin=getPin()}catch(e){clear();return say(e.message,true)}
 if(!confirm("PASO 1/2: preparar cambio JFC sin sustituir el PIN de ningún cliente. ¿Continuar?")){clear();return}
 const snap={...selected};
 try{
  const result=await request("/pin/admin/set",{method:"POST",body:JSON.stringify({...snap,pin,expectedRevision:snap.revision})});
  clear();if(!selected||selected.licenseCode!==snap.licenseCode)return;
  render(result);say("Propuesta guardada sin activar. El PIN vigente sigue funcionando. Para imponerla: vuelve a escribirlo y pulsa ACTIVAR.",false);
 }catch(e){clear();say(e.message,true)}
}
async function activate(){
 if(!selected||selected.revision===null||selected.pendingRevision===null||!selected.censusComplete)return say("Primero registra todos los PIN existentes de la licencia y prepara la propuesta.",true);
 let pin;try{pin=getPin()}catch(e){clear();return say(e.message,true)}
 if(!confirm("PASO 2/2: JFC IMPONDRÁ esta revisión como PIN Owner central. Comprobaste los aparatos y sus PIN previos; cualquier aparato aún sin censo requerirá recuperación. ¿Confirmar?")){clear();return}
 const snap={...selected};
 try{
  const result=await request("/pin/admin/activate",{method:"POST",body:JSON.stringify({...snap,pin,expectedRevision:snap.revision})});
  clear();if(!selected||selected.licenseCode!==snap.licenseCode)return;
  render(result);say("Revisión "+result.revision+" activada en la autoridad central. Verificar recuperación de cada aparato antes de declarar convergencia.",false);
 }catch(e){clear();say(e.message,true)}
}
document.addEventListener("click",e=>{const button=e.target?.closest?.("[data-owner-pin-license]");if(button)open(button.getAttribute("data-owner-pin-license"),button.getAttribute("data-owner-pin-instance"),button.getAttribute("data-owner-pin-count"))});
window.licAbrirPinCentral=open;window.licFijarPinAutoridad=stage;window.licActivarPinAutoridad=activate;
})();