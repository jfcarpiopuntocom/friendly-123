const issuer='https://friendly123-licencias.jfcarpio.workers.dev/ws/ticket';
const unavailable=()=>new Error('WS authorization unavailable');

// Reads the existing credential at the time of each attempt; retains no PIN,
// claims, or browser role as an independent source of server authority.
export function createOwnerTicketParams({licenseCode,instanceId,room,photoScope,getCredentials,fetch:send=globalThis.fetch.bind(globalThis)}) {
  if(!/^F123-[A-Z0-9*~$=-]{8,34}$/.test(licenseCode||'')||
     !/^[A-Za-z0-9_-]{6,128}$/.test(instanceId||'')||
     !(photoScope===undefined ? /^[a-f0-9]{32}-(?:cat|ops|priv)$/.test(room||'') :
       (['read','write'].includes(photoScope)&&/^[a-f0-9]{32}-fotos$/.test(room||'')))||
     typeof getCredentials!=='function'||typeof send!=='function')throw unavailable();
  function snapshot() {
    const c=getCredentials();
    if(c?.kind!=='owner'||c.licenseCode!==licenseCode||c.instanceId!==instanceId||
       typeof c.pin!=='string'||!/^\d{3}$/.test(c.pin)||['456','789'].includes(c.pin))throw unavailable();
    return{kind:'owner',licenseCode,instanceId,pin:c.pin};
  }
  return async function freshOwnerParams() {
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),2400);
    try {
      const credentials=snapshot();
      const suffix=room.slice(-3)==='cat'?'cat':room.slice(-3)==='ops'?'ops':'priv';
      const scopes=photoScope!==undefined?['fotos:'+photoScope]:suffix==='cat'?['cat:read','cat:write']:suffix==='ops'?['ops:read','ops:sale']:['priv:read','priv:write'];
      const response=await send(issuer,{method:'POST',mode:'cors',cache:'no-store',credentials:'omit',redirect:'error',referrerPolicy:'no-referrer',headers:{'content-type':'application/json'},signal:controller.signal,body:JSON.stringify({credentials,room,scopes,ttlMs:30000})});
      if(!response.ok)throw unavailable();
      const data=await response.json(),current=snapshot(),now=Date.now();
      if(current.pin!==credentials.pin||data?.ok!==true||typeof data.token!=='string'||data.token.length>3500||
         !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(data.token)||
         !Number.isSafeInteger(data.expiresAt)||data.expiresAt<=now||data.expiresAt>now+60000)throw unavailable();
      return{licencia:licenseCode,instancia:instanceId,cap:data.token};
    } catch (_) { throw unavailable(); }
    finally { clearTimeout(timer); }
  };
}
