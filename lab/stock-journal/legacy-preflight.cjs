'use strict';
/*
 * SAFE migration preflight for old mutable stock PN snapshots.
 * Audit-only. No storage, no writes, no event creation, no automatic approval.
 * A numeric stockBase is NOT an identified epoch or a durable history.
 */
function auditLegacy({notebook,snapshots}) {
 if (typeof notebook!=='string' || !notebook) throw Error('notebook required');
 if (!Array.isArray(snapshots) || !snapshots.length) throw Error('separate device snapshots required');
 const sources=new Set(),products=new Map(),errors=[];
 function add(id,device,kind,base,actual,pn) {
   if (typeof id!=='string'||!id) {errors.push('missing product ID');return;}
   if (!products.has(id)) products.set(id,[]);
   products.get(id).push({device,kind,base,actual,pn});
 }
 for(const snap of snapshots){
   if (!snap || snap.notebook!==notebook) throw Error('cross-notebook legacy snapshot refused');
   if(typeof snap.device!=='string'||!snap.device||sources.has(snap.device))throw Error('duplicate device identity');
   sources.add(snap.device);
   if(!Array.isArray(snap.productos))throw Error('productos array required');
   for(const p of snap.productos){
     if (!p || typeof p!=='object') {errors.push('malformed product');continue;}
     const base=p.stockBase==null?null:Number(p.stockBase);
     const actual=p.stockActual==null?null:Number(p.stockActual);
     const pn=p.stockPN||{};
     if ((base!==null&&!Number.isSafeInteger(base))||
         (actual!==null&&!Number.isSafeInteger(actual))||
         typeof pn!=='object'||Array.isArray(pn)){
       errors.push('invalid stock facts in product '+String(p.id));continue;
     }
     const counters={};
     for(const [device,x] of Object.entries(pn)){
       if(!x || !Number.isSafeInteger(x.add)||x.add<0||
         !Number.isSafeInteger(x.sub)||x.sub<0) {
           errors.push('invalid PN in product '+String(p.id));continue;
       }
       counters[device]={add:x.add,sub:x.sub};
     }
     add(p.id,snap.device,'active',base,actual,counters);
     // Preserve references to already-known alternative baselines, not their
     // current display values and never interpret them as a shared epoch.
     if(p.stockEvidencias&&typeof p.stockEvidencias==='object'){
       for(const q of Object.values(p.stockEvidencias)){
         if(!q || !Number.isSafeInteger(q.base))continue;
         add(p.id,snap.device,'historical-evidence',q.base,null,q.pn||{});
       }
     }
   }
 }
 const reports=[];
 for(const [id,entries] of products){
   const active=entries.filter(e=>e.kind==='active');
   const baseValues=[...new Set(entries.map(e=>e.base).filter(x=>x!==null))].sort((a,b)=>a-b);
   const displayed=[...new Set(active.map(e=>e.actual).filter(x=>x!==null))].sort((a,b)=>a-b);
   const issues=['unverifiable-legacy-epoch'];
   if(baseValues.length>1) issues.push('divergent-baselines');
   if(displayed.length>1) issues.push('divergent-displayed-stock');
   if(active.length!==snapshots.length)issues.push('missing-peer-product');
   const counters=active.map(x=>JSON.stringify(Object.entries(x.pn).sort(([a],[b])=>a.localeCompare(b))));
   if(new Set(counters).size>1)issues.push('inconsistent-pn-view');
   reports.push({productId:id,deviceViews:active.map(x=>x.device).sort(),
      candidateBaselines:baseValues,displaysObserved:displayed,
      issues:issues.sort(),canAutoMigrate:false});
 }
 reports.sort((a,b)=>a.productId.localeCompare(b.productId));
 return {
  schema:'legacy-stock-preflight-v1',notebookDevices:[...sources].sort(),
  canAutoMigrate:false,allProductsReconciled:false,
  // NEVER mark safe solely because two numbers happen to agree.
  products:reports,malformed:errors.sort(),
  next:'Preserve both original backups; verify physical count and immutable sale/adjustment IDs before any epoch opening. Do not change real notebooks.'
 };
}
module.exports={auditLegacy};
