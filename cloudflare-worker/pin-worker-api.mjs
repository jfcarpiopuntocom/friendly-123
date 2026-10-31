import {pinAuthority} from "./pin-authority.mjs";
const H={"content-type":"application/json; charset=utf-8","cache-control":"no-store"};
const LICENSE=/^F123-[A-Z0-9*~$=-]{8,34}$/;
const INSTANCE=/^[a-zA-Z0-9_-]{6,120}$/;
function reply(obj,status=200){return new Response(JSON.stringify(obj),{status,headers:H})}
export function pinDoRoute(req,storage,env){
 const url=new URL(req.url);
 if(url.pathname!=="/pin-authority/internal"||req.method!=="POST")return null;
 return (async()=>{
  if(!env.PIN_PEPPER)return reply({ok:false,reason:"authority-unavailable"},503);
  let body;try{body=await req.json()}catch{return reply({ok:false},400)}
  try{
   const p=pinAuthority(storage,env.PIN_PEPPER);
   let r;
   if(body.action==="status")r=await p.status(body.licenseCode);
   else if(body.action==="master-set")r=await p.masterSet(body.licenseCode,body.pin,body.expectedRevision);
   else if(body.action==="master-activate")r=await p.masterActivate(body.licenseCode,body.pin,body.expectedRevision);
   else if(body.action==="report")r=await p.reportExisting(body.licenseCode,body.instanceId,body.pin);
   else if(body.action==="verify")r=await p.verify(body.licenseCode,body.pin);
   else if(body.action==="owner-rotate")r=await p.rotate(body.licenseCode,body.pin,body.newPin,body.expectedRevision);
   else return reply({ok:false},404);
   const code=["revision-conflict","unconfigured","enrollment-required","proposal-mismatch","device-report-limit"].includes(r.reason)?409:r.reason==="rate-limited"?429:r.reason==="invalid-pin"?401:200;
   return reply(r,code);
  }catch{return reply({ok:false,reason:"invalid-input"},400)}
 })();
}
export async function pinPublicRoute(req,env,{getDo,readLicenseInstance,authorizeMaster}){
 const url=new URL(req.url);
 const action={"/pin/admin/status":"status","/pin/admin/set":"master-set","/pin/admin/activate":"master-activate","/pin/report":"report","/pin/verify":"verify","/pin/rotate":"owner-rotate"}[url.pathname];
 if(!action)return null;
 if(!env.PIN_PEPPER||!env.REGISTROS||!env.MASTER_KEY)return reply({ok:false,reason:"authority-unavailable"},503);
 const admin=action==="status"||action==="master-set"||action==="master-activate";
 if(admin&&!authorizeMaster(req,env))return reply({ok:false},401);
 if(req.method!==(action==="status"?"GET":"POST"))return reply({ok:false},405);
 let data;
 if(action==="status")data={licenseCode:url.searchParams.get("licenseCode"),instanceId:url.searchParams.get("instanceId")};
 else{const raw=await req.text();if(raw.length>1024)return reply({ok:false},413);try{data=JSON.parse(raw)}catch{return reply({ok:false},400)}}
 const licenseCode=String(data.licenseCode||"").trim().toUpperCase(),instanceId=String(data.instanceId||"");
 if(!LICENSE.test(licenseCode)||!INSTANCE.test(instanceId))return reply({ok:false},400);
 let saved;try{saved=await readLicenseInstance(env,instanceId)}catch{return reply({ok:false,reason:"instance-lookup-failed"},503)}
 if(!saved||saved.instanceId!==instanceId||String(saved.licenseCode||"").trim().toUpperCase()!==licenseCode)
  return reply({ok:false,reason:"license-instance-mismatch"},404);
 let response;try{
  const stub=getDo(env);if(!stub)return reply({ok:false,reason:"authority-unavailable"},503);
  response=await stub.fetch("https://do.invalid/pin-authority/internal",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({...data,licenseCode,action})});
 }catch{return reply({ok:false,reason:"authority-unavailable"},503)}
 return new Response(response.body,{status:response.status,headers:H});
}
