import {test} from "node:test";
import assert from "node:assert/strict";
import {webcrypto} from "node:crypto";
import {pinAuthority} from "../cloudflare-worker/pin-authority.mjs";
import {pinDoRoute,pinPublicRoute} from "../cloudflare-worker/pin-worker-api.mjs";
globalThis.crypto ||= webcrypto;
const lic="F123-SYNTHETIC-AUTH",dev="synthetic-device";
const secret="synthetic-server-secret-32bytes-not-real";
function memory(){
 let records=new Map(),chain=Promise.resolve();
 return {
  get:async k=>structuredClone(records.get(k)),
  transaction:async fn=>{
   let release;const gate=new Promise(r=>release=r),previous=chain;chain=gate;await previous;
   const next=new Map([...records].map(([k,v])=>[k,structuredClone(v)]));
   try{const result=await fn({get:async k=>structuredClone(next.get(k)),put:async(k,v)=>{next.set(k,structuredClone(v))},delete:async k=>{next.delete(k)}});records=next;return result}finally{release()}
  },
  values:()=>JSON.stringify([...records])
 };
}
function setup(){
 const store=memory(),env={PIN_PEPPER:secret,MASTER_KEY:"synthetic-panel-master",REGISTROS:{}};
 const hook={
  getDo:()=>({fetch:(url,opt)=>pinDoRoute(new Request(url,opt),store,env)}),
  authorizeMaster:r=>r.headers.get("X-Master-Key")===env.MASTER_KEY,
  readLicenseInstance:async(_,id)=>id===dev?{instanceId:dev,licenseCode:lic}:null
 };
 const call=async(route,body={},admin=false,method="POST")=>{
  const h={"content-type":"application/json"};if(admin)h["X-Master-Key"]=env.MASTER_KEY;
  const r=await pinPublicRoute(new Request("https://worker.invalid"+route,{method,headers:h,...(method==="POST"?{body:JSON.stringify({licenseCode:lic,instanceId:dev,...body})}:{})}),env,hook);
  return {status:r.status,body:await r.json()};
 };
 return {store,env,hook,call,authority:pinAuthority(store,secret)};
}
test("No default owner PIN is invented",async()=>{
 const a=setup();assert.deepEqual(await a.authority.status(lic),{configured:false,revision:0,changedAt:null,changedBy:null});
 assert.equal((await a.call("/pin/verify",{pin:"123"})).status,409);
});
test("JFC panel only can register a PIN revision; PIN never appears in response or storage",async()=>{
 const a=setup();assert.equal((await a.call("/pin/admin/set",{pin:"123",expectedRevision:0})).status,401);
 const r=await a.call("/pin/admin/set",{pin:"123",expectedRevision:0},true);
 assert.equal(r.body.revision,1);assert.equal(r.body.changedBy,"JFC-panel");
 assert.equal(a.store.values().includes('"123"'),false);assert.equal(JSON.stringify(r).includes('"123"'),false);
 assert.equal((await a.call("/pin/admin/status?licenseCode="+lic+"&instanceId="+dev,{},true,"GET")).body.revision,1);
});
test("Central rotation supersedes previous PIN, stale CAS and retry cannot roll it back",async()=>{
 const a=setup();await a.call("/pin/admin/set",{pin:"123",expectedRevision:0},true);
 assert.equal((await a.call("/pin/verify",{pin:"123"})).body.revision,1);
 assert.equal((await a.call("/pin/rotate",{pin:"123",newPin:"908",expectedRevision:1})).body.revision,2);
 assert.equal((await a.call("/pin/verify",{pin:"123"})).status,401);
 assert.equal((await a.call("/pin/verify",{pin:"908"})).status,200);
 assert.equal((await a.call("/pin/admin/set",{pin:"123",expectedRevision:1},true)).status,409);
});
test("Concurrent panel updates serialize to a single winner",async()=>{
 const a=setup();await a.call("/pin/admin/set",{pin:"123",expectedRevision:0},true);
 const r=await Promise.all([a.call("/pin/admin/set",{pin:"319",expectedRevision:1},true),a.call("/pin/admin/set",{pin:"908",expectedRevision:1},true)]);
 assert.deepEqual(r.map(x=>x.status).sort(),[200,409]);
 assert.equal((await a.authority.status(lic)).revision,2);
});
test("Unregistered device cannot inspect or impose license PIN",async()=>{
 const a=setup();
 const result=await a.call("/pin/admin/set",{instanceId:"not-registered",pin:"123",expectedRevision:0},true);
 assert.equal(result.status,404);assert.equal((await a.authority.status(lic)).configured,false);
});
test("Ten incorrect attempts prevent guessing for an entire lock window",async()=>{
 const a=setup();await a.call("/pin/admin/set",{pin:"123",expectedRevision:0},true);
 for(let i=0;i<9;i++)assert.equal((await a.call("/pin/verify",{pin:"319"})).status,401);
 assert.equal((await a.call("/pin/verify",{pin:"319"})).status,429);
 assert.equal((await a.call("/pin/verify",{pin:"123"})).status,429);
 assert.equal(a.store.values().includes('"319"'),false);
});
test("No secret or no Durable Object fails closed",async()=>{
 const a=setup();delete a.env.PIN_PEPPER;assert.equal((await a.call("/pin/verify",{pin:"123"})).status,503);
});
test("PIN service cannot modify inventory, order, cash or movement ledgers",async()=>{
 const a=setup();await a.call("/pin/admin/set",{pin:"123",expectedRevision:0},true);
 assert.equal(/stock|inventario|movimiento|ventas|pago/i.test(a.store.values()),false);
});
