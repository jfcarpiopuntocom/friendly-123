// v656: QR pairing ("Vincular un aparato nuevo"): Worker /pair/put + /pair/take y el cifrado AES-GCM del aparato.
import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {webcrypto} from "node:crypto";
import worker from "../cloudflare-worker/worker.js";
globalThis.crypto ||= webcrypto;
const lic="F123-SYNTHETIC-BUSINESS",device="synthetic-abc123",tok="a".repeat(32);
function mkEnv(){
 const kv=new Map([["inst:"+device,JSON.stringify({instanceId:device,licenseCode:lic})]]);
 return {kv,env:{MASTER_KEY:"x",LICENCIAS:{get:async k=>kv.has(k)?kv.get(k):null,put:async(k,v)=>{kv.set(k,v)},delete:async k=>{kv.delete(k)},list:async()=>({keys:[],list_complete:true})}}};
}
const call=async(env,route,body)=>{const r=await worker.fetch(new Request("https://fixture.invalid"+route,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)}),env);return {status:r.status,data:await r.json(),cc:r.headers.get("cache-control")};};
test("put rejects a device that is not in the license",async()=>{
 const {env,kv}=mkEnv();
 const r=await call(env,"/pair/put",{licenseCode:lic,instanceId:"other-device-1",tokenId:tok,blob:"abc"});
 assert.equal(r.status,404);assert.equal(r.data.reason,"license-instance-mismatch");assert.equal(kv.has("pair:"+tok),false);
 const r2=await call(env,"/pair/put",{licenseCode:"F123-SOMEONE-ELSE-XX",instanceId:device,tokenId:tok,blob:"abc"});
 assert.equal(r2.status,404);
});
test("put accepts matching device; take returns blob once, then 404",async()=>{
 const {env}=mkEnv();
 const p=await call(env,"/pair/put",{licenseCode:lic.toLowerCase()+" ",instanceId:device,tokenId:tok,blob:"Zm9v-_"});
 assert.equal(p.status,200);assert.equal(p.data.ok,true);assert.equal(p.cc,"no-store");
 const t=await call(env,"/pair/take",{tokenId:tok,licenseCode:lic});
 assert.equal(t.status,200);assert.equal(t.data.blob,"Zm9v-_");
 assert.equal((await call(env,"/pair/take",{tokenId:tok,licenseCode:lic})).status,404);
});
test("take with wrong license or missing/expired token is 404 and keeps the token",async()=>{
 const {env,kv}=mkEnv();
 await call(env,"/pair/put",{licenseCode:lic,instanceId:device,tokenId:tok,blob:"abc"});
 assert.equal((await call(env,"/pair/take",{tokenId:tok,licenseCode:"F123-SOMEONE-ELSE-XX"})).status,404);
 assert.equal(kv.has("pair:"+tok),true);
 assert.equal((await call(env,"/pair/take",{tokenId:"b".repeat(32),licenseCode:lic})).data.reason,"expired");
 kv.delete("pair:"+tok); // KV TTL de 600 s vencido
 assert.equal((await call(env,"/pair/take",{tokenId:tok,licenseCode:lic})).status,404);
});
test("put validates field shapes and size",async()=>{
 const {env}=mkEnv();
 assert.equal((await call(env,"/pair/put",{licenseCode:lic,instanceId:device,tokenId:"zz",blob:"abc"})).status,400);
 assert.equal((await call(env,"/pair/put",{licenseCode:lic,instanceId:device,tokenId:tok,blob:"a".repeat(4097)})).status,400);
});
test("AES-GCM helper round-trips and rejects a wrong key",async()=>{
 const src=readFileSync(new URL("../docs/auth-ui.js",import.meta.url),"utf8");
 const code=src.slice(src.indexOf("PAIR-HELPERS-BEGIN"),src.indexOf("PAIR-HELPERS-END"));
 const win={};new Function("window",code.slice(code.indexOf("(function"),code.lastIndexOf("})();")+5))(win);
 const payload={v:1,owner:"318",emp:"",acct:"",ownerPinTs:1234};
 const c=await win.OCPair.cifrar(payload);
 assert.match(c.tokenId,/^[a-f0-9]{32}$/);assert.match(c.blob,/^[A-Za-z0-9_-]+$/);assert.ok(c.blob.length<4096);
 assert.deepEqual(await win.OCPair.descifrar(c.blob,c.keyB64),payload);
 const other=await win.OCPair.cifrar(payload);
 await assert.rejects(()=>win.OCPair.descifrar(c.blob,other.keyB64));
});
