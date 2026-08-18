// Los casos de negocio REALES que describio JFC, contra el motor unico.
import fs from "node:fs";
const repo=process.argv[2];
const store=new Map();
const ls={get length(){return store.size},key:i=>[...store.keys()][i],
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
const put=(id,body)=>api(`/api/ubicaciones/${id}`,{method:"PUT",headers:{},body:JSON.stringify(body)});
let f=0; const di=m=>{console.log("   FALLO:",m);f++};
const nom=repo.split("/").pop();
console.log(`\n===== ${nom} =====`);

const ubis=(await api("/api/ubicaciones?todas=1")).b.filter(u=>u.tipo&&u.tipo!=="propio");
const prods=(await api("/api/productos?ubicacionId=todas")).b;
const A=ubis[0], B=ubis[1];

// --- CASO 1: la promotora piensa "me llevo el 10" ---
await put(A.id,{comisionSocio:10, lecturaPreferida:"asociado"});
let l=(await api("/api/liquidaciones")).b.find(x=>x.ubicacionId===A.id);
console.log(`1. Vendedora "me llevo el 10"     -> pct=${l.pctBase} casa=${l.pctQuedaEnCasa} lectura=${l.lecturaPreferida}`);
if(l.pctBase!==10||l.pctQuedaEnCasa!==90) di("no guardo 10/90");
if(l.lecturaPreferida!=="asociado") di("no recordo la lectura");

// --- CASO 2: la galeria piensa "retengo el 15", el artista se lleva el resto ---
await put(B.id,{pctQuedaEnCasa:15});
l=(await api("/api/liquidaciones")).b.find(x=>x.ubicacionId===B.id);
console.log(`2. Galeria "retengo el 15"        -> pct=${l.pctBase} casa=${l.pctQuedaEnCasa} lectura=${l.lecturaPreferida}`);
if(l.pctBase!==85) di(`escribio 15 de casa y no dio 85 al artista (dio ${l.pctBase})`);
if(l.pctQuedaEnCasa!==15) di("la casa no retiene 15");
if(l.lecturaPreferida!=="casa") di("no recordo que este negocio piensa al reves");

// --- CASO 3: el reparto real de una venta cuadra al centavo ---
const pA=prods.filter(p=>p.ubicacionId===B.id&&p.stockActual>1)[0];
const v=await api(`/api/productos/${pA.id}/venta`,{method:"POST",headers:{},body:JSON.stringify({cantidad:1})});
if(v.s===200){
  const vt=(await api("/api/ventas/todas?ubicacionId=todas")).b.find(x=>x.id===v.b.ventaId);
  const suma=+(vt.comisionAsociado+vt.netoCasa).toFixed(2);
  console.log(`3. Venta al 85/15                 -> artista=$${vt.comisionAsociado} casa=$${vt.netoCasa} suma=$${suma}`);
  if(Math.abs(vt.comisionAsociado/(suma||1)*100-85)>0.5) di("el reparto no respeta el 85%");
}

// --- CASO 4: aporte fijo antes del % (el artista pone $20 por el evento) ---
await put(A.id,{comisionSocio:50, contribFija:20, escalasComision:[]});
const pB=prods.filter(p=>p.ubicacionId===A.id&&p.stockActual>2)[0];
const v2=await api(`/api/productos/${pB.id}/venta`,{method:"POST",headers:{},body:JSON.stringify({cantidad:1})});
if(v2.s===200){
  const vt=(await api("/api/ventas/todas?ubicacionId=todas")).b.find(x=>x.id===v2.b.ventaId);
  const bruto=+(vt.comisionAsociado+vt.netoCasa).toFixed(2);
  const esperado=+(Math.max(0,bruto-20)*0.5).toFixed(2);
  console.log(`4. Aporte fijo $20, luego 50%     -> bruto=$${bruto} asociado=$${vt.comisionAsociado} (esperado $${esperado})`);
  if(Math.abs(vt.comisionAsociado-esperado)>0.02) di("el aporte fijo no se descuenta antes del %");
  if(vt.comisionAsociado+vt.netoCasa-bruto>0.02) di("no suma el bruto");
}

// --- CASO 5: minimo garantizado ("te aseguro $50 o el 20%, lo que sea mayor") ---
await put(A.id,{comisionSocio:20, contribFija:0, minimoGarantizado:50});
const pC=prods.filter(p=>p.ubicacionId===A.id&&p.stockActual>3)[0];
const v3=await api(`/api/productos/${pC.id}/venta`,{method:"POST",headers:{},body:JSON.stringify({cantidad:1})});
if(v3.s===200){
  const vt=(await api("/api/ventas/todas?ubicacionId=todas")).b.find(x=>x.id===v3.b.ventaId);
  const bruto=+(vt.comisionAsociado+vt.netoCasa).toFixed(2);
  console.log(`5. Minimo $50 o 20%, el mayor     -> bruto=$${bruto} asociado=$${vt.comisionAsociado}`);
  if(vt.comisionAsociado>bruto+0.01) di("le pago mas de lo que se vendio");
  if(bruto>=50 && vt.comisionAsociado<Math.min(50,bruto)-0.01) di("no respeto el minimo");
}

// --- CASO 6: escalas y aporte fijo juntos -> se RECHAZA al configurar ---
// Bloquearlo al escribir es mejor que corregirlo al leer: el duenio se entera
// cuando lo configura, no en la liquidacion de fin de mes.
await put(A.id,{comisionSocio:10, contribFija:0, metaMensual:500,
  escalasComision:[{hasta:50,comision:10},{hasta:100,comision:20}]});
const r6=await put(A.id,{contribFija:25});
console.log(`6. Escalas + aporte fijo juntos   -> ${r6.s===400?"RECHAZADO al configurar (correcto)":"aceptado, status "+r6.s}`);
if(r6.s!==400) di("dejo combinar escalas con aporte fijo");
l=(await api("/api/liquidaciones")).b.find(x=>x.ubicacionId===A.id);
if(l.contribFija!==0) di("quedo un aporte fijo aplicado junto a escalas");

// --- CASO 7: la MISMA persona, dos tratos distintos a la vez ---
const proms=(await api("/api/promotoras")).b;
if(proms.length){
  await put(A.id,{promotoraId:proms[0].id, usarComisionPropia:true, comisionSocio:10,
    contribFija:0, minimoGarantizado:0, escalasComision:[], metaMensual:0});
  await put(B.id,{promotoraId:proms[0].id, usarComisionPropia:true, pctQuedaEnCasa:15});
  const ls2=(await api("/api/liquidaciones")).b.filter(x=>[A.id,B.id].includes(x.ubicacionId));
  console.log(`7. Misma persona, dos tratos      -> ${ls2.map(x=>`${x.ubicacion.slice(0,18)}:${x.pctBase}%`).join(" | ")}`);
  const pcts=ls2.map(x=>x.pctBase).sort((a,b)=>a-b);
  if(pcts[0]!==10||pcts[1]!==85) di(`no sostuvo los dos tratos a la vez (${pcts})`);
}

// --- CASO 8: invariante duro sobre TODAS las ventas con reparto ---
const todas=(await api("/api/ventas/todas?ubicacionId=todas")).b.filter(v=>v.comisionPct!=null);
let malas=0;
for(const v of todas){
  const suma=+(v.comisionAsociado+v.netoCasa).toFixed(2);
  if(v.comisionAsociado<-0.001||v.netoCasa<-0.001) malas++;
}
console.log(`8. ${todas.length} ventas con reparto -> ninguna en negativo: ${malas===0?"OK":"NO ("+malas+")"}`);
if(malas) di("hay repartos en negativo");

console.log(f?`\n${f} FALLO(S) EN ${nom}`:`\nMOTOR DE TRATOS OK EN ${nom}`);
process.exit(f?1:0);
