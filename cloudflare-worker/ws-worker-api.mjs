import {pinAuthority} from './pin-authority.mjs';
import {teamAuthority} from './team-authority.mjs';
import {readAuthorityBody} from './team-worker-api.mjs';
import {wsCapabilityAuthority} from './ws-capability-issuer.mjs';
const paths={'/ws/ticket':'issue','/ws/consume':'consume','/ws/check':'check','/ws/check-many':'checkMany'};
const H={'content-type':'application/json; charset=utf-8','cache-control':'no-store'};
const reply=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:H});
function config(env){
  if(env.WS_AUTHORITY_QA!=='1'||env.TEAM_AUTHORITY_QA!=='1'||!/^F123-[A-Z0-9*~$=-]{8,34}$/.test(env.TEAM_AUTHORITY_LICENSE||''))return null;
  const names=['PIN_PEPPER','TEAM_PIN_PEPPER','WS_SIGNING_KEY','WS_SERVICE_KEY'];
  const keys=names.map(k=>env[k]);
  if(keys.some(k=>typeof k!=='string'||new TextEncoder().encode(k).length<32)||new Set(keys).size!==keys.length||keys.includes(env.MASTER_KEY))return null;
  let grants={};
  try{if(env.WS_QA_ROLE_GRANTS!==undefined)grants=JSON.parse(env.WS_QA_ROLE_GRANTS);if(!grants||typeof grants!=='object'||Array.isArray(grants)||Object.entries(grants).some(([role,scopes])=>!['admin','empleado','contador','artista'].includes(role)||!Array.isArray(scopes)||scopes.length>8||scopes.some(s=>typeof s!=='string')))return null;}catch(_){return null;}
  return {grants};
}
function trustedService(req,env){
  const value=req.headers.get('authorization')||'',expected='Bearer '+env.WS_SERVICE_KEY;
  if(value.length!==expected.length)return false;
  let diff=0;for(let i=0;i<value.length;i++)diff|=value.charCodeAt(i)^expected.charCodeAt(i);return diff===0;
}
function code(r){return r.ok?200:r.reason==='rate-limited'?429:r.reason==='authority-unavailable'||r.reason==='invalid-or-unavailable-ticket'?503:r.reason==='invalid-input'?400:r.reason==='replayed-ticket'?409:403;}
export async function wsPublicRoute(req,env,{getDo}){
  const action=paths[new URL(req.url).pathname];if(!action)return null;
  if(!config(env))return reply({ok:false,reason:'authority-unavailable'},503);
  if(req.method!=='POST')return reply({ok:false,reason:'method-not-allowed'},405);
  // Issuance authenticates the end user; use/revalidation is available only to the private sync service.
  if(action!=='issue'&&!trustedService(req,env))return reply({ok:false,reason:'service-not-verified'},403);
  const body=await readAuthorityBody(req,action==='checkMany'?65536:4096);if(!body)return reply({ok:false,reason:'invalid-input'},400);
  const license=action==='issue'?body.credentials?.licenseCode:body.licenseCode;
  if(typeof license!=='string'||license.trim().toUpperCase()!==env.TEAM_AUTHORITY_LICENSE)return reply({ok:false,reason:'not-found'},404);
  try{
    const stub=getDo(env);if(!stub)return reply({ok:false,reason:'authority-unavailable'},503);
    // Server-only credential is a header, never a PIN/token query parameter or browser bundle constant.
    const result=await stub.fetch('https://do.invalid/ws-authority/internal',{method:'POST',headers:{...H,authorization:'Bearer '+env.WS_SERVICE_KEY},body:JSON.stringify({...body,action})});
    return new Response(result.body,{status:result.status,headers:H});
  }catch(_){return reply({ok:false,reason:'authority-unavailable'},503);}
}
export function wsDoRoute(req,storage,env){
  if(new URL(req.url).pathname!=='/ws-authority/internal')return null;
  return(async()=>{
    const cfg=config(env);if(!cfg)return reply({ok:false,reason:'authority-unavailable'},503);
    if(req.method!=='POST')return reply({ok:false,reason:'method-not-allowed'},405);
    if(!trustedService(req,env))return reply({ok:false,reason:'service-not-verified'},403);
    const body=await readAuthorityBody(req,65536);
    if(!body||!['issue','consume','check','checkMany'].includes(body.action))return reply({ok:false,reason:'invalid-input'},400);
    const license=body.action==='issue'?body.credentials?.licenseCode:body.licenseCode;
    if(typeof license!=='string'||license.trim().toUpperCase()!==env.TEAM_AUTHORITY_LICENSE)return reply({ok:false,reason:'not-found'},404);
    const owner=pinAuthority(storage,env.PIN_PEPPER);
    const team=teamAuthority({storage,ownerAuthority:owner,secret:env.TEAM_PIN_PEPPER});
    const ws=wsCapabilityAuthority({storage,ownerAuthority:owner,teamAuthority:team,secret:env.WS_SIGNING_KEY,forbiddenSecrets:[env.PIN_PEPPER,env.TEAM_PIN_PEPPER,env.MASTER_KEY,env.WS_SERVICE_KEY],grants:cfg.grants});
    const result=await ws[body.action](body);return reply(result,code(result));
  })().catch(()=>reply({ok:false,reason:'authority-unavailable'},503));
}
