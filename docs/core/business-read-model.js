/* Shared read-only inventory projection. An absent quantity/cost is not zero.
   No storage, network, UI or clock; callers provide complete records. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;if(root)root.OCBusinessReadModel=api;})(globalThis,function(){
 'use strict';
 function finite(v){return (typeof v==='number'||typeof v==='string'&&v.trim()!=='')&&Number.isFinite(Number(v))&&Number(v)>=0&&Number(v)<=Number.MAX_SAFE_INTEGER?Number(v):null;}
 function stock(p){const units=finite(p&&p.stockActual);return {known:units!==null,units};}
 function inventory(products){let units=0,valueCents=0,unknownStock=0,unknownCost=0;
  for(const p of products||[]){const s=stock(p),cost=finite(p&&p.costo);if(!s.known){unknownStock++;continue;}units+=s.units;
   if(cost===null){unknownCost++;continue;}const c=Math.round(cost*s.units*100);if(!Number.isSafeInteger(c)){unknownCost++;continue;}valueCents+=c;
  }
  return {units:unknownStock||!Number.isFinite(units)||units>Number.MAX_SAFE_INTEGER?null:units,valueCents:unknownStock||unknownCost||!Number.isSafeInteger(valueCents)?null:valueCents,unknownStock,unknownCost};
 }
 function expiry(p){if(!p||!p.perecible)return null;const date=String(p.fechaCaducidad||''),m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(date);if(!m)return null;
  const d=new Date(Date.UTC(Number(m[1]),Number(m[2])-1,Number(m[3])));return d.getUTCFullYear()===Number(m[1])&&d.getUTCMonth()===Number(m[2])-1&&d.getUTCDate()===Number(m[3])?date:null;
 }
 function day(value,zone){
  if(/^\d{4}-\d{2}-\d{2}$/.test(String(value||'')))return expiry({perecible:true,fechaCaducidad:value})||'';
  const ms=Date.parse(value);if(!Number.isFinite(ms))return '';
  try{const parts=new Intl.DateTimeFormat('en-CA',{timeZone:zone||'America/Guayaquil',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(ms));const get=k=>parts.find(p=>p.type===k).value;return get('year')+'-'+get('month')+'-'+get('day');}catch(_){return '';}
 }
 function margin(p){const price=finite(p&&p.precio),cost=finite(p&&p.costo);return price===null||cost===null?null:Math.round((price-cost)*100)/100;}
 // Read-only period projection: returns belong to their recorded return day.
 // Missing reversal dates or costs make the result explicitly incomplete.
 function monthly(sales,expenses,month,zone){
  const out={salesCents:0,returnedCents:0,netCents:0,costCents:0,expensesCents:0,marginCents:0,marginLessExpensesCents:0,rows:[],expenses:[],undatedReturns:0,invalid:0};
  const seen=new Set();
  for(const v of sales||[]){if(!v||v.borrado||v.anulada)continue;if(v.id&&seen.has(String(v.id)))continue;if(v.id)seen.add(String(v.id));
   const units=finite(v.cantidad),price=finite(v.precioUnit),cost=finite(v.costoUnit),original=day(v.fechaLocal||v.fecha,zone);
   if(units===null||units<=0||price===null||!original){out.invalid++;continue;}
   const amount=Math.round(units*price*100),c=cost===null?null:Math.round(units*cost*100);
   if(!Number.isSafeInteger(amount)){out.invalid++;continue;}
   function add(date,sign){if(date.slice(0,7)!==month)return;out.rows.push({id:v.productoId||v.id||v.productoNombre,product:v.productoNombre||v.nombre||'',units:sign*units,amountCents:sign*amount,returned:sign<0});if(sign>0)out.salesCents+=amount;else out.returnedCents+=amount;if(c===null||!Number.isSafeInteger(c))out.costCents=null;else if(out.costCents!==null)out.costCents+=sign*c;}
   add(original,1);
   if(v.devuelta){const returned=day(v.fechaDevolucion,zone);if(returned)add(returned,-1);else {out.undatedReturns++;out.costCents=null;}}
  }
  for(const g of expenses||[]){if(!g||g.borrado||day(g.fecha,zone).slice(0,7)!==month)continue;out.expenses.push(g);const amount=finite(g.monto),c=amount===null?null:Math.round(amount*100);if(c===null||!Number.isSafeInteger(c))out.expensesCents=null;else if(out.expensesCents!==null)out.expensesCents+=c;}
  out.netCents=out.undatedReturns||out.invalid||!Number.isSafeInteger(out.salesCents-out.returnedCents)?null:out.salesCents-out.returnedCents;
  if(out.costCents!==null&&!Number.isSafeInteger(out.costCents))out.costCents=null;
  if(out.expensesCents!==null&&!Number.isSafeInteger(out.expensesCents))out.expensesCents=null;
  out.marginCents=out.netCents===null||out.costCents===null?null:out.netCents-out.costCents;
  out.inventoryExpenseUnclassified=out.expenses.some(g=>g.categoria==='inventory');
  out.marginLessExpensesCents=out.marginCents===null||out.expensesCents===null||out.inventoryExpenseUnclassified?null:out.marginCents-out.expensesCents;
  return out;
 }
 return {stock,inventory,expiry,day,number:finite,margin,monthly};
});
