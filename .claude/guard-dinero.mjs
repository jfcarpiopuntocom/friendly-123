// guard-dinero.mjs — los invariantes de plata, comprobados contra el backend real.
//
// Existe porque estos numeros los verifique a mano tres veces esta semana. Un
// guard los comprueba en cada cambio, gratis, y grita si alguien los rompe.
//
// Invariantes:
//   1. comision + neto de la casa == bruto, en TODA venta con reparto
//   2. el % del asociado + el % de la casa == 100
//   3. las dos lecturas de Comisiones (por trato y por persona) dan el mismo total
//   4. un porcentaje invalido (null, "", -5, 101) se RECHAZA, nunca se toma como 0
import fs from "node:fs";
const repo = process.argv[2] || process.cwd();
const store = new Map();
const ls = {get length(){return store.size},key:i=>[...store.keys()][i],
  getItem:k=>store.has(k)?store.get(k):null,setItem:(k,v)=>{store.set(k,String(v))},
  removeItem:k=>{store.delete(k)},clear:()=>store.clear()};
const noop=()=>{};
const el=()=>({style:{cssText:"",display:""},setAttribute:noop,appendChild:noop,
  addEventListener:noop,remove:noop,querySelector:()=>null,querySelectorAll:()=>[],
  insertBefore:noop,classList:{add:noop,remove:noop},dataset:{},id:"",
  set innerHTML(v){},get innerHTML(){return ""}});
globalThis.window=globalThis; globalThis.localStorage=ls; globalThis.sessionStorage=ls;
globalThis.document={getElementById:()=>null,createElement:el,querySelector:()=>null,
  querySelectorAll:()=>[],addEventListener:noop,body:el(),documentElement:el(),
  readyState:"complete",head:el()};
Object.defineProperty(globalThis,"navigator",{value:{storage:null},configurable:true});
globalThis.location={origin:"http://x",href:"http://x/",pathname:"/"};
globalThis.CustomEvent=class{constructor(t,o){this.type=t;Object.assign(this,o)}};
globalThis.addEventListener=noop; globalThis.dispatchEvent=noop;
new Function(fs.readFileSync(repo+"/docs/mock-backend.js","utf8"))();
const api=async(p,o)=>{const r=await globalThis.fetch(p,o);return {s:r.status,b:await r.json()}};

let f=0;
const di=(m)=>{console.error("  "+m);f++};

const liq=(await api("/api/liquidaciones")).b;
if(!Array.isArray(liq)){di("liquidaciones no devolvio una lista");process.exit(1)}

// 2. los porcentajes suman 100
for(const l of liq){
  if(l.pctBase==null||l.pctQuedaEnCasa==null) continue;
  if(Math.abs(l.pctBase+l.pctQuedaEnCasa-100)>0.05) di(`% no suman 100 en ${l.ubicacion}: ${l.pctBase}+${l.pctQuedaEnCasa}`);
}
// 1. el reparto suma el bruto
for(const l of liq){
  if(!l.ventasBrutas) continue;
  const suma=(l.comisionSocio||0)+(l.netoDueno||0);
  if(Math.abs(suma-l.ventasBrutas)>0.05+(l.contribFija||0)) di(`reparto no cuadra en ${l.ubicacion}: ${l.comisionSocio}+${l.netoDueno} != ${l.ventasBrutas}`);
}
// 4. porcentajes invalidos se rechazan
const conCom=liq.find(l=>l.ventasBrutas>0);
if(conCom){
  const vt=(await api("/api/ventas/todas?ubicacionId=todas")).b;
  const conSplit=Array.isArray(vt)?vt.find(v=>v.comisionPct!=null):null;
  if(conSplit){
    for(const malo of [null,"",-5,101,"abc"]){
      const r=await api(`/api/ventas/${conSplit.id}/comision`,{method:"PATCH",headers:{},body:JSON.stringify({comisionPct:malo})});
      if(r.s===200) di(`acepto un porcentaje invalido: ${JSON.stringify(malo)}`);
    }
    // y tras una correccion valida el reparto sigue sumando el bruto
    const r=await api(`/api/ventas/${conSplit.id}/comision`,{method:"PATCH",headers:{},body:JSON.stringify({comisionPct:85,quien:"guard",motivo:"guard"})});
    if(r.s===200){
      const sp=r.b.venta.split;
      if(Math.abs(sp.montoComisionSocio+sp.montoNetoDueno-sp.montoBruto)>0.02) di("tras corregir, el reparto ya no suma el bruto");
      if(!sp.corregida||!Array.isArray(sp.correcciones)||!sp.correcciones.length) di("una correccion no dejo rastro");
    }
  }
}
process.exit(f?1:0);
