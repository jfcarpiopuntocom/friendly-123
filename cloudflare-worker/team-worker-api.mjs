import {pinAuthority} from './pin-authority.mjs';
import {teamAuthority} from './team-authority.mjs';
const paths={'/team/update':'update','/team/verify':'verify','/team/status':'status'};
const headers={'content-type':'application/json; charset=utf-8','cache-control':'no-store'};
const reply=(body,status=200)=>new Response(JSON.stringify(body),{status,headers});
function enabled(env){return env.TEAM_AUTHORITY_QA==='1'&&/^F123-[A-Z0-9*~$=-]{8,34}$/.test(env.TEAM_AUTHORITY_LICENSE||'')&&typeof env.TEAM_PIN_PEPPER==='string'&&env.TEAM_PIN_PEPPER.length>=32&&typeof env.PIN_PEPPER==='string'&&env.PIN_PEPPER.length>=32&&env.TEAM_PIN_PEPPER!==env.PIN_PEPPER&&env.TEAM_PIN_PEPPER!==env.MASTER_KEY;}
export async function readAuthorityBody(req,limit=2048){
  let reader;
  try{
    if(!req.body)return null;
    reader=req.body.getReader();
    const chunks=[];let size=0;
    while(true){
      const {value,done}=await reader.read();if(done)break;
      size+=value.byteLength;
      if(size>limit){await reader.cancel();return null;}
      chunks.push(value);
    }
    const bytes=new Uint8Array(size);let offset=0;
    for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
    const body=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
    return body&&typeof body==='object'&&!Array.isArray(body)?body:null;
  }catch(_){return null;}finally{reader?.releaseLock();}
}
function response(result){const status=result.ok?200:result.reason==='rate-limited'?429:result.reason==='authority-unavailable'?503:result.reason==='revision-conflict'||result.reason==='operation-conflict'||result.reason==='pin-collision'?409:result.reason==='invalid-input'?400:403;return reply(result,status);}
export async function teamPublicRoute(req,env,{getDo}){
  const action=paths[new URL(req.url).pathname];if(!action)return null;
  if(!enabled(env))return reply({ok:false,reason:'authority-unavailable'},503);
  if(req.method!=='POST')return reply({ok:false,reason:'method-not-allowed'},405);
  const body=await readAuthorityBody(req);if(!body)return reply({ok:false,reason:'invalid-input'},400);
  if(String(body.licenseCode||'').trim().toUpperCase()!==env.TEAM_AUTHORITY_LICENSE)return reply({ok:false,reason:'not-found'},404);
  try{
    const stub=getDo(env);if(!stub)return reply({ok:false,reason:'authority-unavailable'},503);
    return await stub.fetch('https://do.invalid/team-authority/internal',{method:'POST',headers,body:JSON.stringify({...body,action})});
  }catch(_){return reply({ok:false,reason:'authority-unavailable'},503);}
}
export function teamDoRoute(req,storage,env){
  if(new URL(req.url).pathname!=='/team-authority/internal')return null;
  return(async()=>{
    if(!enabled(env))return reply({ok:false,reason:'authority-unavailable'},503);
    if(req.method!=='POST')return reply({ok:false,reason:'method-not-allowed'},405);
    const body=await readAuthorityBody(req);if(!body||!['update','verify','status'].includes(body.action))return reply({ok:false,reason:'invalid-input'},400);
    if(String(body.licenseCode||'').trim().toUpperCase()!==env.TEAM_AUTHORITY_LICENSE)return reply({ok:false,reason:'not-found'},404);
    const team=teamAuthority({storage,ownerAuthority:pinAuthority(storage,env.PIN_PEPPER),secret:env.TEAM_PIN_PEPPER});
    // Returned verify metadata is informational; it is NOT a transferable WS capability.
    return response(await team[body.action](body));
  })().catch(()=>reply({ok:false,reason:'authority-unavailable'},503));
}
