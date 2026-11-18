import {test} from 'node:test';
import assert from 'node:assert/strict';
import {pinAuthority} from '../cloudflare-worker/pin-authority.mjs';
import {createWsPrincipalAuthority} from '../cloudflare-worker/ws-authorized-subject.mjs';
const license='F123-SYNT-WS01', instance='synthetic-instance';
async function setup(){
  const data=new Map();
  const storage={get:async k=>structuredClone(data.get(k)),transaction:async fn=>fn({get:async k=>structuredClone(data.get(k)),put:async(k,v)=>data.set(k,structuredClone(v)),delete:async k=>data.delete(k)})};
  const owner=pinAuthority(storage,'synthetic-only-secret-with-more-than-32-bytes');
  await owner.masterSet(license,'123',0,[instance]);await owner.masterActivate(license,'123',0,[instance]);
  let row={licenseCode:license,instanceId:instance};
  const ws=createWsPrincipalAuthority({ownerAuthority:owner,readInstance:async()=>structuredClone(row)});
  return{owner,ws,setRow:value=>{row=value;}};
}
test('real Owner authority resolves an account principal without returning PIN',async()=>{
  const {ws}=await setup();const r=await ws.resolve({licenseCode:license,instanceId:instance,pin:'123'});
  assert.equal(r.ok,true);assert.equal(r.principal.role,'dueno');assert.equal(r.principal.subject,'owner-account');
  assert.equal(r.principal.roleRevision,1);assert.equal(ws.isVerified(r.principal),true);
  assert.equal(ws.isVerified(structuredClone(r.principal)),false,'browser copy cannot forge server provenance');
  assert.equal(JSON.stringify(r).includes('123"'),false);
});
test('browser role or verifiedByBackend claim cannot authenticate any real role',async()=>{
  const {ws}=await setup();
  for(const role of ['dueno','admin','empleado','contador','artista','demo']){
    const r=await ws.resolve({licenseCode:license,instanceId:instance,role,verifiedByBackend:true});assert.equal(r.ok,false);
  }
});
test('a valid Owner PIN cannot silently elevate or alias a different requested role',async()=>{
  const {ws}=await setup();
  for(const role of ['admin','empleado','contador','artista','demo'])assert.equal((await ws.resolve({licenseCode:license,instanceId:instance,pin:'123',role})).ok,false);
});
test('missing blocked or mismatched instance cannot produce a principal',async()=>{
  const {ws,setRow}=await setup();
  for(const row of [null,{licenseCode:license,instanceId:instance,estado:'bloqueada'},{licenseCode:'F123-TEST-OTHER',instanceId:instance}]){
    setRow(row);assert.equal((await ws.resolve({licenseCode:license,instanceId:instance,pin:'123'})).ok,false);
  }
});
test('wrong PIN and authority outage fail closed without manufacturing a principal',async()=>{
  const {ws}=await setup();assert.equal((await ws.resolve({licenseCode:license,instanceId:instance,pin:'999'})).ok,false);
  const unavailable=createWsPrincipalAuthority({ownerAuthority:{verify:async()=>{throw Error('synthetic outage');}},readInstance:async()=>({licenseCode:license,instanceId:instance})});
  assert.equal((await unavailable.resolve({licenseCode:license,instanceId:instance,pin:'123'})).reason,'authority-unavailable');
});
test('a registry revocation while the PIN is being verified cancels the result',async()=>{
  const {owner}=await setup();let reads=0;
  const ws=createWsPrincipalAuthority({ownerAuthority:owner,readInstance:async()=>++reads===1?{licenseCode:license,instanceId:instance}:null});
  assert.equal((await ws.resolve({licenseCode:license,instanceId:instance,pin:'123'})).reason,'license-instance-mismatch');
});
test('a changed authority revision cannot produce a stale Owner principal',async()=>{
  const {owner}=await setup();
  const ws=createWsPrincipalAuthority({ownerAuthority:{verify:owner.verify,status:async()=>({configured:true,revision:2})},readInstance:async()=>({licenseCode:license,instanceId:instance})});
  assert.equal((await ws.resolve({licenseCode:license,instanceId:instance,pin:'123'})).reason,'authority-changed');
});
test('registry revocation during the final authority status read cancels the principal',async()=>{
  const {owner}=await setup();let row={licenseCode:license,instanceId:instance};
  const ws=createWsPrincipalAuthority({ownerAuthority:{verify:owner.verify,status:async()=>{row=null;return owner.status(license);}},readInstance:async()=>structuredClone(row)});
  assert.equal((await ws.resolve({licenseCode:license,instanceId:instance,pin:'123'})).reason,'license-instance-mismatch');
});
