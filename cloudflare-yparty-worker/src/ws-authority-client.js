// Server-to-server admission: native service binding only, never an endpoint supplied by a browser.
export function secureMode(env){return env.WS_AUTHORITY_QA==='1';}
export function ticketRequest(request,room){const p=new URL(request.url).searchParams;return{token:p.get('cap'),licenseCode:String(p.get('licencia')||'').trim().toUpperCase(),instanceId:p.get('instancia')||'',room,requiredScope:room.endsWith('-cat')?'cat:read':room.endsWith('-ops')?'ops:read':'priv:read'};}
function validatedAccess(data,access){
  const p=data?.principal,now=Date.now();
  // Owner may access its own rooms. Team NEVER accesses any raw Yjs:
  // -cat still includes Owner-private _meta, customers and money.
  // ONLY the server-side typed HTTP command path uses ops:sale. The WS
  // handshake for -ops ALWAYS requests ops:read, so a Team sale ticket is
  // insufficient to open a Yjs socket or receive private economic bytes.
  const owner=p?.role==='dueno'&&p.subject==='owner-account';
  const teamIdentity=(p?.role==='empleado'||p?.role==='admin')&&
    typeof p.subject==='string'&&/^[A-Za-z0-9_-]{5,120}$/.test(p.subject);
  const oneScope=Array.isArray(p?.scopes)&&p.scopes.length===1;
  const teamTypedSale=teamIdentity&&
    access.room.endsWith('-ops')&&access.requiredScope==='ops:sale'&&
    oneScope&&p.scopes[0]==='ops:sale';
  // JFC 2026-11-18: Admin uses what the Owner uses (except deleting the business).
  const adminTypedAdjust=p?.role==='admin'&&teamIdentity&&access.room.endsWith('-ops')&&
    access.requiredScope==='ops:adjust'&&oneScope&&p.scopes[0]==='ops:adjust';
  // JFC 2026-11-18: Owner, Admin and employee register cobros/abonos a fiado.
  const teamTypedPayment=teamIdentity&&access.room.endsWith('-ops')&&
    access.requiredScope==='ops:payment'&&oneScope&&p.scopes[0]==='ops:payment';
  // Employees can fetch immutable SHA photos only by a narrowly signed
  // HTTP fotos:read capability. The router never upgrades -fotos to WebSocket
  // and never accepts fotos:read on PUT. Private/Yjs rooms stay Owner-only.
  const teamPhotoRead=teamIdentity&&
    access.room.endsWith('-fotos')&&access.requiredScope==='fotos:read'&&
    oneScope&&p.scopes[0]==='fotos:read';
  if(data?.ok!==true||!(owner||teamTypedSale||adminTypedAdjust||teamTypedPayment||teamPhotoRead)||p.license!==access.licenseCode||p.instance!==access.instanceId||p.room!==access.room||!Number.isSafeInteger(p.iat)||!Number.isSafeInteger(p.exp)||p.iat>now||p.exp<=now||!Array.isArray(p.scopes)||!p.scopes.includes(access.requiredScope))return null;
  return{...access,principal:p};
}
async function query(env,action,body){
  if(!secureMode(env)||!env.WS_AUTHORITY?.fetch||typeof env.WS_SERVICE_KEY!=='string'||env.WS_SERVICE_KEY.length<32)return null;
  try{
    const response=await env.WS_AUTHORITY.fetch('https://authority.invalid/ws/'+action,{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+env.WS_SERVICE_KEY},body:JSON.stringify(body),signal:AbortSignal.timeout(2400)});
    return response.ok?await response.json():null;
  }catch(_){return null;}
}
export async function askAuthority(env,action,access){return validatedAccess(await query(env,action,access),access);}
export async function askAuthorityBatch(env,accesses){
  if(!accesses.length||accesses.length>64)return null;
  const first=accesses[0];
  if(accesses.some(a=>a.licenseCode!==first.licenseCode||a.room!==first.room))return null;
  const data=await query(env,'check-many',{licenseCode:first.licenseCode,room:first.room,requests:accesses});
  if(data?.ok!==true||!Array.isArray(data.results)||data.results.length!==accesses.length)return null;
  return data.results.map((result,i)=>validatedAccess(result,accesses[i]));
}
export function unexpired(access){return !!access?.principal&&access.principal.iat<=Date.now()&&access.principal.exp>Date.now();}
