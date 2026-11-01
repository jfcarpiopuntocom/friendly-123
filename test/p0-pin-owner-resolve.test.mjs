import {test} from "node:test";
import assert from "node:assert/strict";
import {webcrypto} from "node:crypto";
import {pinAuthority} from "../cloudflare-worker/pin-authority.mjs";
import {pinPublicRoute,pinDoRoute} from "../cloudflare-worker/pin-worker-api.mjs";
globalThis.crypto ||= webcrypto;
const license="F123-SYNTHETIC-SHOP",device="synthetic_registered_1";
function fixture(){
 const records=new Map();
 const storage={
  get:async k=>structuredClone(records.get(k)),
  transaction:async fn=>{
   const next=new Map([...records].map(([k,v])=>[k,structuredClone(v)]));
   const result=await fn({get:async k=>structuredClone(next.get(k)),
    put:async(k,v)=>next.set(k,structuredClone(v)),delete:async k=>next.delete(k)});
   records.clear();for(const [k,v] of next)records.set(k,v);return result;
  }
 };
 const env={MASTER_KEY:"synthetic-master",PIN_PEPPER:"synthetic-pepper-with-more-than-32-chars",REGISTROS:{},
  MAESTRO_IP:{limit:async({key})=>({success:key==="pin-resolve-ip:203.0.113.1"})}};
 const hook={getDo:()=>({fetch:(url,options)=>pinDoRoute(new Request(url,options),storage,env)}),
  readLicenseInstance:async (_,id)=>id===device?{instanceId:id,licenseCode:license}:null,
  authorizeMaster:r=>r.headers.get("X-Master-Key")===env.MASTER_KEY,
  listRegisteredDeviceIds:async()=>[device]};
 const authority=pinAuthority(storage,env.PIN_PEPPER);
 async function call(body,route="/pin/resolve",method="POST"){
  const request=new Request("https://fixture.invalid"+route,{
   method,headers:{"content-type":"application/json","CF-Connecting-IP":"203.0.113.1"},
   ...(method==="POST"?{body:JSON.stringify(body)}:{})
  });
  const response=await pinPublicRoute(request,env,hook);
  return {status:response.status,data:await response.json()};
 }
 async function activate(pin="312"){
  assert.equal((await authority.reportExisting(license,device,pin)).ok,true);
  assert.equal((await authority.masterSet(license,pin,0,[device])).staged,true);
  assert.equal((await authority.masterActivate(license,pin,0,[device])).activated,true);
 }
 return {storage,records,env,hook,call,activate};
}
test("no Owner identity or business route before full census and two explicit admin actions",async()=>{
 const f=fixture(),r=await f.call({licenseCode:license,pin:"312"});
 assert.equal(r.status,409);
 assert.equal(r.data.reason,"unconfigured");
});
test("activated Owner PIN resolves same canonical shop on unrelated browsers without registering fake devices",async()=>{
 const f=fixture();await f.activate();
 const first=await f.call({licenseCode:license,pin:"312",instanceId:"new-browser-1"});
 const second=await f.call({licenseCode:license,pin:"312",instanceId:"another-pwa-2"});
 for(const result of [first,second]){
  assert.equal(result.status,200);
  assert.deepEqual(result.data,{ok:true,role:"owner",businessId:license,revision:1});
  assert.equal(JSON.stringify(result.data).includes("312"),false);
 }
 const traditional=await f.call({licenseCode:license,instanceId:"unregistered-device",pin:"312"},"/pin/verify");
 assert.equal(traditional.status,404,"registered-device verification remains unchanged");
 assert.equal(JSON.stringify([...f.records]).includes('"312"'),false,"no raw PIN at rest");
 assert.equal([...f.records.keys()].some(k=>k.startsWith("inst:")),false,"resolution must not create device records");
});
test("wrong PIN, different license, absent keys and GET are denied",async()=>{
 const f=fixture();await f.activate();
 assert.equal((await f.call({licenseCode:license,pin:"137"})).status,401);
 assert.equal((await f.call({licenseCode:"F123-DIFFERENT",pin:"312"})).status,409);
 assert.equal((await f.call({licenseCode:license},"/pin/resolve","GET")).status,405);
 delete f.env.PIN_PEPPER;
 assert.equal((await f.call({licenseCode:license,pin:"312"})).status,503);
});
test("rate limit applies to unregistered browsers; valid PIN cannot bypass license lock",async()=>{
 const f=fixture();await f.activate();
 for(let i=0;i<9;i++)assert.equal((await f.call({licenseCode:license,pin:"137"})).status,401);
 assert.equal((await f.call({licenseCode:license,pin:"137"})).status,429);
 assert.equal((await f.call({licenseCode:license,pin:"312"})).status,429);
});
test("no unauthenticated access with malformed PIN or large requests",async()=>{
 const f=fixture();await f.activate();
 assert.equal((await f.call({licenseCode:license,pin:312})).status,400);
 assert.equal((await f.call({licenseCode:license,pin:"312",padding:"x".repeat(1100)})).status,413);
});

test("resolve must refuse new browser if Cloudflare rate-limit binding is unavailable",async()=>{
 const f=fixture();await f.activate();
 delete f.env.MAESTRO_IP;
 const r=await f.call({licenseCode:license,pin:"312"});
 assert.equal(r.status,503);
 assert.equal(r.data.reason,"resolve-rate-guard-unavailable");
});
test("resolve must reject IP rate limiter before checking Owner PIN",async()=>{
 const f=fixture();await f.activate();
 f.env.MAESTRO_IP={limit:async()=>({success:false})};
 const r=await f.call({licenseCode:license,pin:"312"});
 assert.equal(r.status,429);
 assert.equal(r.data.reason,"rate-limited");
});
