const {test}=require('node:test');
const assert=require('node:assert/strict');
const {pathToFileURL}=require('node:url');
const path=require('node:path');

test('passive heartbeat after rename cannot rewind business or device names from stale KV into fresh panel',async()=>{
 const worker=await import(pathToFileURL(path.resolve(__dirname,'../cloudflare-worker/worker.js')).href);
 const id='fixture-lag-device';
 const old={instanceId:id,licenseCode:'F123-FIXTURE-LAG',nombreNegocio:'Previous shop',nombreNegocioRev:1,nombreNegocioTs:100,apodo:'Previous phone',estado:'full',lastSeen:1};
 const fresh={...old,nombreNegocio:'Confirmed shop',nombreNegocioRev:2,nombreNegocioTs:200,apodo:'Confirmed phone',lastSeen:2};
 const disk=new Map([['inst:'+id,fresh]]);
 const storage={get:async k=>disk.get(k),put:async(k,v)=>disk.set(k,v),list:async()=>new Map(disk),delete:async k=>disk.delete(k)};
 const instance=new worker.RegistroLicencias({storage},{});
 const kv=new Map([['inst:'+id,JSON.stringify(old)]]);
 const env={MASTER_KEY:'synthetic-identity-key',LICENCIAS:{get:async k=>kv.get(k)||null,put:async(k,v)=>kv.set(k,v),list:async()=>({keys:[{name:'inst:'+id}],list_complete:true})},REGISTROS:{idFromName:()=> 'fixture-singleton',get:()=>({fetch:(u,o)=>instance.fetch(new Request(u,o))})}};
 const response=await worker.default.fetch(new Request('https://fixture.invalid/checkin',{method:'POST',body:JSON.stringify({instanceId:id,accion:'salud',licenseCode:old.licenseCode})}),env);
 assert.equal(response.status,200);
 const list=await worker.default.fetch(new Request('https://fixture.invalid/licencias',{headers:{'X-Master-Key':env.MASTER_KEY}}),env);
 const row=(await list.json()).find(x=>x.instanceId===id);
 assert.equal(row.nombreNegocio,'Confirmed shop');
 assert.equal(row.nombreNegocioRev,2);
 assert.equal(row.apodo,'Confirmed phone');
 assert.equal(row.licenseCode,old.licenseCode);
 assert.ok(kv.has('inst:'+id),'KV backup remains');
});
