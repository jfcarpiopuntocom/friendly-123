// Server-only bridge: authenticate against existing authorities, then issue/use in the license DO.
// A signed ticket is an admission credential, never a financial ACK or raw Yjs write permission.
import {createWsPrincipalAuthority} from './ws-authorized-subject.mjs';
const ENC=new TextEncoder(),DEC=new TextDecoder('utf-8',{fatal:true});
const LICENSE=/^F123-[A-Z0-9*~$=-]{8,34}$/;
const INSTANCE=/^[A-Za-z0-9_-]{6,120}$/;
const SUBJECT=/^[A-Za-z0-9_-]{5,120}$/;
const ROOM=/^[a-f0-9]{32}-(cat|ops|fotos|priv)$/;
const AUD='friendly-123-yparty-v1',TTL=60_000;
const CEILING=Object.freeze({
  dueno:['cat:read','cat:write','ops:read','ops:sale','ops:adjust','ops:payment','fotos:read','fotos:write','priv:read','priv:write'],
  admin:['cat:read','cat:write','ops:sale','ops:adjust','ops:payment','fotos:read'],
  empleado:['cat:read','ops:sale','ops:payment','fotos:read'],
  contador:[],artista:[]
});
const deny=reason=>({ok:false,reason});
const timeValid=n=>Number.isSafeInteger(n)&&n>=0;
function encode(bytes){let s='';for(const b of bytes)s+=String.fromCharCode(b);return btoa(s).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');}
function decode(s){if(typeof s!=='string'||!s||s.length>3000||!/^[A-Za-z0-9_-]+$/.test(s))throw Error('malformed');const b=Uint8Array.from(atob(s.replace(/-/g,'+').replace(/_/g,'/')+'='.repeat((4-s.length%4)%4)),c=>c.charCodeAt(0));if(encode(b)!==s)throw Error('noncanonical');return b;}
export async function roomForLicense(license){if(typeof license!=='string'||!LICENSE.test(license))throw Error('invalid-license');return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',ENC.encode('f123-yparty-v1:'+license))).slice(0,16),b=>b.toString(16).padStart(2,'0')).join('');}
function shape(p){return !!p&&p.v===1&&p.aud===AUD&&LICENSE.test(p.license)&&INSTANCE.test(p.instance)&&SUBJECT.test(p.subject)&&Object.hasOwn(CEILING,p.role)&&ROOM.test(p.room)&&Number.isSafeInteger(p.roleRevision)&&p.roleRevision>=1&&p.sessionEpoch===p.roleRevision&&timeValid(p.iat)&&timeValid(p.exp)&&p.exp>p.iat&&p.exp-p.iat<=TTL&&/^[A-Za-z0-9_-]{22}$/.test(p.jti)&&Array.isArray(p.scopes)&&p.scopes.length>0&&new Set(p.scopes).size===p.scopes.length&&p.scopes.every(s=>typeof s==='string'&&CEILING[p.role].includes(s)&&p.room.endsWith('-'+s.split(':')[0]));}
function registered(row,p){return !!row&&row.instanceId===p.instance&&String(row.licenseCode||'').trim().toUpperCase()===p.license&&String(row.estado||'').toLowerCase()!=='bloqueada';}
export function wsCapabilityAuthority({storage,ownerAuthority,teamAuthority,secret,forbiddenSecrets=[],clock=Date.now,grants={}}){
  const usable=typeof secret==='string'&&ENC.encode(secret).length>=32&&!forbiddenSecrets.includes(secret);
  const key=usable?crypto.subtle.importKey('raw',ENC.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign','verify']):null;
  // Freeze the configured policy; a later caller mutation cannot extend a ticket's rights.
  const policy=Object.fromEntries(Object.keys(CEILING).map(role=>[role,Object.freeze(role==='dueno'?CEILING.dueno.slice():Array.isArray(grants[role])?grants[role].filter(s=>CEILING[role].includes(s)):[])]));
  const owner=createWsPrincipalAuthority({ownerAuthority,readInstance:id=>storage.get('inst:'+id),clock});
  const receipt=jti=>'ws-ticket-v1:'+jti;
  async function current(tx,p){
    if(!registered(await tx.get('inst:'+p.instance),p))return false;
    if(p.role==='dueno')return p.subject==='owner-account'&&(await tx.get('pin-owner:'+p.license))?.revision===p.roleRevision;
    const state=await tx.get('team-authority-v1:'+p.license),m=state&&Object.hasOwn(state.members,p.subject)?state.members[p.subject]:null;
    return !!m&&m.active===true&&m.role===p.role&&state.revision===p.roleRevision;
  }
  async function cleanup(tx,now){
    // Bound maintenance per authenticated issuance; no alarms or unbounded full-store scans.
    if(typeof tx.list!=='function')throw Error('storage-list-required');
    const rows=await tx.list({prefix:'ws-ticket-v1:',limit:128});
    for(const [k,r] of rows)if(timeValid(r?.exp)&&r.exp<=now)await tx.delete(k);
  }
  async function issue(input){
    try{
      if(!key)return deny('authority-unavailable');
      const {credentials:c,room,scopes,ttlMs=30_000}=input||{};
      if(!c||!['owner','team'].includes(c.kind)||!ROOM.test(room||'')||!Array.isArray(scopes)||!scopes.length||scopes.length>8||new Set(scopes).size!==scopes.length||!Number.isSafeInteger(ttlMs)||ttlMs<=0||ttlMs>TTL)return deny('invalid-input');
      const auth=c.kind==='owner'?await owner.resolve(c):await teamAuthority.verify(c);
      if(auth?.ok!==true)return deny(auth?.reason||'not-verified');
      const p=auth.principal;
      if(c.kind==='owner'?!owner.isVerified(p):!await teamAuthority.isCurrent(p))return deny('not-verified');
      if(c.role!==undefined&&c.role!==p.role)return deny('role-mismatch');
      if(room!==(await roomForLicense(p.license))+'-'+room.split('-').at(-1))return deny('room-mismatch');
      if(!Object.hasOwn(policy,p.role)||!scopes.every(s=>policy[p.role].includes(s)))return deny('scope-denied');
      const now=clock();
      const claims={v:1,aud:AUD,license:p.license,instance:p.instance,subject:p.subject,role:p.role,room,scopes:scopes.slice().sort(),roleRevision:p.roleRevision,sessionEpoch:p.sessionEpoch,iat:now,exp:now+ttlMs,jti:encode(crypto.getRandomValues(new Uint8Array(16)))};
      if(!shape(claims))return deny('invalid-input');
      const body=encode(ENC.encode(JSON.stringify(claims)));
      const token=body+'.'+encode(new Uint8Array(await crypto.subtle.sign('HMAC',await key,ENC.encode(body))));
      return await storage.transaction(async tx=>{
        if(!await current(tx,claims))return deny('authority-changed');
        const at=clock();if(!timeValid(at)||at<claims.iat||at>=claims.exp)return deny('expired-or-future');
        await cleanup(tx,at);
        // Cap only authenticated issuance; guessing unknown subjects never allocates nonce records.
        const rateKey='ws-issue-rate-v1:'+claims.license+':'+claims.instance;
        const old=await tx.get(rateKey),rate=old&&at>=old.start&&at-old.start<60_000?old:{start:at,count:0};
        if(rate.count>=32)return deny('rate-limited');
        if(await tx.get(receipt(claims.jti)))return deny('nonce-conflict');
        await tx.put(rateKey,{start:rate.start,count:rate.count+1});
        await tx.put(receipt(claims.jti),{body,exp:claims.exp,consumed:false});
        return{ok:true,token,expiresAt:claims.exp};
      });
    }catch(_){return deny('authority-unavailable');}
  }
  async function validate(input,consume){
    try{
      if(!key)return deny('authority-unavailable');
      const {token,licenseCode,instanceId,room,requiredScope}=input||{};
      if(typeof token!=='string'||token.length>3500||!LICENSE.test(licenseCode||'')||!INSTANCE.test(instanceId||'')||!ROOM.test(room||''))return deny('invalid-input');
      const parts=token.split('.');if(parts.length!==2)return deny('invalid-ticket');
      const bytes=decode(parts[0]),signature=decode(parts[1]);
      if(signature.length!==32||!await crypto.subtle.verify('HMAC',await key,signature,ENC.encode(parts[0])))return deny('invalid-ticket');
      const p=JSON.parse(DEC.decode(bytes));
      if(!shape(p))return deny('invalid-ticket');
      const now=clock();if(!timeValid(now)||now<p.iat||now>=p.exp)return deny('expired-or-future');
      if(p.license!==licenseCode||p.instance!==instanceId||p.room!==room)return deny('identity-or-room-mismatch');
      if(typeof requiredScope!=='string'||!p.scopes.includes(requiredScope)||!policy[p.role]?.includes(requiredScope))return deny('scope-denied');
      if(room!==(await roomForLicense(p.license))+'-'+room.split('-').at(-1))return deny('room-mismatch');
      return await storage.transaction(async tx=>{
        if(!await current(tx,p))return deny('authority-changed');
        const at=clock();if(!timeValid(at)||at<p.iat||at>=p.exp)return deny('expired-or-future');
        const r=await tx.get(receipt(p.jti));
        if(!r||r.body!==parts[0]||r.exp!==p.exp||typeof r.consumed!=='boolean')return deny('unknown-ticket');
        if(consume&&r.consumed)return deny('replayed-ticket');
        if(!consume&&!r.consumed)return deny('ticket-not-consumed');
        if(consume)await tx.put(receipt(p.jti),{...r,consumed:true});
        return{ok:true,principal:Object.freeze({...p,scopes:Object.freeze(p.scopes.slice())})};
      });
    }catch(_){return deny('invalid-or-unavailable-ticket');}
  }
  async function checkMany(input){
    try{
      const {licenseCode,room,requests}=input||{};
      if(!LICENSE.test(licenseCode||'')||!ROOM.test(room||'')||!Array.isArray(requests)||!requests.length||requests.length>64||requests.some(r=>r?.licenseCode!==licenseCode||r?.room!==room))return deny('invalid-input');
      const checked=await Promise.all(requests.map(r=>validate(r,false)));
      // Cryptographic checks may finish at different times. Re-read every recipient in ONE
      // final DO transaction so an earlier grant cannot outlive a later observed revocation.
      return await storage.transaction(async tx=>{
        const results=[];
        for(let i=0;i<checked.length;i++){
          const r=checked[i];if(!r.ok){results.push(r);continue;}
          const p=r.principal,now=clock(),receiptRow=await tx.get(receipt(p.jti));
          if(!timeValid(now)||now<p.iat||now>=p.exp||!receiptRow?.consumed||receiptRow.body!==requests[i].token.split('.')[0]||!await current(tx,p))results.push(deny('authority-changed'));
          else results.push(r);
        }
        return{ok:true,results};
      });
    }catch(_){return deny('authority-unavailable');}
  }
  return Object.freeze({issue,consume:input=>validate(input,true),check:input=>validate(input,false),checkMany});
}
