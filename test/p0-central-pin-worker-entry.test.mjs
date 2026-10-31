import {test} from "node:test";
import assert from "node:assert/strict";
import {webcrypto} from "node:crypto";
import worker,{RegistroLicencias} from "../cloudflare-worker/worker.js";
globalThis.crypto ||= webcrypto;
const lic="F123-SYNTHETIC-BUSINESS",device="synthetic-abc123";
function memory(){
 let data=new Map([device,"synthetic-mobile"].map(instanceId=>["inst:"+instanceId,{instanceId,licenseCode:lic,estado:"full"}]));
 return {get:async key=>structuredClone(data.get(key)),
 list:async({prefix="",startAfter}={})=>new Map([...data].filter(([key])=>key.startsWith(prefix)&&(!startAfter||key>startAfter))),
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
  LICENCIAS:{
   get:async key=>{
    const records={["inst:"+device]:{instanceId:device,licenseCode:lic,estado:"full"},
      "inst:synthetic-mobile":{instanceId:"synthetic-mobile",licenseCode:lic,estado:"full"}};
    return records[key]?JSON.stringify(records[key]):null;
   },
   list:async()=>({keys:[{name:"inst:"+device},{name:"inst:synthetic-mobile"}],list_complete:true})
  },
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
 assert.equal((await req("/pin/verify",{pin:"318"})).status,409,"legacy login must remain unaffected before staging");
 assert.equal((await req("/pin/admin/set",{pin:"318",expectedRevision:0},true)).status,409,"no forced PIN before device enrollment");
 assert.equal((await req("/pin/report",{pin:"318"})).status,200);
 const incomplete=await req("/pin/admin/set",{pin:"318",expectedRevision:0},true);
 assert.equal(incomplete.status,409,"one of two registered devices may not be silently skipped");
 assert.equal(incomplete.data.reason,"census-incomplete");
 assert.equal((await req("/pin/report",{instanceId:"synthetic-mobile",pin:"318"})).status,200);
 const first=await req("/pin/admin/set",{pin:"318",expectedRevision:0},true);
 assert.equal(first.status,200);assert.equal(first.data.pendingRevision,1);
 assert.equal(first.data.configured,false);
 assert.equal((await req("/pin/verify",{pin:"318"})).status,409,"staging must not revoke client PIN");
 const activation=await req("/pin/admin/activate",{pin:"318",expectedRevision:0},true);
 assert.equal(activation.status,200);assert.equal(activation.data.revision,1);
 assert.equal((await req("/pin/verify",{pin:"318"})).status,200);
 const proposal=await req("/pin/admin/set",{pin:"521",expectedRevision:1},true);
 assert.equal(proposal.data.pendingRevision,2);
 assert.equal((await req("/pin/verify",{pin:"318"})).status,200);
 const override=await req("/pin/admin/activate",{pin:"521",expectedRevision:1},true);
 assert.equal(override.data.revision,2);
 assert.equal((await req("/pin/verify",{pin:"318"})).status,401);
 assert.equal((await req("/pin/verify",{pin:"521"})).status,200);
 // Authority belongs to the license, not permanently to the mobile device.
 // Whichever authenticated device rotates later moves the shared revision.
 const mobile=await req("/pin/rotate",{instanceId:"synthetic-mobile",pin:"521",newPin:"704",expectedRevision:2});
 assert.equal(mobile.status,200);
 assert.equal(mobile.data.revision,3);
 assert.equal((await req("/pin/verify",{pin:"521"})).status,401);
 const desktop=await req("/pin/rotate",{pin:"704",newPin:"819",expectedRevision:3});
 assert.equal(desktop.status,200);
 assert.equal(desktop.data.revision,4);
 assert.equal((await req("/pin/verify",{instanceId:"synthetic-mobile",pin:"819"})).status,200);
 assert.equal((await req("/pin/verify",{pin:"819"})).status,200);
 assert.equal((await req("/pin/verify",{instanceId:"unregistered-device",pin:"521"})).status,404);
 assert.equal(storage.serialize().includes('"318"'),false);
 assert.equal(storage.serialize().includes('"521"'),false);
 assert.doesNotMatch(storage.serialize(),/inventario|ventas|movimientos|pagos/i);
});
