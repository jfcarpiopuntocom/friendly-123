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
  return {units:unknownStock?null:units,valueCents:unknownStock||unknownCost||!Number.isSafeInteger(valueCents)?null:valueCents,unknownStock,unknownCost};
 }
 function expiry(p){if(!p||!p.perecible)return null;const date=String(p.fechaCaducidad||''),m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(date);if(!m)return null;
  const d=new Date(Date.UTC(Number(m[1]),Number(m[2])-1,Number(m[3])));return d.getUTCFullYear()===Number(m[1])&&d.getUTCMonth()===Number(m[2])-1&&d.getUTCDate()===Number(m[3])?date:null;
 }
 return {stock,inventory,expiry};
});
