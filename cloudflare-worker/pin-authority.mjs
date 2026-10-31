// Server-side central Owner PIN authority; no inventory or notebook data.
const enc=new TextEncoder();
const LICENSE=/^F123-[A-Z0-9*~$=-]{8,34}$/;
const PIN=/^\d{3}$/;
const RESERVED=new Set(["456","789"]);
const WINDOW=15*60*1000;
const MAX=10;
function cleanLicense(v){const s=String(v||"").trim().toUpperCase();if(!LICENSE.test(s))throw Error("invalid license");return s}
function cleanPin(v){if(typeof v!=="string"||!PIN.test(v)||RESERVED.has(v))throw Error("invalid PIN");return v}
function rev(v){if(!Number.isSafeInteger(v)||v<0)throw Error("revision required");return v}
function pub(r){return r?{configured:true,revision:r.revision,changedAt:r.changedAt,changedBy:r.changedBy}:{configured:false,revision:0,changedAt:null,changedBy:null}}
function equal(a,b){if(typeof a!=="string"||typeof b!=="string"||a.length!==64||b.length!==64)return false;let d=0;for(let i=0;i<64;i++)d|=a.charCodeAt(i)^b.charCodeAt(i);return d===0}
async function mac(secret,license,pin){if(typeof secret!=="string"||secret.length<32)throw Error("PIN_PEPPER missing");const key=await crypto.subtle.importKey("raw",enc.encode("f123-pin-owner-v1:"+secret),{name:"HMAC",hash:"SHA-256"},false,["sign"]);const digest=await crypto.subtle.sign("HMAC",key,enc.encode(license+"\n"+pin));return Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,"0")).join("")}
export function pinAuthority(storage,secret,clock=Date.now){
 if(!storage||typeof storage.transaction!=="function")throw Error("transactional storage required");
 const key=lic=>"pin-owner:"+lic,limit=lic=>"pin-owner-attempts:"+lic;
 async function status(license){const l=cleanLicense(license);return pub(await storage.get(key(l)))}
 async function masterSet(license,pin,expectedRevision){
  const l=cleanLicense(license),p=cleanPin(pin),expected=rev(expectedRevision),fingerprint=await mac(secret,l,p);
  return storage.transaction(async tx=>{
   const prior=await tx.get(key(l)),current=prior?.revision??0;
   if(current!==expected)return {ok:false,reason:"revision-conflict",...pub(prior)};
   if(prior&&equal(prior.fingerprint,fingerprint))return {ok:true,unchanged:true,...pub(prior)};
   const next={v:1,revision:current+1,fingerprint,changedAt:clock(),changedBy:"JFC-panel"};
   await tx.put(key(l),next);await tx.delete(limit(l));
   return {ok:true,unchanged:false,...pub(next)};
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
   if(equal(next,stored.fingerprint))return {ok:true,unchanged:true,...pub(stored)};
   const newer={v:1,revision:stored.revision+1,fingerprint:next,changedAt:now,changedBy:"authenticated-owner"};
   await tx.put(key(l),newer);return {ok:true,unchanged:false,...pub(newer)};
  });
 }
 return {status,masterSet,verify,rotate:(lic,pin,newPin,expectedRevision)=>verify(lic,pin,{newPin,expectedRevision})};
}
