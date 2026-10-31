import {test} from "node:test";
import assert from "node:assert/strict";
import {webcrypto} from "node:crypto";
import worker,{RegistroLicencias} from "../cloudflare-worker/worker.js";
globalThis.crypto ||= webcrypto;
const lic="F123-SYNTHETIC-BUSINESS",device="synthetic-abc123";
function memory(){
 let data=new Map([["inst:"+device,{instanceId:device,licenseCode:lic,estado:"full"}]]);
 return {get:async key=>structuredClone(data.get(key)),
 put:async(key,v)=>{data.set(key,structuredClone(v))},
 delete:async key=>{data.delete(key)},
 transaction:async fn=>{
  const original=new Map([...data].map(([k,v])=>[k,structuredClone(v)]));
  const result=await fn({get:async k=>structuredClone(original.get(k)),put:async(k,v)=>{original.set(k,structuredClone(v))},delete:async k=>{original.delete(k)}});
  data=original;return result
 },serialize:()=>JSON.stringify([...data])};
}
test("full Worker route and real Durable Object enforce JFC PIN override and device/license binding",async()=>{
 const storage=memory(),env={
  MASTER_KEY:"synthetic-master-key",PIN_PEPPER:"synthetic-unrelated-private-server-key-32chars",
  LICENCIAS:{get:async()=>null},
  REGISTROS:{idFromName:()=>({}),get:()=>stub}
 };
 const instance=new RegistroLicencias({storage},env);
 const stub={fetch:(url,opt)=>instance.fetch(new Request(url,opt))};
 const req=async(route,body,master=false)=>{
  const headers={"content-type":"application/json"};if(master)headers["X-Master-Key"]=env.MASTER_KEY;
  const response=await worker.fetch(new Request("https://fixture.invalid"+route,{method:"POST",headers,body:JSON.stringify({licenseCode:lic,instanceId:device,...body})}),env);
  return {status:response.status,data:await response.json()};
 };
 assert.equal((await req("/pin/admin/set",{pin:"318",expectedRevision:0})).status,401);
 const first=await req("/pin/admin/set",{pin:"318",expectedRevision:0},true);
 assert.equal(first.status,200);assert.equal(first.data.revision,1);
 assert.equal((await req("/pin/verify",{pin:"318"})).status,200);
 const override=await req("/pin/admin/set",{pin:"521",expectedRevision:1},true);
 assert.equal(override.data.revision,2);
 assert.equal((await req("/pin/verify",{pin:"318"})).status,401);
 assert.equal((await req("/pin/verify",{pin:"521"})).status,200);
 assert.equal((await req("/pin/verify",{instanceId:"unregistered-device",pin:"521"})).status,404);
 assert.equal(storage.serialize().includes('"318"'),false);
 assert.equal(storage.serialize().includes('"521"'),false);
 assert.doesNotMatch(storage.serialize(),/inventario|ventas|movimientos|pagos/i);
});
