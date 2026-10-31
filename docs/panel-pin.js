// JFC private panel: authoritative Owner PIN register, never stores PIN values.
(function(){
"use strict";
let selected=null;
const el=id=>document.getElementById(id);
function say(msg,bad){const node=el("lic-pin-state");if(node){node.textContent=msg;node.style.color=bad?"var(--red)":"var(--ink)"}}
function clear(){for(const id of ["lic-pin-new","lic-pin-confirm"]){const n=el(id);if(n)n.value=""}}
async function request(route,options={}){
 const cfg=typeof licWorkerUrl==="function"?licWorkerUrl():"";
 const key=typeof licMasterKey==="function"?licMasterKey():"";
 if(!cfg||!key)throw Error("Configura el Worker y la clave maestra del panel.");
 const base=new URL(cfg);if(base.protocol!=="https:")throw Error("Conexión HTTPS obligatoria");
 const response=await fetch(base.origin+route,{...options,cache:"no-store",headers:{"Content-Type":"application/json","X-Master-Key":key}});
 const data=await response.json().catch(()=>({ok:false}));
 if(!response.ok)throw Error(response.status===409?"Revisión cambiada; recarga antes de guardar.":"Worker rechazó el cambio ("+response.status+").");
 return data;
}
async function open(code,id){
 const licenseCode=String(code||"").trim().toUpperCase(),instanceId=String(id||"");
 if(!/^F123-[A-Z0-9*~$=-]{8,34}$/.test(licenseCode)||!/^[a-zA-Z0-9_-]{6,120}$/.test(instanceId))return;
 selected={licenseCode,instanceId,revision:null};
 const box=el("lic-pin-control");if(box)box.hidden=false;
 const name=el("lic-pin-license");if(name)name.textContent=licenseCode;
 clear();say("Consultando revisión central…",false);
 try{
  const q=new URLSearchParams({licenseCode,instanceId});
  const state=await request("/pin/admin/status?"+q);
  if(!selected||selected.instanceId!==instanceId||selected.licenseCode!==licenseCode)return;
  selected.revision=state.revision;
  say(state.configured?"PIN Owner central: revisión "+state.revision+", cambio "+new Date(state.changedAt).toLocaleString()+". El PIN permanece oculto.":"Sin revisión central: se requiere enrolamiento antes de imponer un nuevo PIN.",false);
 }catch(e){if(selected)selected.revision=null;say(String(e.message||e),true)}
}
async function save(){
 if(!selected||selected.revision===null)return say("Consulta primero la revisión central.",true);
 const pin=el("lic-pin-new")?.value||"",verify=el("lic-pin-confirm")?.value||"";
 if(!/^\d{3}$/.test(pin)||pin=== "456"||pin==="789"||pin!==verify){clear();return say("PIN inválido, reservado o distinto de su confirmación.",true)}
 if(!confirm("Registrar nuevo PIN Owner central para esta licencia. Los aparatos deben adoptar la revisión y confirmar el acceso. ¿Continuar?")){clear();return}
 const local={...selected};
 try{
  const out=await request("/pin/admin/set",{method:"POST",body:JSON.stringify({...local,pin,expectedRevision:local.revision})});
  clear();
  if(!selected||selected.licenseCode!==local.licenseCode)return;
  selected.revision=out.revision;
  say("Autoridad central guardada, revisión "+out.revision+". Verificar adopción en cada aparato antes de revocar el PIN local.",false);
 }catch(e){clear();say(String(e.message||e),true)}
}
document.addEventListener("click",e=>{const button=e.target?.closest?.("[data-owner-pin-license]");if(button)open(button.getAttribute("data-owner-pin-license"),button.getAttribute("data-owner-pin-instance"))});
window.licAbrirPinCentral=open;window.licFijarPinAutoridad=save;
})();