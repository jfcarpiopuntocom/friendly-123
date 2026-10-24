'use strict';
// 1AAA / idiomARTE · 24 Oct 2026. OFFLINE / READ-ONLY audit of a notebook export
// PLUS the separately stored append-only Hechos ledger. No mutation, sync,
// HTTP, live licenses, import, restore, or guessed customer assignment.
const fs=require('node:fs');
function dataOf(h){return h&&h.datos&&h.datos.payload?h.datos.payload:(h&&h.datos)||{};}
function isArray(x,name){if(!Array.isArray(x))throw Error(name+' must be an array');return x;}
function groupDate(ts,tz){
  const t=typeof ts==='number'?ts:Date.parse(ts||'');
  if(!Number.isFinite(t))return '?';
  return new Intl.DateTimeFormat('en-CA',{timeZone:tz,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(t));
}
function analyze({notebook,ledger,date,term='',timeZone='America/Guayaquil'}){
  if(!notebook||!ledger)throw Error('both notebook AND ledger are mandatory');
  const sales=isArray(notebook.ventas,'notebook.ventas');
  const products=isArray(notebook.productos||[],'notebook.productos');
  const facts=isArray(Array.isArray(ledger)?ledger:ledger.hechos,'ledger.hechos');
  const saleById=new Map(sales.filter(x=>x&&x.id).map(x=>[String(x.id),x]));
  const productById=new Map(products.filter(x=>x&&x.id).map(x=>[String(x.id),x]));
  const links=new Map();
  // Append-only manual link/unlink facts. Later event wins for diagnostics,
  // but the source events themselves are NEVER erased or adjusted.
  facts.filter(h=>h&&h.tipo==='cartera_vinculo').sort((a,b)=>
    Number(a.ts||0)-Number(b.ts||0)||String(a.id||'').localeCompare(String(b.id||''))).forEach(h=>{
      const d=dataOf(h),key=String(d.clienteId||'')+'|'+String(d.cargoId||'');
      if(d.cargoId)links.set(key,d.accion==='vincular'&&d.ventaId?String(d.ventaId):null);
    });
  const out=[];
  for(const h of facts){
    if(!h||h.tipo!=='cartera_cargo')continue;
    const d=dataOf(h),client=String(d.clienteId||'');
    const linked=String(d.ventaId||links.get(client+'|'+String(h.id||''))||'');
    const sale=linked?saleById.get(linked):null;
    const product=sale?productById.get(String(sale.productoId||'')):null;
    const item=String(d.motivo||'')+' '+String(product&&product.nombre||'');
    const day=groupDate(h.ts,timeZone);
    if(date&&day!==date)continue;
    if(term&&!item.toLocaleLowerCase().includes(term.toLocaleLowerCase()))continue;
    let status='SIN_VENTA_VINCULADA';
    if(linked&&!sale)status='VENTA_NO_DISPONIBLE';
    else if(sale&&!sale.clienteId)status='VENTA_SIN_CLIENTE';
    else if(sale&&String(sale.clienteId)!==client)status='CLIENTE_EXPLICITO_DISTINTO';
    else if(sale)status='VINCULO_COINCIDE';
    out.push({cargoId:String(h.id||''),clienteCargoId:client,ventaId:linked||null,
      clienteVentaId:sale?String(sale.clienteId||''):null,fecha:day,
      monto:Number(d.monto),motivo:String(d.motivo||''),
      estado:status});
  }
  return {schema:'fiados-audit-readonly-v1',date:date||null,timeZone,
    hechosAnalizados:facts.length,ventasAnalizadas:sales.length,
    cargos:out,conteos:out.reduce((acc,r)=>(acc[r.estado]=(acc[r.estado]||0)+1,acc),{})};
}
function present(r,{fullIds=false}={}){
 // Privacy: a short customer ID must never be printed unmasked. Each original
 // gets a stable alias inside THIS report only, without keeping any lookup.
 const aliases=new Map();
 const mask=id=>{
   const raw=String(id||'');
   if(fullIds||!raw)return raw;
   if(!aliases.has(raw))aliases.set(raw,'ID-'+(aliases.size+1));
   return aliases.get(raw);
 };
 return {...r,cargos:r.cargos.map(x=>({...x,cargoId:mask(x.cargoId),
    clienteCargoId:mask(x.clienteCargoId),ventaId:x.ventaId?mask(x.ventaId):null,
    clienteVentaId:x.clienteVentaId?mask(x.clienteVentaId):null,
    motivo:fullIds?x.motivo:'[texto privado omitido]'}))};
}
module.exports={analyze,present};
if(require.main===module){
 const args=process.argv.slice(2),opt=n=>{const i=args.indexOf(n);return i<0?undefined:args[i+1];};
 const a=opt('--cuaderno'),b=opt('--hechos'),date=opt('--fecha');
 if(!a||!b||!/^\d{4}-\d{2}-\d{2}$/.test(date||'')){
   console.error('Uso: node scripts/forensics/fiados-readonly.cjs --cuaderno export.json --hechos hechos.json --fecha 2026-09-29 [--texto Cerveza] [--full-ids]');
   process.exitCode=2;
 }else{
   try{
     const report=analyze({notebook:JSON.parse(fs.readFileSync(a,'utf8')),
       ledger:JSON.parse(fs.readFileSync(b,'utf8')),date,term:opt('--texto')||''});
     console.log(JSON.stringify(present(report,{fullIds:args.includes('--full-ids')}),null,2));
     console.error('Solo lectura: SIN_VENTA_VINCULADA no autoriza inventar cliente. La ausencia de recibos NO implica que no existieron.');
   }catch(e){console.error('Auditoría suspendida: '+e.message);process.exitCode=1;}
 }
}
