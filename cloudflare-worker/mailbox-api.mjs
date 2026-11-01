// friendly-123 durable, encrypted, license-scoped mailbox. No business plaintext.
// DISABLED until Worker binding and a separately audited client are deployed.
// The Worker only routes opaque AES-GCM envelopes; the Yjs/event ledger stays local.
const H = {'content-type':'application/json; charset=utf-8','cache-control':'no-store'};
const LICENSE = /^F123-[A-Z0-9*~$=-]{8,34}$/;
const DEVICE = /^[A-Za-z0-9_-]{12,120}$/;
const EVENT = /^[A-Za-z0-9_.:-]{12,160}$/;
const B64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const TTL = 10 * 60 * 1000;
const MAX_ENVELOPE = 64 * 1024; // decoded cipher bytes, includes GCM tag
const MAX_ITEMS = 10000, MAX_TOTAL = 12 * 1024 * 1024;
const MAX_PER_MINUTE = 240;
const pad = n => String(n).padStart(12,'0');
const response = (data, status=200) => new Response(JSON.stringify(data), {status,headers:H});
const validLicense = l => typeof l==='string' && LICENSE.test(l);
const validInt = v => Number.isSafeInteger(v) && v>=0;
const safeJSON = async (req,limit) => {
  const text = await req.text();
  if (text.length > limit) throw Error('body-too-large');
  return JSON.parse(text);
};
function b64url(bytes) {
  let s=''; for(const n of bytes) s+=String.fromCharCode(n);
  return btoa(s).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}
function unb64url(s){
  if(typeof s!=='string'||!/^[A-Za-z0-9_-]+$/.test(s)||s.length>3000)throw Error('bad-token');
  const t=s.replace(/-/g,'+').replace(/_/g,'/');
  return Uint8Array.from(atob(t+'='.repeat((4-t.length%4)%4)), c=>c.charCodeAt(0));
}
const enc = new TextEncoder(), dec = new TextDecoder();
async function key(env){
  if(typeof env.PIN_PEPPER!=='string'||env.PIN_PEPPER.length<32)throw Error('authority-unavailable');
  return crypto.subtle.importKey('raw',enc.encode('f123-mailbox-session-v1:'+env.PIN_PEPPER),{name:'HMAC',hash:'SHA-256'},false,['sign','verify']);
}
async function ticket(env,claim){
  const part=b64url(enc.encode(JSON.stringify(claim)));
  const sig=await crypto.subtle.sign('HMAC',await key(env),enc.encode(part));
  return part+'.'+b64url(new Uint8Array(sig));
}
async function readTicket(env,header,now){
  const match=/^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/.exec(header||'');
  if(!match)return null;
  const [p,s]=match[1].split('.');
  if(p.length>2100||s.length!==43)return null;
  try {
    if(!await crypto.subtle.verify('HMAC',await key(env),unb64url(s),enc.encode(p)))return null;
    const j=JSON.parse(dec.decode(unb64url(p)));
    if(j.aud!=='f123-mailbox-v1'||j.role!=='owner'||!validLicense(j.lic)||
       !DEVICE.test(j.device)||!validInt(j.rev)||j.rev<1||
       !validInt(j.iat)||!validInt(j.exp)||j.exp-j.iat!==TTL||
       now<j.iat-30000||now>=j.exp)return null;
    return j;
  }catch{return null}
}
async function authority(stub,body){
  const res=await stub.fetch('https://do.invalid/pin-authority/internal',{
    method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)
  });
  return {status:res.status,data:await res.json()};
}
// The single master-facing Worker verifies PINs and revision on *every* mailbox
// operation. Signed session tickets are bounded and cannot survive PIN rotation.
export async function mailboxPublicRoute(req,env,{getPinDo,getMailboxDo},now=Date.now()){
  const url=new URL(req.url),isSession=url.pathname==='/mailbox/session',
    isEvents=url.pathname==='/mailbox/events',isAck=url.pathname==='/mailbox/ack';
  if(!isSession&&!isEvents&&!isAck)return null;
  if(!(env?.REGISTROS&&env?.MAILBOXES&&typeof env.PIN_PEPPER==='string'&&env.PIN_PEPPER.length>=32))
    return response({ok:false,reason:'mailbox-unavailable'},503);
  // Pilot is denied by default, including read access. Only the license
  // deliberately configured as a Cloudflare SECRET gets a session. An Owner
  // cannot enroll customers simply by flipping a client-side local flag.
  const pilot=String(env.MAILBOX_CANARY_LICENSE_CODE||'').trim().toUpperCase();
  if(!validLicense(pilot))return response({ok:false,reason:'canary-not-configured'},503);
  if((isSession&&req.method!=='POST')||(isEvents&&!['GET','POST'].includes(req.method))||
     (isAck&&req.method!=='POST'))return response({ok:false},405);
  try {
    const pinDo=getPinDo(env);if(!pinDo)return response({ok:false,reason:'pin-authority-unavailable'},503);
    if(isSession){
      const body=await safeJSON(req,700);
      if(!validLicense(body?.licenseCode)||typeof body.pin!=='string'||!/^[0-9]{3}$/.test(body.pin)||
         !DEVICE.test(body.deviceId))return response({ok:false},400);
      if(body.licenseCode!==pilot)return response({ok:false,reason:'outside-pilot'},403);
      const verified=await authority(pinDo,{action:'verify',licenseCode:body.licenseCode,pin:body.pin});
      if(!verified.data?.ok){
        if(verified.status===429)return response({ok:false,reason:'rate-limited'},429);
        return response({ok:false,reason:'unauthorized'},verified.status===503?503:401);
      }
      if(!validInt(verified.data.revision)||verified.data.revision<1)return response({ok:false},503);
      return response({ok:true,role:'owner',revision:verified.data.revision,expiresAt:now+TTL,
        token:await ticket(env,{aud:'f123-mailbox-v1',lic:body.licenseCode,
          role:'owner',device:body.deviceId,rev:verified.data.revision,iat:now,exp:now+TTL})});
    }
    const claim=await readTicket(env,req.headers.get('Authorization'),now);
    if(!claim)return response({ok:false,reason:'unauthorized'},401);
    if(claim.lic!==pilot)return response({ok:false,reason:'outside-pilot'},403);
    const latest=await authority(pinDo,{action:'status',licenseCode:claim.lic,registeredIds:[]});
    if(!latest.data?.configured||latest.data.revision!==claim.rev)
      return response({ok:false,reason:'revision-changed'},401);
    const mailbox=getMailboxDo(env,claim.lic);if(!mailbox)return response({ok:false},503);
    let command;
    if(isEvents&&req.method==='GET'){
      const after=Number(url.searchParams.get('after')||'0');
      const limit=Number(url.searchParams.get('limit')||'50');
      if(!validInt(after)||!Number.isSafeInteger(limit)||limit<1||limit>50)return response({ok:false},400);
      command={action:'pull',licenseCode:claim.lic,after,limit};
    }else if(isEvents){
      const body=await safeJSON(req,100000);
      command={action:'append',licenseCode:claim.lic,envelope:body};
    }else{
      const body=await safeJSON(req,250);
      if(!validInt(body?.cursor))return response({ok:false},400);
      command={action:'ack',licenseCode:claim.lic,cursor:body.cursor,deviceId:claim.device};
    }
    const result=await mailbox.fetch('https://do.invalid/mailbox/internal',{
      method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(command)
    });
    return new Response(result.body,{status:result.status,headers:H});
  }catch(e){
    if(e instanceof SyntaxError||e.message==='body-too-large')return response({ok:false,reason:'invalid-payload'},400);
    // No credential, payload or notebook internals returned on infrastructure failure.
    return response({ok:false,reason:'mailbox-unavailable'},503);
  }
}
function validEnvelope(v){
  if(!v||typeof v!=='object'||Array.isArray(v)||
     Object.keys(v).sort().join(',')!=='ciphertext,eventId,nonce')return false;
  if(!EVENT.test(v.eventId)||typeof v.nonce!=='string'||!B64.test(v.nonce)||v.nonce.length!==16||
     typeof v.ciphertext!=='string'||!B64.test(v.ciphertext)||v.ciphertext.length<24)return false;
  const n=v.ciphertext.length/4*3-(v.ciphertext.endsWith('==')?2:v.ciphertext.endsWith('=')?1:0);
  return n>=16&&n<=MAX_ENVELOPE;
}
// This DO is a separate per-license class/binding: no scans or polling of the
// global license registry. No deletion on ACK; even a stale device can backfill.
export async function mailboxDoRoute(req,storage,now=Date.now()){
  if(new URL(req.url).pathname!=='/mailbox/internal')return null;
  if(req.method!=='POST')return response({ok:false},405);
  try {
    const cmd=await safeJSON(req,100200);
    if(!validLicense(cmd?.licenseCode))return response({ok:false},400);
    const lic=cmd.licenseCode;
    if(cmd.action==='append'){
      if(!validEnvelope(cmd.envelope))return response({ok:false,reason:'invalid-envelope'},400);
      const e=cmd.envelope;
      const length=e.ciphertext.length+e.nonce.length+e.eventId.length;
      const outcome=await storage.transaction(async tx=>{
        const meta=await tx.get('meta')||{licenseCode:lic,seq:0,bytes:0,window:Math.floor(now/60000),writes:0};
        if(meta.licenseCode!==lic)return {ok:false,reason:'license-mismatch',code:403};
        const old=await tx.get('event-id:'+e.eventId);
        if(old){
          if(old.ciphertext===e.ciphertext&&old.nonce===e.nonce)
            return {ok:true,sequence:old.sequence,duplicate:true};
          return {ok:false,reason:'event-id-conflict',code:409};
        }
        const minute=Math.floor(now/60000);
        if(meta.window!==minute){meta.window=minute;meta.writes=0;}
        if(meta.writes>=MAX_PER_MINUTE)return {ok:false,reason:'write-rate-limit',code:429};
        if(meta.seq>=MAX_ITEMS||meta.bytes+length>MAX_TOTAL)
          return {ok:false,reason:'mailbox-capacity',code:507};
        const sequence=meta.seq+1;
        await tx.put('event:'+pad(sequence),{...e,sequence});
        await tx.put('event-id:'+e.eventId,{ciphertext:e.ciphertext,nonce:e.nonce,sequence});
        meta.seq=sequence;meta.bytes+=length;meta.writes++;
        await tx.put('meta',meta);
        return {ok:true,sequence,duplicate:false};
      });
      const {code=200,...data}=outcome;return response(data,code);
    }
    if(cmd.action==='pull'){
      if(!validInt(cmd.after)||!Number.isSafeInteger(cmd.limit)||cmd.limit<1||cmd.limit>50)
        return response({ok:false},400);
      const meta=await storage.get('meta');
      if(meta&&meta.licenseCode!==lic)return response({ok:false},403);
      const rows=await storage.list({prefix:'event:',startAfter:'event:'+pad(cmd.after),limit:cmd.limit});
      const events=[...rows.values()];
      return response({ok:true,events,cursor:events.length?events.at(-1).sequence:cmd.after,
        latest:meta?.seq||0,hasMore:(events.length?events.at(-1).sequence:cmd.after)<(meta?.seq||0)});
    }
    if(cmd.action==='ack'){
      if(!DEVICE.test(cmd.deviceId)||!validInt(cmd.cursor))return response({ok:false},400);
      const result=await storage.transaction(async tx=>{
        const meta=await tx.get('meta');
        if(!meta||meta.licenseCode!==lic||cmd.cursor>meta.seq)return {ok:false,reason:'invalid-ack',code:409};
        const id='ack:'+cmd.deviceId,existing=await tx.get(id);
        const alreadyRegistered=existing!==undefined&&existing!==null;
        const next=Math.max(alreadyRegistered?existing:0,cmd.cursor);
        // ACK cursor zero is a valid registration, never another new device.
        // Counting !old would let a single client exhaust the 60-device quota.
        const count=await tx.get('ack-count')||0;
        if(!alreadyRegistered&&count>=60)return {ok:false,reason:'device-capacity',code:507};
        if(!alreadyRegistered)await tx.put('ack-count',count+1);
        await tx.put(id,next);
        return {ok:true,cursor:next};
      });
      const {code=200,...data}=result;return response(data,code);
    }
    return response({ok:false},404);
  }catch{return response({ok:false,reason:'mailbox-internal-failure'},503)}
}