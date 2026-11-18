// Thin server-only adapter over the existing Owner PIN authority and license registry.
// A principal proves an Owner ACCOUNT, not the identity of a particular human.
// Other roles remain unconfigured until their authoritative source is connected.
const LICENSE=/^F123-[A-Z0-9*~$=-]{8,34}$/;
const INSTANCE=/^[A-Za-z0-9_-]{6,120}$/;
export function createWsPrincipalAuthority({ownerAuthority,readInstance,clock=Date.now}) {
  const verified=new WeakSet();
  function registered(row,license,instance) {
    return !!row&&row.instanceId===instance&&String(row.licenseCode||'').trim().toUpperCase()===license&&String(row.estado||'').toLowerCase()!=='bloqueada';
  }
  return Object.freeze({
    // Provenance only: a ticket issuer/room must independently check current authorization.
    isVerified: principal=>!!principal&&typeof principal==='object'&&verified.has(principal),
    async resolve(input) {
      const deny=reason=>({ok:false,reason});
      if(!input||typeof input!=='object')return deny('invalid-input');
      if(input.role!==undefined&&input.role!=='dueno')return deny('role-authority-unconfigured');
      const license=typeof input.licenseCode==='string'?input.licenseCode.trim().toUpperCase():'';
      const instance=typeof input.instanceId==='string'?input.instanceId:'';
      if(!LICENSE.test(license)||!INSTANCE.test(instance)||typeof input.pin!=='string'||!/^\d{3}$/.test(input.pin)||['456','789'].includes(input.pin))return deny('invalid-input');
      try {
        if(!registered(await readInstance(instance),license,instance))return deny('license-instance-mismatch');
        // Do not accept a verification result supplied by a browser: call the authority here.
        const result=await ownerAuthority.verify(license,input.pin);
        if(result?.ok!==true)return deny(result?.reason==='rate-limited'?'rate-limited':'owner-not-verified');
        if(!Number.isSafeInteger(result.revision)||result.revision<1)return deny('owner-not-verified');
        if(!registered(await readInstance(instance),license,instance))return deny('license-instance-mismatch');
        const current=await ownerAuthority.status(license);
        if(!current.configured||current.revision!==result.revision)return deny('authority-changed');
        // A status read can yield while the registry revokes an instance.
        // This closes that observed window; cross-store atomic revocation still belongs at ticket use.
        if(!registered(await readInstance(instance),license,instance))return deny('license-instance-mismatch');
        const verifiedAt=clock();
        if(!Number.isSafeInteger(verifiedAt)||verifiedAt<0)return deny('authority-unavailable');
        const principal=Object.freeze({license,instance,subject:'owner-account',role:'dueno',roleRevision:result.revision,sessionEpoch:result.revision,verifiedAt});
        verified.add(principal);
        return {ok:true,principal};
      } catch (_) { return deny('authority-unavailable'); }
    }
  });
}
