// C93 — pure CURRENT-device observation union. NO history importer, server writes,
// browser storage operations, network, Firebase dependency or client-side cutover.
// Caller MUST authenticate and durably commit a separately verified current-state
// baseline before enabling 2.0. 'readyForAuthenticatedSeal' is never an ACK.
import {Sha256Sync} from './sha256-sync.mjs';

const HASH=/^[0-9a-f]{64}$/,OP_ID=/^[A-Za-z0-9_.:-]{1,160}$/;
const DOMAINS=new Set(['stock','cash','photos','dashboard','catalog','sales','commissions','access']);
const SECRET=new Set(['pin','ownerpin','teampin','token','authorization','bearer','password',
 'secret','credential','credentials','recoverycode','licensecode','apikey','api_key']);
const MAX_SOURCES=24,MAX_FACTS=20000,MAX_VIEWS=10000,MAX_FACT_BYTES=256*1024;
const MAX_BYTES=16*1024*1024,MAX_DEPTH=20;
const encoder=new TextEncoder();
function refuse(reason){throw new TypeError('invalid current-state observation: '+reason);}
function sha(s){const h=new Sha256Sync();h.update(s);return h.hex();}
function object(value){
 return value!==null&&typeof value==='object'&&!Array.isArray(value)&&
  (Object.getPrototypeOf(value)===Object.prototype||Object.getPrototypeOf(value)===null);
}
function exact(value,keys,label){
 if(!object(value))refuse(label+' object required');
 for(const k of Object.keys(value))if(!keys.includes(k))refuse(label+' unexpected field');
 for(const k of Object.keys(value)){
  const desc=Object.getOwnPropertyDescriptor(value,k);
  if(!desc||!Object.hasOwn(desc,'value'))refuse(label+' accessor rejected');
 }
}
function canonical(value,depth=0,key=''){
 if(depth>MAX_DEPTH)refuse('payload nesting');
 if(value===null||typeof value==='string'||typeof value==='boolean')return JSON.stringify(value);
 if(typeof value==='number'){
  if(!Number.isFinite(value)||Math.abs(value)>Number.MAX_SAFE_INTEGER)refuse('unsafe number');
  if(/(?:Cents|Centavos)$/.test(key)&&!Number.isSafeInteger(value))
   refuse('integer cent amount required');
  return Object.is(value,-0)?'0':JSON.stringify(value);
 }
 if(Array.isArray(value))return '['+value.map(v=>{
  if(v===undefined)refuse('undefined array element');
  return canonical(v,depth+1);
 }).join(',')+']';
 if(!object(value))refuse('unsupported payload');
 // Inspect descriptors BEFORE reading any untrusted values. A getter can mutate
 // client state, so never execute one just to decide whether a field is absent.
 const entries=[];
 for(const k of Object.keys(value)){
  const desc=Object.getOwnPropertyDescriptor(value,k);
  if(!desc||!Object.hasOwn(desc,'value'))refuse('payload accessor rejected');
  if(SECRET.has(k.toLowerCase()))refuse('forbidden credential in payload');
  if(k==='__proto__'||k==='constructor'||k==='prototype')refuse('unsafe field');
  if(desc.value!==undefined)entries.push([k,desc.value]);
 }
 entries.sort(([a],[b])=>compare(a,b));
 return '{'+entries.map(([k,v])=>
  JSON.stringify(k)+':'+canonical(v,depth+1,k)).join(',')+'}';
}
function deepFreeze(value){
 if(value&&typeof value==='object'){
  for(const item of Object.values(value))deepFreeze(item);
  Object.freeze(value);
 }
 return value;
}
function compare(a,b){return a<b?-1:a>b?1:0;}
function sortedSources(values){return [...values].sort(compare);}
function materializeVariations(map,includePayload=false){
 return [...map.values()].sort((a,b)=>compare(a.canonical||a.valueHash,b.canonical||b.valueHash))
  .map(v=>includePayload
   ?{payloadHash:v.payloadHash,payload:JSON.parse(v.canonical),observedBy:sortedSources(v.sources)}
   :{valueHash:v.valueHash,observedBy:sortedSources(v.sources)});
}
/**
 * Observe the present, never reconstruct history.
 * An observation is already extracted READ-ONLY by a trusted caller; this function
 * does not access indexedDB, rooms, photos or any live browser state.
 *
 * A returned candidate is an audit plan only. Authentication, full current-state
 * coverage, durable server transaction and receipt verification are separate gates.
 */
export function planForwardCurrentUnion({observations}={}){
 if(!Array.isArray(observations)||!observations.length||observations.length>MAX_SOURCES)
  refuse('source count');
 const sourceIds=new Set(),facts=new Map(),views=new Map();
 const sourceSummaries=[];
 let businessScope=null,totalBytes=0,totalFacts=0,totalViews=0;
 for(const source of observations){
  exact(source,['application','businessScope','sourceId','facts','views','observedAt'],'source');
  if(source.application!=='friendly-123')refuse('application is not friendly-123');
  if(!HASH.test(source.businessScope||''))refuse('business scope');
  if(businessScope===null)businessScope=source.businessScope;
  if(businessScope!==source.businessScope)refuse('mixed business scope');
  if(!HASH.test(source.sourceId||''))refuse('source hash');
  if(sourceIds.has(source.sourceId))refuse('duplicate source');
  sourceIds.add(source.sourceId);
  if(source.observedAt!==undefined&&
   (!Number.isSafeInteger(source.observedAt)||source.observedAt<0))refuse('observation timestamp');
  if(!Array.isArray(source.facts)||!Array.isArray(source.views))refuse('source arrays');
  if(source.facts.length>MAX_FACTS||source.views.length>MAX_VIEWS)refuse('source budget');
  totalFacts+=source.facts.length;totalViews+=source.views.length;
  if(totalFacts>MAX_FACTS||totalViews>MAX_VIEWS)refuse('total budget');
  const sourceFacts=[],sourceViews=[];
  for(const row of source.facts){
   exact(row,['opId','payload'],'fact');
   if(typeof row.opId!=='string'||!OP_ID.test(row.opId))refuse('opId');
   if(!object(row.payload))refuse('fact payload must be object');
   const text=canonical(row.payload);
   const used=encoder.encode(text).byteLength+row.opId.length;
   if(used>MAX_FACT_BYTES)refuse('fact size');
   totalBytes+=used;if(totalBytes>MAX_BYTES)refuse('total wire budget');
   const payloadHash=sha('f123-current-fact-v1\0'+text);
   sourceFacts.push({opId:row.opId,payloadHash});
   let family=facts.get(row.opId);
   if(!family){family=new Map();facts.set(row.opId,family);}
   let variant=family.get(payloadHash);
   if(!variant){variant={payloadHash,canonical:text,sources:new Set()};family.set(payloadHash,variant);}
   if(variant.canonical!==text)refuse('payload hash collision');
   variant.sources.add(source.sourceId);
  }
  for(const row of source.views){
   exact(row,['domain','keyHash','valueHash'],'view witness');
   if(!DOMAINS.has(row.domain)||!HASH.test(row.keyHash||'')||
      !HASH.test(row.valueHash||''))refuse('view witness');
   const pair=row.domain+':'+row.keyHash;
   sourceViews.push({domain:row.domain,keyHash:row.keyHash,valueHash:row.valueHash});
   let family=views.get(pair);
   if(!family){family={domain:row.domain,keyHash:row.keyHash,versions:new Map()};views.set(pair,family);}
   let variant=family.versions.get(row.valueHash);
   if(!variant){variant={valueHash:row.valueHash,sources:new Set()};family.versions.set(row.valueHash,variant);}
   variant.sources.add(source.sourceId);
  }
  sourceFacts.sort((a,b)=>compare(a.opId+':'+a.payloadHash,b.opId+':'+b.payloadHash));
  sourceViews.sort((a,b)=>compare(a.domain+':'+a.keyHash+':'+a.valueHash,
                                   b.domain+':'+b.keyHash+':'+b.valueHash));
  sourceSummaries.push({
   sourceId:source.sourceId,factsObserved:source.facts.length,viewsObserved:source.views.length,
   observationHash:sha(canonical({facts:sourceFacts,views:sourceViews}))
  });
 }
 sourceSummaries.sort((a,b)=>compare(a.sourceId,b.sourceId));
 const accepted=[],quarantined=[];
 for(const [opId,family] of [...facts].sort(([a],[b])=>compare(a,b))){
  if(family.size===1){
   const v=[...family.values()][0];
   accepted.push({opId,...materializeVariations(new Map([[v.payloadHash,v]]),true)[0]});
  }else{
   quarantined.push({opId,variants:materializeVariations(family,true)});
  }
 }
 const viewDifferences=[];
 for(const [,family] of [...views].sort(([a],[b])=>compare(a,b))){
  if(family.versions.size>1){
   viewDifferences.push({
    domain:family.domain,keyHash:family.keyHash,
    variants:materializeVariations(family.versions)
   });
  }
 }
 const readyForAuthenticatedSeal=sourceSummaries.length>=2&&accepted.length>0&&
  quarantined.length===0&&viewDifferences.length===0;
 // Manifest is a local hash input, NEVER a server-authenticated receipt.
 // Source hashes and payload hashes only: no PIN, private content or photos.
 const manifestCanonical=canonical({
  protocol:'f123-present-v1',businessScope,
  observations:sourceSummaries,
  facts:accepted.map(x=>({opId:x.opId,payloadHash:x.payloadHash,observedBy:x.observedBy})),
  conflicts:quarantined.map(x=>({opId:x.opId,
   variants:x.variants.map(v=>({payloadHash:v.payloadHash,observedBy:v.observedBy}))})),
  viewDifferences,readyForAuthenticatedSeal
 });
 return deepFreeze({
  sealed:false,readyForAuthenticatedSeal,sourceCount:sourceSummaries.length,
  businessScope,observations:sourceSummaries,
  facts:accepted,quarantined,viewDifferences,
  digest:sha(manifestCanonical),manifestCanonical
 });
}


/**
 * C96: Recheck a C93 candidate at the immutable archive boundary.
 * The SHA of manifestCanonical alone does NOT bind the payload values later
 * serialized by C95. This reuses the one canonicalizer/hasher used to create
 * those commitments. It is not an authorization or server-issued receipt.
 */
export function verifyForwardCurrentUnionPlan(plan) {
 exact(plan, ['sealed', 'readyForAuthenticatedSeal', 'sourceCount',
   'businessScope', 'observations', 'facts', 'quarantined',
   'viewDifferences', 'digest', 'manifestCanonical'], 'union plan');
 if (!HASH.test(plan.businessScope || '') ||
     !Array.isArray(plan.observations) ||
     !Array.isArray(plan.facts) ||
     !Array.isArray(plan.quarantined) ||
     !Array.isArray(plan.viewDifferences) ||
     plan.sourceCount !== plan.observations.length ||
     plan.observations.length > MAX_SOURCES || plan.facts.length > MAX_FACTS) {
   refuse('union manifest structure');
 }
 const sources = new Set();
 for (const row of plan.observations) {
   exact(row, ['sourceId', 'factsObserved', 'viewsObserved', 'observationHash'], 'union source');
   if (!HASH.test(row.sourceId || '') || !HASH.test(row.observationHash || '') ||
       sources.has(row.sourceId) || !Number.isSafeInteger(row.factsObserved) ||
       row.factsObserved < 0 || !Number.isSafeInteger(row.viewsObserved) ||
       row.viewsObserved < 0) refuse('union source witness');
   sources.add(row.sourceId);
 }
 const opIds = new Set();
 const committedFacts = plan.facts.map(fact => {
   exact(fact, ['opId', 'payloadHash', 'payload', 'observedBy'], 'union fact');
   if (typeof fact.opId !== 'string' || !OP_ID.test(fact.opId) ||
       opIds.has(fact.opId) || !HASH.test(fact.payloadHash || '') ||
       !object(fact.payload) || !Array.isArray(fact.observedBy) ||
       fact.observedBy.length < 1) refuse('accepted union fact structure');
   opIds.add(fact.opId);
   const observed = new Set();
   for (const source of fact.observedBy) {
     if (!sources.has(source) || observed.has(source)) refuse('union fact source provenance');
     observed.add(source);
   }
   const payloadCanonical = canonical(fact.payload);
   if (sha('f123-current-fact-v1\0' + payloadCanonical) !== fact.payloadHash) {
     refuse('accepted union fact payload SHA mismatch');
   }
   return { opId: fact.opId, payloadHash: fact.payloadHash, observedBy: fact.observedBy };
 });
 const actualManifest = canonical({
   protocol: 'f123-present-v1', businessScope: plan.businessScope,
   observations: plan.observations,
   facts: committedFacts,
   conflicts: plan.quarantined.map(x => ({ opId: x.opId,
     variants: x.variants.map(v => ({ payloadHash: v.payloadHash, observedBy: v.observedBy })) })),
   viewDifferences: plan.viewDifferences,
   readyForAuthenticatedSeal: plan.readyForAuthenticatedSeal
 });
 if (actualManifest !== plan.manifestCanonical || sha(actualManifest) !== plan.digest) {
   refuse('accepted union facts do not match original canonical manifest');
 }
 return true;
}
