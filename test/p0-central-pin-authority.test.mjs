import {test} from "node:test";
import assert from "node:assert/strict";
import {webcrypto} from "node:crypto";
import {pinAuthority} from "../cloudflare-worker/pin-authority.mjs";
import {pinDoRoute,pinPublicRoute} from "../cloudflare-worker/pin-worker-api.mjs";
globalThis.crypto ||= webcrypto;
const lic="F123-SYNTHETIC-AUTH",dev="synthetic-device",other="another-device";
const pepper="synthetic-server-secret-32bytes-not-real";
function memory(){
 let records=new Map(),queue=Promise.resolve();
 return {get:async k=>structuredClone(records.get(k)),
  transaction:async fn=>{
   let release;const gate=new Promise(r=>release=r),previous=queue;queue=gate;await previous;
   const next=new Map([...records].map(([k,v])=>[k,structuredClone(v)]));
   try{const result=await fn({get:async k=>structuredClone(next.get(k)),put:async(k,v)=>next.set(k,structuredClone(v)),delete:async k=>next.delete(k)});records=next;return result}
   finally{release()}
  },
  values:()=>JSON.stringify([...records])
 };
}
function setup(){
 const store=memory(),env={PIN_PEPPER:pepper,MASTER_KEY:"synthetic-panel-master",REGISTROS:{}};
 const hook={getDo:()=>({fetch:(url,opt)=>pinDoRoute(new Request(url,opt),store,env)}),
  authorizeMaster:r=>r.headers.get("X-Master-Key")===env.MASTER_KEY,
  readLicenseInstance:async(_,id)=>[dev,other].includes(id)?{instanceId:id,licenseCode:lic}:null};
 const call=async(route,body={},admin=false,method="POST")=>{
  const h={"content-type":"application/json"};if(admin)h["X-Master-Key"]=env.MASTER_KEY;
  const r=await pinPublicRoute(new Request("https://worker.invalid"+route,{method,headers:h,...(method==="POST"?{body:JSON.stringify({licenseCode:lic,instanceId:dev,...body})}:{})}),env,hook);
  return {status:r.status,body:await r.json()};
 };
 return {store,env,hook,call,authority:pinAuthority(store,pepper)};
}
async function register(a,pin="123",device=dev){const r=await a.call("/pin/report",{instanceId:device,pin});assert.equal(r.status,200);return r}
async function stage(a,pin="123",rev=0){return a.call("/pin/admin/set",{pin,expectedRevision:rev},true)}
async function activate(a,pin="123",rev=0){return a.call("/pin/admin/activate",{pin,expectedRevision:rev},true)}
test("existing clients remain locally governed until enrollment and TWO admin actions",async()=>{
 const a=setup();const before=await a.authority.status(lic);
 assert.equal(before.configured,false);assert.equal(before.phase,"collecting");
 assert.equal((await a.call("/pin/verify",{pin:"123"})).status,409);
 assert.equal((await stage(a)).status,409); // cannot skip collecting existing devices
 await register(a);
 const inventory=await a.authority.status(lic);
 assert.equal(inventory.observedDevices,1);
 assert.equal(inventory.configured,false);
 assert.equal((await a.call("/pin/verify",{pin:"123"})).status,409);
 const proposal=await stage(a);
 assert.equal(proposal.body.staged,true);assert.equal(proposal.body.pendingRevision,1);
 assert.equal(proposal.body.configured,false);
 assert.equal((await a.call("/pin/verify",{pin:"123"})).status,409); // no early lockouts
 assert.equal((await activate(a,"999")).status,409);
 assert.equal((await activate(a)).body.activated,true);
 assert.equal((await a.call("/pin/verify",{pin:"123"})).status,200);
});
test("census detects disagreement without exposing or replacing any PIN",async()=>{
 const a=setup();await register(a,"123",dev);await register(a,"384",other);
 const s=await a.authority.status(lic);
 assert.equal(s.conflictingReports,true);assert.equal(s.observedDevices,2);
 assert.equal(s.reportsVerified,false);assert.equal(a.store.values().includes('"123"'),false);
 assert.equal(a.store.values().includes('"384"'),false);
 assert.equal(s.configured,false);assert.equal(s.pendingRevision,null);
});
test("JFC panel alone stages and activates and stale revisions cannot roll back",async()=>{
 const a=setup();await register(a);
 assert.equal((await a.call("/pin/admin/set",{pin:"123",expectedRevision:0})).status,401);
 assert.equal((await a.call("/pin/admin/activate",{pin:"123",expectedRevision:0})).status,401);
 assert.equal((await stage(a)).status,200);
 assert.equal((await activate(a)).status,200);
 const updated=await a.call("/pin/admin/status?licenseCode="+lic+"&instanceId="+dev,{},true,"GET");
 assert.equal(updated.body.revision,1);assert.equal(updated.body.configured,true);
 await stage(a,"908",1);assert.equal((await a.call("/pin/verify",{pin:"123"})).status,200);
 assert.equal((await activate(a,"908",1)).body.revision,2);
 assert.equal((await a.call("/pin/verify",{pin:"123"})).status,401);
 assert.equal((await a.call("/pin/verify",{pin:"908"})).status,200);
 assert.equal((await stage(a,"123",1)).status,409);
 assert.equal(a.store.values().includes('"908"'),false);
});
test("new authenticated device may rotate, then previous device may rotate later",async()=>{
 const a=setup();await register(a);await register(a,"123",other);
 await stage(a);await activate(a);
 assert.equal((await a.call("/pin/rotate",{instanceId:other,pin:"123",newPin:"908",expectedRevision:1})).body.revision,2);
 assert.equal((await a.call("/pin/rotate",{pin:"908",newPin:"647",expectedRevision:2})).body.revision,3);
 assert.equal((await a.call("/pin/verify",{instanceId:other,pin:"647"})).status,200);
});
test("concurrent JFC proposals CAS and activation preserve the winner",async()=>{
 const a=setup();await register(a);await stage(a);await activate(a);
 const responses=await Promise.all([stage(a,"319",1),stage(a,"908",1)]);
 assert.deepEqual(responses.map(r=>r.status).sort(),[200,200]); // staging may replace a proposal before activation
 assert.equal((await activate(a,"319",1)).status===200 || (await activate(a,"908",1)).status===200,true);
 assert.equal((await a.authority.status(lic)).revision,2);
});
test("unregistered device cannot inspect, register or impose license PIN",async()=>{
 const a=setup();assert.equal((await a.call("/pin/report",{pin:"123",instanceId:"unregistered-device"})).status,404);
 assert.equal((await a.call("/pin/admin/set",{pin:"123",instanceId:"unregistered-device",expectedRevision:0},true)).status,404);
 assert.equal((await a.authority.status(lic)).configured,false);
});
test("server rejects ten wrong attempts in a bounded window",async()=>{
 const a=setup();await register(a);await stage(a);await activate(a);
 for(let i=0;i<9;i++)assert.equal((await a.call("/pin/verify",{pin:"319"})).status,401);
 assert.equal((await a.call("/pin/verify",{pin:"319"})).status,429);
 assert.equal((await a.call("/pin/verify",{pin:"123"})).status,429);
});
test("no server pepper fails closed",async()=>{const a=setup();delete a.env.PIN_PEPPER;assert.equal((await a.call("/pin/report",{pin:"123"})).status,503)});
test("PIN authority never touches products, orders, money or customer notebook",async()=>{
 const a=setup();await register(a);await stage(a);await activate(a);
 assert.doesNotMatch(a.store.values(),/stock|inventario|movimiento|ventas|pago/i);
});

test("Expired staged change is HTTP 409, never a false success or active PIN",async()=>{
 const a=setup();await register(a);
 const staged=await stage(a);assert.equal(staged.status,200);
 await a.store.transaction(async tx=>{
   const key="pin-owner-proposal:"+lic;
   const p=await tx.get(key);p.createdAt=Date.now()-16*60*1000;
   await tx.put(key,p);
 });
 const rejected=await activate(a);
 assert.equal(rejected.status,409);
 assert.equal(rejected.body.ok,false);
 assert.equal(rejected.body.reason,"expired-proposal");
 const state=await a.authority.status(lic);
 assert.equal(state.configured,false);
 assert.equal(state.pendingRevision,null);
});
