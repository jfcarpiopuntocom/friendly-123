'use strict';
// JFC MDD-2026-10-31: read-only #1 + #5 ledger comparator (shadow only).
// NEVER imports customer files, mutates a business, sends network requests or
// makes inventory "equal" by choosing a number. Input is supplied explicitly.
const {createHash}=require('node:crypto');
const {Journal}=require('./engine.cjs');
function stable(v){
 if(Array.isArray(v))return '['+v.map(stable).join(',')+']';
 if(v&&typeof v==='object')return '{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+stable(v[k])).join(',')+'}';
 return JSON.stringify(v);
}
function hash(s){return createHash('sha256').update(String(s)).digest('hex')}
function compareReplicas({notebook,replicas}){
 if(typeof notebook!=='string'||!notebook||!Array.isArray(replicas)||replicas.length<2||replicas.length>12)
  throw Error('two to twelve independent replicas and one notebook required');
 const seenDevices=new Set(),sources=[],index=new Map(),products=new Set();
 for(const replica of replicas){
  if(!replica||replica.notebook!==notebook||typeof replica.device!=='string'||
    !replica.device||seenDevices.has(replica.device)||!Array.isArray(replica.events))
   throw Error('duplicate device, invalid export, or cross-notebook evidence');
  if(replica.events.length>10000)throw Error('bounded forensic batch required');
  seenDevices.add(replica.device);
  const own=new Journal(notebook),seen=new Set(),witness=[];
  for(const e of replica.events){
   // The shadow journal rejects unexpected fields (PIN, customer name, photos)
   // as well as cross-notebook movement attempts. Fail closed, never log them.
   const local=own.append(e);
   if(!local.ok)throw Error('replica contains disputed event/sequence');
   seen.add(e.id);witness.push(stable(e));
   products.add(e.product);
   const previous=index.get(e.id),digest=hash(stable(e));
   if(previous&&previous.digest!==digest)previous.conflict=true;
   else if(!previous)index.set(e.id,{event:e,digest,conflict:false});
  }
  sources.push({deviceDigest:hash(replica.device).slice(0,20),seen,
   evidenceDigest:hash(witness.sort().join('\n')),count:seen.size});
 }
 const union=new Journal(notebook),disputed=[];
 for(const [id,item] of index){
  if(item.conflict){disputed.push(hash(id).slice(0,20));continue}
  const result=union.append(item.event);
  if(!result.ok)disputed.push(hash(id).slice(0,20));
 }
 const ids=[...index.keys()].sort();
 const views=sources.map(source=>{
  const missing=ids.filter(id=>!source.seen.has(id)).map(id=>hash(id).slice(0,20));
  return {deviceDigest:source.deviceDigest,eventCount:source.count,
   evidenceDigest:source.evidenceDigest,missingCount:missing.length,missingEventDigests:missing};
 });
 const physical=[...products].sort().map(p=>{
  const projection=union.project(p);
  return {productDigest:hash(p).slice(0,20),trust:projection.trust,
   issueCodes:projection.issues,physicalKnown:projection.onHand!==null,
   physicalStock:projection.onHand};
 });
 // Even agreeing read models cannot prove the historical epoch if any physical
 // causal conflict remains. Read-only diagnostics never authorize auto migration.
 const allReplicasHaveSameFacts=views.every(v=>v.missingCount===0);
 const allProductsTrustworthy=physical.every(p=>p.trust!=='needs-reconciliation');
 return {schema:'f123-jfc-forensic-shadow-v1',notebookDigest:hash(notebook).slice(0,20),
  devices:views.length,uniqueEventCount:ids.length,views,physical,
  conflictingEventDigests:disputed.sort(),
  allReplicasHaveSameFacts,allProductsTrustworthy,
  comparable:disputed.length===0&&allReplicasHaveSameFacts&&allProductsTrustworthy,
  canAutoMigrate:false,canAlterProduction:false,
  action:'Preserve all original independent backups. Reconcile by verified event identity and causal count provenance; never select stock by display value or wall clock.'};
}
module.exports={compareReplicas};
