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
 function quantity(v){const n=finite(v);return n!==null&&n>0?n:null;}
 function sum(values){let n=0;for(const v of values||[]){if(typeof v!=='number'||!Number.isFinite(v))return null;n+=v;if(!Number.isFinite(n)||Math.abs(n)>Number.MAX_SAFE_INTEGER)return null;}return n;}
 function daily(sales,date,zone){
  let count=0;const seen=new Set();
  for(const v of sales||[]){if(!v||v.anulada||v.borrado)continue;if(v.id&&seen.has(String(v.id)))continue;if(v.id)seen.add(String(v.id));
   if(day(v.fechaLocal||v.fecha,zone)===date)count++;
  }
  const r=businessResult({sales,period:{from:date,to:date},zone});
  return {entra:r.netCents===null?null:r.netCents/100,sale:r.costCents===null?null:r.costCents/100,gananciaHoy:r.netCents===null||r.costCents===null?null:(r.netCents-r.costCents)/100,ventasCount:count};
 }
 // Read-only period projection: returns belong to their recorded return day.
 // Missing reversal dates or costs make the result explicitly incomplete.
 function monthly(sales,expenses,month,zone){
  const out={salesCents:0,returnedCents:0,netCents:0,costCents:0,expensesCents:0,marginCents:0,marginLessExpensesCents:0,rows:[],expenses:[],undatedReturns:0,undatedExpenses:0,unassignedExpenses:[],invalid:0};
  const seen=new Set();
  for(const v of sales||[]){if(!v||v.borrado||v.anulada)continue;if(v.id&&seen.has(String(v.id)))continue;if(v.id)seen.add(String(v.id));
   const units=finite(v.cantidad),price=finite(v.precioUnit),cost=finite(v.costoUnit),original=day(v.fechaLocal||v.fecha,zone);
   const returnDay=v.devuelta?day(v.fechaDevolucion,zone):'';
   if(original&&original.slice(0,7)!==month&&(!v.devuelta||returnDay&&returnDay.slice(0,7)!==month))continue;
   if(units===null||units<=0||price===null||!original){out.invalid++;continue;}
   const amounts=saleAmounts(v),amount=amounts.revenueCents,c=amounts.costCents;
   if(!Number.isSafeInteger(amount)){out.invalid++;continue;}
   function add(date,sign){if(date.slice(0,7)!==month)return;out.rows.push({id:v.productoId||v.id||v.productoNombre,sourceId:v.id==null?null:String(v.id),product:v.productoNombre||v.nombre||'',units:sign*units,amountCents:sign*amount,returned:sign<0});if(sign>0)out.salesCents+=amount;else out.returnedCents+=amount;if(c===null||!Number.isSafeInteger(c))out.costCents=null;else if(out.costCents!==null)out.costCents+=sign*c;}
   add(original,1);
   if(v.devuelta){const returned=day(v.fechaDevolucion,zone);if(returned)add(returned,-1);else {out.undatedReturns++;out.costCents=null;}}
  }
  for(const g of expenses||[]){if(!g||g.borrado)continue;const expenseDay=day(g.fecha,zone);if(!expenseDay){out.undatedExpenses++;out.unassignedExpenses.push(g);out.expensesCents=null;continue;}if(expenseDay.slice(0,7)!==month)continue;out.expenses.push(g);const amount=finite(g.monto),c=amount===null?null:Math.round(amount*100);if(c===null||!Number.isSafeInteger(c))out.expensesCents=null;else if(out.expensesCents!==null)out.expensesCents+=c;}
  // Keep the legacy report's row layout; all monetary totals use the same core.
  const shared=businessResult({sales,expenses,month,zone});
  for(const field of ['salesCents','returnedCents','netCents','costCents','expensesCents'])out[field]=shared[field];
  const acceptedSales=new Set(shared.sourceIds.sales),acceptedExpenses=new Set(shared.sourceIds.expenses);
  out.rows=out.rows.filter(r=>r.sourceId===null||acceptedSales.has(r.sourceId));
  out.expenses=out.expenses.filter(g=>g.id==null||acceptedExpenses.has(String(g.id)));
  out.marginCents=out.netCents===null||out.costCents===null?null:out.netCents-out.costCents;
  out.inventoryExpenseUnclassified=out.expenses.some(g=>g.categoria==='inventory');
  out.marginLessExpensesCents=out.marginCents===null||out.expensesCents===null||out.inventoryExpenseUnclassified?null:out.marginCents-out.expensesCents;
  return out;
 }
 // A stored split is an economic allocation, never evidence of cash collected.
 // Counter is a selling flow: it does NOT erase a stored product commission.
 function cents(n){if(n===null||!Number.isFinite(n)||Math.abs(n)>=1e21)return null;const c=Math.round(Number(n.toFixed(10)+'e2'));return Number.isSafeInteger(c)?c:null;}
 // Recompute only from the sale's frozen policy, never today's tax settings.
 // undefined means invalid evidence: callers must reject, not replace it with null.
 function recalculateTax(impuesto,precioUnit,cantidad){
  if(impuesto==null)return null;
  const rate=finite(impuesto.tasa),price=finite(precioUnit),units=quantity(cantidad);
  if(typeof impuesto!=='object'||rate===null||price===null||units===null||!['incluido','agregado'].includes(impuesto.modo))return undefined;
  const base=cents(price*units);if(base===null)return undefined;
  const tax=impuesto.modo==='agregado'?Math.round(base*rate/100):base-Math.round(base/(1+rate/100));
  if(!Number.isSafeInteger(tax))return undefined;
  return {...impuesto,monto:tax/100};
 }
 function saleAmounts(v){
  const units=quantity(v&&v.cantidad),price=finite(v&&v.precioUnit),cost=finite(v&&v.costoUnit);
  const amountCents=units===null||price===null?null:cents(units*price);
  const costCents=units===null||cost===null?null:cents(units*cost);
  const tax=v&&v.impuesto;
  // Legacy records predate frozen tax. Explicit null also records a tax-free sale.
  const taxCents=tax==null?0:typeof tax==='object'&&['incluido','agregado'].includes(tax.modo)?cents(finite(tax.monto)):null;
  const validTax=taxCents!==null&&(tax==null||tax.modo==='agregado'||amountCents!==null&&taxCents<=amountCents);
  const includedTax=validTax?(tax&&tax.modo==='incluido'?taxCents:0):null;
  const revenueCents=sum([amountCents,includedTax===null?null:-includedTax]);
  const customerGrossCents=validTax?sum([amountCents,tax&&tax.modo==='agregado'?taxCents:0]):null;
  const split=v&&v.split;
  let artist=finite(v&&v.comisionAsociado),house=finite(v&&v.netoCasa);
  if(split){if(artist===null)artist=finite(split.montoComisionSocio);if(house===null)house=finite(split.montoNetoDueno);}
  const missingProductSplit=v&&v.noCommission!==true&&v.comisionistaIdProducto&&finite(v.pctAsociadoProducto)>0&&v.comisionPct==null&&!split;
  if(!missingProductSplit&&v&&v.noCommission===true&&!split){if(artist===null)artist=0;if(house===null)house=amountCents===null?null:amountCents/100;}
  if(!missingProductSplit&&v&&v.modoComision==='counter'&&artist===0&&house===null)house=amountCents===null?null:amountCents/100;
  let artistCents=cents(artist),grossHouseCents=cents(house);
  const splitConflict=amountCents!==null&&artistCents!==null&&grossHouseCents!==null&&sum([artistCents,grossHouseCents])!==amountCents;
  if(splitConflict||missingProductSplit){artistCents=null;grossHouseCents=null;}
  // The agreed commission remains frozen; included tax is remitted by the house.
  const houseCents=sum([grossHouseCents,includedTax===null?null:-includedTax]);
  return {units,amountCents,revenueCents,customerGrossCents,taxCents:validTax?taxCents:null,costCents,artistCents,houseCents,grossHouseCents,splitConflict};
 }
 function eventKey(v,zone){
  const id=v&&(v.eventoId||v.eventoOccurrenceId||v.ocurrenciaId);
  if(id)return 'id:'+String(id);
  const name=(String(v&&v.eventoNombre||'').trim()||(v&&v.tipoProducto==='ticket'?'__unnamed_ticket__':'')).toLowerCase(),date=day(v&&v.eventoFecha,zone);
  return name?(date?'dia:'+name+'|'+date:'sin-dia:'+name+'|'+String(v&&v.id)):null;
 }
 // Read-only result for ALL consumers. No payments are subtracted from earnings.
 // Every unknown component propagates; conflicting IDs are quarantined as a set.
 function businessResult(input){
  input=input||{};const zone=input.zone||'America/Guayaquil',scope=input.scope||{},coverage=input.coverage||{};
  const month=String(input.month||''),period=input.period||{};
  let from=month?month+'-01':String(period.from||''),to=month?month+'-'+new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5,7)),0)).getUTCDate():String(period.to||'');
  const invalidPeriod=!!(month&&!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)||!month&&(from&&!day(from,zone)||to&&!day(to,zone)||from&&to&&from>to));
  const scoped=!!(scope.eventOccurrenceId||scope.eventKey||scope.locationId);
  const inPeriod=date=>!!date&&(!from||date>=from)&&(!to||date<=to);
  const inScope=v=>scope.eventOccurrenceId?String(v.eventoId||v.eventoOccurrenceId||v.ocurrenciaId||'')===String(scope.eventOccurrenceId):scope.eventKey?eventKey(v,zone)===scope.eventKey:scope.locationId?String(v.ubicacionId||'')===String(scope.locationId):true;
  const saleRelevant=v=>{const d=day(v.fechaLocal||v.fecha,zone),r=v.devuelta?day(v.fechaDevolucion,zone):'';return !d||inPeriod(d)||v.devuelta&&(!r||inPeriod(r));};
  const expenseRelevant=g=>!day(g.fecha,zone)||inPeriod(day(g.fecha,zone));
  const out={salesCents:0,returnedCents:0,netCents:0,customerGrossCents:0,taxCents:0,costCents:0,artistShareCents:0,houseShareCents:0,
   expensesCents:0,directExpensesCents:0,generalExpensesCents:0,contributionCents:null,houseAfterExpensesCents:null,
   cashCents:null,houseAdjustmentsCents:0,sourceIds:{sales:[],expenses:[],adjustments:[]},warnings:[],coverage:{sales:coverage.sales!==false,expenses:coverage.expenses!==false,adjustments:coverage.adjustments!==false},
   period:{from,to,zone},inventoryExpenseUnclassified:false};
  const warnings=new Set();let saleConflict=false,expenseConflict=false,adjustmentConflict=false,unknownReturn=false;
  const stable=v=>v&&typeof v==='object'?Array.isArray(v)?'['+v.map(stable).join(',')+']':'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+stable(v[k])).join(',')+'}':JSON.stringify(v);
  function unique(records,kind,relevant){
   const groups=new Map(),result=[];
   for(const v of records||[]){if(!v)continue;if(v.id==null||v.id===''){result.push(v);continue;}const k=String(v.id),g=groups.get(k)||[];g.push(v);groups.set(k,g);}
   groups.forEach(g=>{if(g.some(v=>stable(v)!==stable(g[0]))){if(g.some(relevant)){warnings.add('conflicting-'+kind);if(kind==='sale')saleConflict=true;else if(kind==='expense')expenseConflict=true;else adjustmentConflict=true;}return;}result.push(g[0]);});return result;
  }
  const sales=unique(input.sales,'sale',v=>inScope(v)&&saleRelevant(v));
  for(const v of sales){
   if(v.borrado||v.anulada||!inScope(v)||!saleRelevant(v))continue;
   const original=day(v.fechaLocal||v.fecha,zone),returned=v.devuelta?day(v.fechaDevolucion,zone):'';
   const a=saleAmounts(v);if(v.id!=null)out.sourceIds.sales.push(String(v.id));
   if(v.comisionAjusteRetroIncluido&&returned&&inPeriod(original)!==inPeriod(returned)){
    out.houseShareCents=null;out.artistShareCents=null;warnings.add('retroactive-return-period-pending');
   }
   if((!original&&(from||to))||a.amountCents===null){warnings.add('invalid-sale');out.salesCents=null;out.returnedCents=null;out.netCents=null;out.customerGrossCents=null;out.taxCents=null;out.houseShareCents=null;out.artistShareCents=null;out.costCents=null;continue;}
   if(!original)warnings.add('undated-sale');
   if(a.splitConflict)warnings.add('conflicting-split');
   if(a.taxCents===null)warnings.add('invalid-tax');
   if(a.houseCents===null||a.artistCents===null)warnings.add('missing-split');
   if(a.costCents===null)warnings.add('missing-cost');
   const apply=sign=>{out.netCents=sum([out.netCents,a.revenueCents===null?null:sign*a.revenueCents]);out.customerGrossCents=sum([out.customerGrossCents,a.customerGrossCents===null?null:sign*a.customerGrossCents]);out.taxCents=sum([out.taxCents,a.taxCents===null?null:sign*a.taxCents]);out.costCents=sum([out.costCents,a.costCents===null?null:sign*a.costCents]);out.houseShareCents=sum([out.houseShareCents,a.houseCents===null?null:sign*a.houseCents]);out.artistShareCents=sum([out.artistShareCents,a.artistCents===null?null:sign*a.artistCents]);};
   if(inPeriod(original)||!from&&!to&&!original){out.salesCents=sum([out.salesCents,a.revenueCents]);apply(1);}
   if(v.devuelta){
    if(returned&&inPeriod(returned)||!from&&!to&&!returned){out.returnedCents=sum([out.returnedCents,a.revenueCents]);apply(-1);}
    else if(!returned){unknownReturn=true;warnings.add('undated-return');}
   }
  }
  const saleMap=new Map(sales.filter(v=>v.id!=null).map(v=>[String(v.id),v]));
  const signedCents=n=>{if((typeof n!=='number'&&!(typeof n==='string'&&n.trim()))||!Number.isFinite(Number(n))||Math.abs(Number(n))>=1e21)return null;const c=Math.round(Number(Number(n).toFixed(10)+'e2'));return Number.isSafeInteger(c)?c:null;};
  for(const a of unique(input.adjustments,'adjustment',expenseRelevant)){
   if(a.borrado||!expenseRelevant(a))continue;
   const sale=saleMap.get(String(a.ventaId||''));
   if(scoped&&(!sale||!inScope(sale)))continue;
   if(a.tipo==='recalculo-retroactivo'&&sale&&sale.comisionAjusteRetroIncluido)continue;
   const artist=signedCents(a.montoComisionSocio),house=signedCents(a.montoNetoDueno);
   if(a.tipo==='devolucion'&&sale&&sale.devuelta){const original=saleAmounts(sale);if(original.artistCents!==null&&original.grossHouseCents!==null&&artist===-original.artistCents&&house===-original.grossHouseCents&&day(a.fecha,zone)===day(sale.fechaDevolucion,zone))continue;}
   if(!day(a.fecha,zone)||artist===null||house===null||sum([artist,house])!==0||a.tipo==='devolucion'||a.tipo==='recalculo-retroactivo'){
    adjustmentConflict=true;warnings.add('unreconciled-commission-adjustment');continue;
   }
   out.houseShareCents=sum([out.houseShareCents,house]);out.artistShareCents=sum([out.artistShareCents,artist]);out.houseAdjustmentsCents=sum([out.houseAdjustmentsCents,house]);
   if(a.id!=null)out.sourceIds.adjustments.push(String(a.id));
  }
  if(adjustmentConflict){out.houseShareCents=null;out.artistShareCents=null;out.houseAdjustmentsCents=null;}
  if(!out.coverage.adjustments)warnings.add('missing-adjustments-coverage');
  const expenses=unique(input.expenses,'expense',expenseRelevant);
  for(const g of expenses){
   if(g.borrado||!expenseRelevant(g))continue;
   const eId=g.eventoId||g.eventOccurrenceId||g.ocurrenciaId;
   let direct=!!(eId||g.ubicacionId&&g.ubicacionId!=='todas');
   if(scope.eventOccurrenceId||scope.eventKey){
    if(eId){if('id:'+String(eId)!==(scope.eventOccurrenceId?'id:'+String(scope.eventOccurrenceId):scope.eventKey))continue;direct=true;}
    else direct=false;
   }else if(scope.locationId){if(g.ubicacionId&&g.ubicacionId!=='todas'&&String(g.ubicacionId)!==String(scope.locationId))continue;direct=String(g.ubicacionId||'')===String(scope.locationId);}
   const n=finite(g.monto),amount=n===null?null:Math.round(Number(n.toFixed(10)+'e2'));
   const c=amount!==null&&Number.isSafeInteger(amount)&&day(g.fecha,zone)?amount:null;
   if(c===null)warnings.add('invalid-expense');
   if(g.id!=null)out.sourceIds.expenses.push(String(g.id));
   out.expensesCents=sum([out.expensesCents,c]);
   const field=direct?'directExpensesCents':'generalExpensesCents';out[field]=sum([out[field],c]);
   if(g.categoria==='inventory'){out.inventoryExpenseUnclassified=true;warnings.add('unclassified-inventory-expense');}
  }
  if(saleConflict||unknownReturn||invalidPeriod||!out.coverage.sales){for(const k of ['salesCents','returnedCents','netCents','customerGrossCents','taxCents','costCents','artistShareCents','houseShareCents'])out[k]=null;}
  if(expenseConflict||invalidPeriod||!out.coverage.expenses){for(const k of ['expensesCents','directExpensesCents','generalExpensesCents'])out[k]=null;}
  if(!out.coverage.sales)warnings.add('missing-sales-coverage');if(!out.coverage.expenses)warnings.add('missing-expenses-coverage');if(invalidPeriod)warnings.add('invalid-period');
  out.contributionCents=out.inventoryExpenseUnclassified?null:sum([out.houseShareCents,out.costCents===null?null:-out.costCents,out.directExpensesCents===null?null:-out.directExpensesCents]);
  out.houseAfterExpensesCents=out.inventoryExpenseUnclassified||scoped&&out.generalExpensesCents!==0?null:sum([out.houseShareCents,out.costCents===null?null:-out.costCents,out.expensesCents===null?null:-out.expensesCents]);
  if(!out.coverage.adjustments){out.contributionCents=null;out.houseAfterExpensesCents=null;}
  if(coverage.coherent===false){out.contributionCents=null;out.houseAfterExpensesCents=null;warnings.add('unverified-financial-cut');}
  out.sourceIds.sales.sort();out.sourceIds.expenses.sort();out.sourceIds.adjustments.sort();out.warnings=[...warnings].sort();return out;
 }
 return {stock,inventory,expiry,day,number:finite,quantity,sum,daily,margin,monthly,saleAmounts,recalculateTax,eventKey,businessResult};
});
