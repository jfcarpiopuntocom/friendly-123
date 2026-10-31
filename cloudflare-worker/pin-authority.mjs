// License-only Owner PIN authority. Phase 1 discovers existing device claims.
// Phase 2 requires two explicit JFC actions. Never stores notebook/business data.
const enc=new TextEncoder();
const LICENSE=/^F123-[A-Z0-9*~$=-]{8,34}$/;
const PIN=/^\d{3}$/;
const RESERVED=new Set(["456","789"]);
const WINDOW=15*60*1000,MAX=10,REPORT_INTERVAL=86400000,PROPOSAL_TTL=15*60*1000;
function cleanLicense(v){const s=String(v||"").trim().toUpperCase();if(!LICENSE.test(s))throw Error("invalid license");return s}
function cleanPin(v){if(typeof v!=="string"||!PIN.test(v)||RESERVED.has(v))throw Error("invalid PIN");return v}
function rev(v){if(!Number.isSafeInteger(v)||v<0)throw Error("revision required");return v}
function equal(a,b){if(typeof a!=="string"||typeof b!=="string"||a.length!==64||b.length!==64)return false;let d=0;for(let i=0;i<64;i++)d|=a.charCodeAt(i)^b.charCodeAt(i);return d===0}
async function mac(secret,license,pin){if(typeof secret!=="string"||secret.length<32)throw Error("PIN_PEPPER missing");const key=await crypto.subtle.importKey("raw",enc.encode("f123-pin-owner-v1:"+secret),{name:"HMAC",hash:"SHA-256"},false,["sign"]);const digest=await crypto.subtle.sign("HMAC",key,enc.encode(license+"\n"+pin));return Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,"0")).join("")}
function pub(r,p,observations){
 const entries=Object.entries(observations?.devices||{}).sort((a,b)=>(a[1].at||0)-(b[1].at||0));
 const groups=new Map();
 const devices=entries.map(([id,value])=>{
  if(!groups.has(value.fingerprint))groups.set(value.fingerprint,String.fromCharCode(65+groups.size));
  return {deviceSuffix:id.slice(-8),pinGroup:groups.get(value.fingerprint),reportedAt:value.at,verified:false};
 });
 return {
  configured:!!r,phase:r?"enforced":"collecting",revision:r?.revision??0,
  changedAt:r?.changedAt??null,changedBy:r?.changedBy??null,
  pendingRevision:p?.revision??null,pendingAt:p?.createdAt??null,
  observedDevices:entries.length,conflictingReports:groups.size>1,deviceReports:devices,
  // Only anonymous group labels and ID suffixes are returned to master admin.
  // Report provenance is client-asserted, never cryptographic proof of ownership.
  reportsVerified:false
 };
}
export function pinAuthority(storage,secret,clock=Date.now){
 if(!storage||typeof storage.transaction!=="function")throw Error("transactional storage required");
 const key=l=>"pin-owner:"+l,limit=l=>"pin-owner-attempts:"+l,report=l=>"pin-owner-observed:"+l,proposal=l=>"pin-owner-proposal:"+l;
 async function status(license){const l=cleanLicense(license);return pub(await storage.get(key(l)),await storage.get(proposal(l)),await storage.get(report(l)))}
 async function reportExisting(license,instanceId,pin){
  const l=cleanLicense(license),p=cleanPin(pin);
  if(!/^[A-Za-z0-9_-]{6,120}$/.test(String(instanceId||"")))throw Error("invalid device");
  const fingerprint=await mac(secret,l,p);
  return storage.transaction(async tx=>{
   const now=clock(),obs=await tx.get(report(l))||{devices:{}};
   const prior=obs.devices[instanceId];
   // One bounded metadata write per device per day; no periodic uploads.
   if(prior&&equal(prior.fingerprint,fingerprint)&&now-prior.at<REPORT_INTERVAL)
     return {ok:true,observed:true,unchanged:true};
   if(!prior&&Object.keys(obs.devices).length>=60)return {ok:false,reason:"device-report-limit"};
   obs.devices[instanceId]={fingerprint,at:now,firstAt:prior?.firstAt||now,source:"client-reported"};
   await tx.put(report(l),obs);
   return {ok:true,observed:true,unchanged:false};
  });
 }
 async function masterSet(license,pin,expectedRevision){
  const l=cleanLicense(license),p=cleanPin(pin),expected=rev(expectedRevision),fingerprint=await mac(secret,l,p);
  return storage.transaction(async tx=>{
   const prior=await tx.get(key(l)),current=prior?.revision??0,observed=await tx.get(report(l));
   if(current!==expected)return {ok:false,reason:"revision-conflict",...pub(prior,await tx.get(proposal(l)),observed)};
   if(!observed||!Object.keys(observed.devices||{}).length)return {ok:false,reason:"enrollment-required",...pub(prior,null,observed)};
   if(prior&&equal(prior.fingerprint,fingerprint)){
    // Explicitly returning to the current PIN cancels any stale proposal.
    await tx.delete(proposal(l));
    return {ok:true,unchanged:true,...pub(prior,null,observed)};
   }
   // A stage is NEVER an effective Owner PIN. It only creates an admin proposal.
   const staged={revision:current+1,fingerprint,createdAt:clock(),by:"JFC-panel"};
   await tx.put(proposal(l),staged);
   return {ok:true,staged:true,...pub(prior,staged,observed)};
  });
 }
 async function masterActivate(license,pin,expectedRevision){
  const l=cleanLicense(license),p=cleanPin(pin),expected=rev(expectedRevision),fingerprint=await mac(secret,l,p);
  return storage.transaction(async tx=>{
   const prior=await tx.get(key(l)),current=prior?.revision??0;
   const staged=await tx.get(proposal(l)),observed=await tx.get(report(l));
   if(current!==expected)return {ok:false,reason:"revision-conflict",...pub(prior,staged,observed)};
   if(staged&&(clock()-staged.createdAt>PROPOSAL_TTL||clock()<staged.createdAt)){
    await tx.delete(proposal(l));
    return {ok:false,reason:"expired-proposal",...pub(prior,null,observed)};
   }
   if(!staged||staged.revision!==current+1||!equal(staged.fingerprint,fingerprint))
     return {ok:false,reason:"proposal-mismatch",...pub(prior,staged,observed)};
   const next={v:1,revision:staged.revision,fingerprint,changedAt:clock(),changedBy:"JFC-panel"};
   await tx.put(key(l),next);await tx.delete(proposal(l));await tx.delete(limit(l));
   return {ok:true,activated:true,...pub(next,null,observed)};
  });
 }
 async function verify(license,pin,rotation){
  const l=cleanLicense(license),p=cleanPin(pin),candidate=await mac(secret,l,p);
  const next=rotation?await mac(secret,l,cleanPin(rotation.newPin)):null;
  const expected=rotation?rev(rotation.expectedRevision):null;
  return storage.transaction(async tx=>{
   const stored=await tx.get(key(l));if(!stored)return {ok:false,reason:"unconfigured"};
   const now=clock();let guard=await tx.get(limit(l));
   if(!guard||!Number.isSafeInteger(guard.start)||now-guard.start>=WINDOW||now<guard.start)guard={start:now,attempts:0,lockedUntil:0};
   if(guard.lockedUntil>now)return {ok:false,reason:"rate-limited"};
   if(rotation&&expected!==stored.revision)return {ok:false,reason:"revision-conflict",revision:stored.revision};
   if(!equal(candidate,stored.fingerprint)){
    guard.attempts++;if(guard.attempts>=MAX)guard.lockedUntil=now+WINDOW;
    await tx.put(limit(l),guard);
    return {ok:false,reason:guard.lockedUntil>now?"rate-limited":"invalid-pin"};
   }
   await tx.delete(limit(l));
   if(!rotation)return {ok:true,revision:stored.revision};
   if(equal(next,stored.fingerprint))return {ok:true,unchanged:true,...pub(stored,null,null)};
   const newer={v:1,revision:stored.revision+1,fingerprint:next,changedAt:now,changedBy:"authenticated-owner"};
   await tx.put(key(l),newer);
   // Expire staged edits from older revisions; they must never revert this one.
   await tx.delete(proposal(l));
   return {ok:true,unchanged:false,...pub(newer,null,null)};
  });
 }
 return {status,reportExisting,masterSet,masterActivate,verify,rotate:(lic,pin,newPin,expectedRevision)=>verify(lic,pin,{newPin,expectedRevision})};
}
