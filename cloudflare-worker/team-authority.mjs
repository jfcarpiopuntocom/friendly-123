// Server-side Team authority. Reuses the existing Owner authority; never changes its PIN.
// WebCrypto supplies HMAC. Records contain credential digests and authorization metadata only.
const encoder=new TextEncoder();
const LICENSE=/^F123-[A-Z0-9*~$=-]{8,34}$/;
const INSTANCE=/^[A-Za-z0-9_-]{6,120}$/;
const SUBJECT=/^[A-Za-z0-9_-]{5,120}$/;
const ROLES=new Set(['admin','empleado','contador','artista']);
const PIN=/^\d{3}$/;
const validPin=p=>typeof p==='string'&&PIN.test(p)&&!['456','789'].includes(p);
const same=(a,b)=>{if(typeof a!=='string'||typeof b!=='string'||a.length!==b.length)return false;let diff=0;for(let i=0;i<a.length;i++)diff|=a.charCodeAt(i)^b.charCodeAt(i);return diff===0;};
const deny=reason=>({ok:false,reason});
export function teamAuthority({storage,ownerAuthority,secret,readInstance,clock=Date.now}){
  const verified=new WeakSet();
  const key=typeof secret==='string'&&secret.length>=32?crypto.subtle.importKey('raw',encoder.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']):null;
  const stateKey=l=>'team-authority-v1:'+l;
  async function digest(value){if(!key)throw Error('unavailable');return Array.from(new Uint8Array(await crypto.subtle.sign('HMAC',await key,encoder.encode(value))),b=>b.toString(16).padStart(2,'0')).join('');}
  const pinDigest=(l,s,p)=>digest(JSON.stringify(['team-pin-v1',l,s,p]));
  function identity(input){if(!input||typeof input!=='object')return null;const l=typeof input.licenseCode==='string'?input.licenseCode.trim().toUpperCase():'';return LICENSE.test(l)&&INSTANCE.test(input.instanceId||'')?{license:l,instance:input.instanceId}:null;}
  async function registered({license,instance},tx){const row=await (readInstance?readInstance(instance,tx):(tx||storage).get('inst:'+instance));return !!row&&row.instanceId===instance&&String(row.licenseCode||'').trim().toUpperCase()===license&&String(row.estado||'').toLowerCase()!=='bloqueada';}
  const member=(s,id)=>Object.hasOwn(s.members,id)?s.members[id]:null;
  const fresh=()=>({revision:0,members:{}});
  const publicMember=m=>({subject:m.subject,role:m.role,active:m.active});
  async function update(input){
    const id=identity(input);
    if(!id||!SUBJECT.test(input.subject||'')||typeof input.active!=='boolean'||(input.active&&(!ROLES.has(input.role)||!validPin(input.pin)))||(input.role!==undefined&&!ROLES.has(input.role))||(input.pin!==undefined&&!validPin(input.pin))||!Number.isSafeInteger(input.expectedRevision)||input.expectedRevision<0||!SUBJECT.test(input.opId||'')||!validPin(input.ownerPin))return deny('invalid-input');
    try{
      if(!key)return deny('authority-unavailable');
      if(!await registered(id))return deny('license-instance-mismatch');
      const auth=await ownerAuthority.verify(id.license,input.ownerPin);
      if(auth?.ok!==true)return deny(auth?.reason==='rate-limited'?'rate-limited':'owner-not-verified');
      if(!Number.isSafeInteger(auth.revision)||auth.revision<1)return deny('owner-not-verified');
      const fingerprint=input.pin===undefined?null:await pinDigest(id.license,input.subject,input.pin);
      const hash=await digest(JSON.stringify(['team-command-v1',input.subject,input.role??null,input.active,fingerprint]));
      return await storage.transaction(async tx=>{
        // Both records belong to the same license authority DO transaction.
        const current=await tx.get('pin-owner:'+id.license);
        if(!current||current.revision!==auth.revision)return deny('authority-changed');
        if(!await registered(id,tx))return deny('license-instance-mismatch');
        const state=await tx.get(stateKey(id.license))||fresh();
        const receiptKey='team-op-v1:'+id.license+':'+input.opId;
        const previous=await tx.get(receiptKey);
        if(previous)return same(previous.hash,hash)?{ok:true,status:'already-applied',revision:state.revision,appliedRevision:previous.revision}:deny('operation-conflict');
        if(state.revision!==input.expectedRevision)return{...deny('revision-conflict'),revision:state.revision};
        // Preserve PIN uniqueness without storing the raw credential or trusting local role flags.
        if(input.active)for(const m of Object.values(state.members))if(m.active&&m.subject!==input.subject&&same(m.fingerprint,await pinDigest(id.license,m.subject,input.pin)))return deny('pin-collision');
        const prior=member(state,input.subject);
        if(!input.active&&!prior)return deny('member-not-found');
        const next={subject:input.subject,role:input.role??prior.role,active:input.active,fingerprint:fingerprint??prior.fingerprint};
        const revision=state.revision+1;
        await tx.put(stateKey(id.license),{revision,members:{...state.members,[input.subject]:next}});
        await tx.put(receiptKey,{hash,revision});
        await tx.delete('team-attempts-v1:'+id.license+':'+input.subject);
        return{ok:true,status:'applied',revision,member:publicMember(next)};
      });
    }catch(_){return deny('authority-unavailable');}
  }
  async function verify(input){
    const id=identity(input);
    if(!id||!SUBJECT.test(input.subject||'')||!validPin(input.pin))return deny('invalid-input');
    try{
      if(!key)return deny('authority-unavailable');
      if(!await registered(id))return deny('license-instance-mismatch');
      const candidate=await pinDigest(id.license,input.subject,input.pin);
      return await storage.transaction(async tx=>{
        if(!await registered(id,tx))return deny('license-instance-mismatch');
        const now=clock();if(!Number.isSafeInteger(now)||now<0)return deny('authority-unavailable');
        const state=await tx.get(stateKey(id.license))||fresh(),m=member(state,input.subject);
        if(!m||!m.active)return deny('team-not-verified');
        const attemptsKey='team-attempts-v1:'+id.license+':'+input.subject;
        let guard=await tx.get(attemptsKey);
        if(!guard||now<guard.start||now-guard.start>=900000)guard={start:now,attempts:0};
        if(guard.attempts>=10)return deny('rate-limited');
        if(!same(m.fingerprint,candidate)){
          await tx.put(attemptsKey,{start:guard.start,attempts:guard.attempts+1});
          return deny(guard.attempts+1>=10?'rate-limited':'team-not-verified');
        }
        await tx.delete(attemptsKey);
        const principal=Object.freeze({...id,subject:m.subject,role:m.role,roleRevision:state.revision,sessionEpoch:state.revision,verifiedAt:now});
        verified.add(principal);
        return{ok:true,principal};
      });
    }catch(_){return deny('authority-unavailable');}
  }
  async function isCurrent(p){
    if(!p||!verified.has(p))return false;
    try{return await storage.transaction(async tx=>{
      const state=await tx.get(stateKey(p.license)),m=state&&member(state,p.subject);
      return !!m&&m.active&&m.role===p.role&&state.revision===p.roleRevision&&await registered(p,tx);
    });}catch(_){return false;}
  }
  async function status(input){
    const id=identity(input);if(!id||!validPin(input.ownerPin))return deny('invalid-input');
    try{
      if(!key)return deny('authority-unavailable');
      if(!await registered(id))return deny('license-instance-mismatch');
      const auth=await ownerAuthority.verify(id.license,input.ownerPin);
      if(auth?.ok!==true)return deny(auth?.reason==='rate-limited'?'rate-limited':'owner-not-verified');
      return await storage.transaction(async tx=>{
        const owner=await tx.get('pin-owner:'+id.license);
        if(!owner||owner.revision!==auth.revision)return deny('authority-changed');
        if(!await registered(id,tx))return deny('license-instance-mismatch');
        const state=await tx.get(stateKey(id.license))||fresh();
        return{ok:true,revision:state.revision,members:Object.values(state.members).map(publicMember)};
      });
    }catch(_){return deny('authority-unavailable');}
  }
  return Object.freeze({update,verify,isCurrent,status});
}
