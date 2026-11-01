import {test} from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {mailboxPublicRoute,mailboxDoRoute} from '../cloudflare-worker/mailbox-api.mjs';
globalThis.crypto ||= webcrypto;
const license='F123-SYNTHETIC-TEST', device='synthetic_device_A1', deviceB='synthetic_device_B2';
const env={PIN_PEPPER:'synthetic-only-secret-more-than-32-bytes', REGISTROS:{},MAILBOXES:{}, MAILBOX_CANARY_LICENSE_CODE:license};
function db(){
  const rows=new Map();
  const clone=x=>x===undefined?undefined:structuredClone(x);
  const api={get:async k=>clone(rows.get(k)),put:async(k,v)=>rows.set(k,clone(v)),
    list:async({prefix='',startAfter='',limit=100})=>new Map([...rows].filter(([k])=>k.startsWith(prefix)&&k>startAfter).sort(([a],[b])=>a.localeCompare(b)).slice(0,limit).map(([k,v])=>[k,clone(v)]))};
  return {...api,transaction:async fn=>{
    const copy=new Map([...rows].map(([k,v])=>[k,clone(v)]));
    const tx={get:async k=>clone(copy.get(k)),put:async(k,v)=>{copy.set(k,clone(v));},
      list:async opts=>new Map([...copy].filter(([k])=>k.startsWith(opts.prefix||'')&&k>(opts.startAfter||'')).sort(([a],[b])=>a.localeCompare(b)).slice(0,opts.limit||100))};
    const out=await fn(tx);rows.clear();for(const [k,v] of copy)rows.set(k,v);return out;
  }};
}
const frame=(id='op-synthetic-000001',text='A'.repeat(64))=>({eventId:id,nonce:Buffer.alloc(12,8).toString('base64'),ciphertext:Buffer.from(text).toString('base64')});
function fixture(){
  let pin='123',revision=1,configured=true;const stores=new Map();
  const pinDo={fetch:async(_,init)=>{
    const b=JSON.parse(init.body);
    if(b.action==='status')return new Response(JSON.stringify({configured,revision}),{status:200});
    const ok=configured&&b.licenseCode===license&&b.pin===pin;
    return new Response(JSON.stringify(ok?{ok:true,revision}:{ok:false,reason:'invalid-pin'}),{status:ok?200:401});
  }};
  const hook={getPinDo:()=>pinDo,getMailboxDo:(_,lic)=>({fetch:(url,opts)=>{
    if(!stores.has(lic))stores.set(lic,db());
    return mailboxDoRoute(new Request(url,opts),stores.get(lic));
  }})};
  async function call(method,path,{token,body}={}){
    const headers={...(token?{Authorization:'Bearer '+token}:{}),...(body?{'content-type':'application/json'}:{})};
    const req=new Request('https://worker.example'+path,{method,headers,...(body?{body:JSON.stringify(body)}:{})});
    const r=await mailboxPublicRoute(req,env,hook);
    return {status:r.status,...await r.json()};
  }
  async function session(d=device){return call('POST','/mailbox/session',{body:{licenseCode:license,pin,deviceId:d}})};
  return {call,session,rotate:p=>{pin=p;revision++;},unconfigure:()=>{configured=false;},stores};
}
test('valid Owner login receives short-lived signed session and other PIN fails closed',async()=>{
  const f=fixture(),t=await f.session();assert.equal(t.status,200);assert.equal(t.role,'owner');assert.ok(t.token);
  const bad=await f.call('POST','/mailbox/session',{body:{licenseCode:license,pin:'999',deviceId:device}});
  assert.equal(bad.status,401);assert.equal(bad.token,undefined);
});
test('nobody without a signed ticket reads or appends',async()=>{
  const f=fixture();
  assert.equal((await f.call('GET','/mailbox/events')).status,401);
  assert.equal((await f.call('POST','/mailbox/events',{body:frame()})).status,401);
});
test('tampered signatures fail; session cannot survive a central PIN rotation',async()=>{
  const f=fixture(),t=await f.session();
  const damaged=t.token.slice(0,-5)+'abcde';
  assert.equal((await f.call('GET','/mailbox/events',{token:damaged})).status,401);
  f.rotate('456');
  assert.equal((await f.call('GET','/mailbox/events',{token:t.token})).status,401);
  const newer=await f.session();assert.equal(newer.revision,2);
  assert.equal((await f.call('GET','/mailbox/events',{token:newer.token})).status,200);
});
test('unconfigured central PIN refuses owner sessions',async()=>{
  const f=fixture();f.unconfigure();assert.equal((await f.session()).status,401);
});
test('opaque frame is persisted, paged and recoverable by a second device without A online',async()=>{
  const f=fixture(),A=await f.session(device),B=await f.session(deviceB);
  const e=frame();const write=await f.call('POST','/mailbox/events',{token:A.token,body:e});
  assert.deepEqual({status:write.status,sequence:write.sequence,duplicate:write.duplicate},{status:200,sequence:1,duplicate:false});
  const received=await f.call('GET','/mailbox/events?after=0&limit=10',{token:B.token});
  assert.equal(received.events.length,1);assert.deepEqual(received.events[0],{...e,sequence:1});
  assert.equal(received.cursor,1);assert.equal(received.hasMore,false);
});
test('event replay idempotent; identical eventId with different contents is quarantined as conflict',async()=>{
  const f=fixture(),t=await f.session(),e=frame();
  assert.equal((await f.call('POST','/mailbox/events',{token:t.token,body:e})).sequence,1);
  const again=await f.call('POST','/mailbox/events',{token:t.token,body:e});
  assert.equal(again.duplicate,true);assert.equal(again.sequence,1);
  const conflict=await f.call('POST','/mailbox/events',{token:t.token,body:{...e,ciphertext:frame('op-synthetic-000001','B'.repeat(64)).ciphertext}});
  assert.equal(conflict.status,409);
  assert.equal((await f.call('GET','/mailbox/events',{token:t.token})).latest,1);
});
test('ordered pagination with independent cursors and backfill',async()=>{
  const f=fixture(),t=await f.session();
  for(let i=1;i<=3;i++)assert.equal((await f.call('POST','/mailbox/events',{token:t.token,body:frame('op-synthetic-'+String(i).padStart(6,'0'))})).status,200);
  const a=await f.call('GET','/mailbox/events?after=0&limit=2',{token:t.token});
  assert.deepEqual(a.events.map(x=>x.sequence),[1,2]);assert.equal(a.hasMore,true);
  const b=await f.call('GET','/mailbox/events?after='+a.cursor+'&limit=2',{token:t.token});
  assert.deepEqual(b.events.map(x=>x.sequence),[3]);assert.equal(b.hasMore,false);
});
test('ACK never deletes history, and old cursor cannot lower acknowledged position',async()=>{
  const f=fixture(),t=await f.session(),u=await f.session(deviceB);
  await f.call('POST','/mailbox/events',{token:t.token,body:frame()});
  assert.equal((await f.call('POST','/mailbox/ack',{token:u.token,body:{cursor:1}})).cursor,1);
  assert.equal((await f.call('POST','/mailbox/ack',{token:u.token,body:{cursor:0}})).cursor,1);
  assert.equal((await f.call('POST','/mailbox/ack',{token:u.token,body:{cursor:2}})).status,409);
  assert.equal((await f.call('GET','/mailbox/events?after=0',{token:u.token})).events.length,1);
});
test('server rejects plaintext-looking payload, arbitrary fields and oversized ciphertext',async()=>{
  const f=fixture(),t=await f.session(),e=frame();
  for(const invalid of [{eventId:e.eventId,plaintext:'a sale'},
    {...e,nonce:'z'}, {...e,note:'private'}, {...e,ciphertext:Buffer.alloc(65540).toString('base64')}]){
    assert.equal((await f.call('POST','/mailbox/events',{token:t.token,body:invalid})).status,400);
  }
});
test('unknown method and malformed cursors rejected',async()=>{
  const f=fixture(),t=await f.session();
  assert.equal((await f.call('DELETE','/mailbox/events',{token:t.token})).status,405);
  assert.equal((await f.call('GET','/mailbox/events?after=-5',{token:t.token})).status,400);
  assert.equal((await f.call('GET','/mailbox/events?limit=1000',{token:t.token})).status,400);
});
test('another license cannot read any bytes from the original license DO',async()=>{
  const f=fixture(),t=await f.session(),other='F123-SYNTHETIC-OTHER';
  await f.call('POST','/mailbox/events',{token:t.token,body:frame()});
  const otherStorage=db();
  const response=await mailboxDoRoute(new Request('https://do.invalid/mailbox/internal',{method:'POST',body:JSON.stringify({action:'append',licenseCode:other,envelope:frame('op-synthetic-other-01')})}),otherStorage);
  assert.equal(response.status,200);
  const wrong=await mailboxDoRoute(new Request('https://do.invalid/mailbox/internal',{method:'POST',body:JSON.stringify({action:'pull',licenseCode:license,after:0,limit:5})}),otherStorage);
  assert.equal(wrong.status,403);
});
test('independent A and B sessions transfer real AES-256-GCM bytes, decrypt only on B',async()=>{
  const f=fixture();
  const symmetric=await crypto.subtle.generateKey({name:'AES-GCM',length:256},false,['encrypt','decrypt']);
  const nonce=crypto.getRandomValues(new Uint8Array(12));
  const original={eventId:'sale-synthetic-000001',product:'product-synthetic',delta:-1,amountCents:1200};
  const plain=new TextEncoder().encode(JSON.stringify(original));
  const cipher=await crypto.subtle.encrypt({name:'AES-GCM',iv:nonce},symmetric,plain);
  const envelope={eventId:'op-synthetic-aes-0001',nonce:Buffer.from(nonce).toString('base64'),
    ciphertext:Buffer.from(cipher).toString('base64')};
  const A=await f.session(device);
  const upload=await f.call('POST','/mailbox/events',{token:A.token,body:envelope});
  assert.equal(upload.status,200);
  const B=await f.session(deviceB);
  const download=await f.call('GET','/mailbox/events?after=0',{token:B.token});
  assert.equal(download.events.length,1);
  const received=download.events[0];
  const bytes=await crypto.subtle.decrypt({name:'AES-GCM',iv:Buffer.from(received.nonce,'base64')},
    symmetric,Buffer.from(received.ciphertext,'base64'));
  assert.deepEqual(JSON.parse(new TextDecoder().decode(bytes)),original);
  assert.equal(JSON.stringify(received).includes('product-synthetic'),false,
    'DO never stores visible product/amount plaintext');
  const tampered=Buffer.from(received.ciphertext,'base64');tampered[tampered.length-1]^=1;
  await assert.rejects(()=>crypto.subtle.decrypt({name:'AES-GCM',iv:nonce},symmetric,tampered));
});


test('P0 actual Yjs journal: A closes, B recovers encrypted facts, B writes, A reopens idempotently',async()=>{
  const fs=await import('node:fs'),vm=await import('node:vm');
  const {createRequire}=await import('node:module');
  const require=createRequire(import.meta.url);
  const {browser}=require('./helpers/browser.cjs');
  const vendor=fs.readFileSync(new URL('../docs/vendor/yjs-bundle.min.js',import.meta.url),'utf8');
  function instance(){
    const context=browser();
    Object.assign(context,{crypto:webcrypto,TextEncoder,TextDecoder});
    vm.runInContext(vendor,context);
    assert.ok(context.Y&&context.Y.Doc&&context.Y.encodeStateAsUpdate);
    return {Y:context.Y,doc:new context.Y.Doc()};
  }
  const f=fixture(),key=await crypto.subtle.generateKey({name:'AES-GCM',length:256},false,['encrypt','decrypt']);
  const A=instance();
  // Real Y.Doc events, not inventory snapshots or manually forced quantities.
  const eventA={id:'movement-A-001',kind:'RECEIVE',productId:'product-007',qty:8};
  A.doc.getMap('movement-journal').set(eventA.id,JSON.stringify(eventA));
  async function push(device,doc,id){
    const auth=await f.session(device),nonce=crypto.getRandomValues(new Uint8Array(12));
    assert.equal(auth.status,200);
    const bytes=doc.Y.encodeStateAsUpdate(doc.doc);
    const cipher=await crypto.subtle.encrypt({name:'AES-GCM',iv:nonce},key,bytes);
    const envelope={eventId:id,nonce:Buffer.from(nonce).toString('base64'),
      ciphertext:Buffer.from(cipher).toString('base64')};
    const sent=await f.call('POST','/mailbox/events',{token:auth.token,body:envelope});
    assert.equal(sent.status,200);return sent.sequence;
  }
  async function recover(device){
    const session=await f.session(device);assert.equal(session.status,200);
    const restored=instance(),page=await f.call('GET','/mailbox/events?after=0&limit=50',{token:session.token});
    assert.equal(page.status,200);
    for(const ev of page.events){
      const clear=await crypto.subtle.decrypt({name:'AES-GCM',
        iv:Buffer.from(ev.nonce,'base64')},key,Buffer.from(ev.ciphertext,'base64'));
      restored.Y.applyUpdate(restored.doc,new Uint8Array(clear),'encrypted-mailbox');
    }
    return {restored,session,page};
  }
  await push(device,A,'op-yjs-p0-transfer-A-001');
  // A shuts down. B is a fresh Y.Doc: only mailbox ciphertext survives.
  A.doc.destroy();
  const B=await recover(deviceB);
  assert.equal(B.restored.doc.getMap('movement-journal').size,1);
  B.restored.doc.getMap('movement-journal').set('movement-B-001',
    JSON.stringify({id:'movement-B-001',kind:'FULFILL',productId:'product-007',qty:3,orderId:'order-01'}));
  await push(deviceB,B.restored,'op-yjs-p0-transfer-B-001');
  B.restored.doc.destroy();
  // A restarts from an empty document, reads both encrypted updates.
  const Aagain=await recover(device);
  const events=[...Aagain.restored.doc.getMap('movement-journal').values()].map(JSON.parse);
  assert.equal(events.length,2);
  const stock=events.reduce((sum,e)=>sum+(e.kind==='RECEIVE'?e.qty:e.kind==='FULFILL'?-e.qty:0),0);
  assert.equal(stock,5,'8 received - 3 fulfilled, never forced to a snapshot');
  const duplicate=await recover(device);
  assert.deepEqual([...duplicate.restored.doc.getMap('movement-journal').keys()].sort(),
    [...Aagain.restored.doc.getMap('movement-journal').keys()].sort());
  assert.equal(duplicate.page.latest,2,'one write per unique envelope; no network overlap');
  Aagain.restored.doc.destroy();duplicate.restored.doc.destroy();
});


test('zero-cursor ACK from same device is idempotent and does not consume capacity',async()=>{
  const store=db();
  const append=await mailboxDoRoute(new Request('https://do.invalid/mailbox/internal',{
    method:'POST',body:JSON.stringify({action:'append',licenseCode:license,envelope:frame()})}),store);
  assert.equal(append.status,200);
  for(let i=0;i<75;i++){
    const ack=await mailboxDoRoute(new Request('https://do.invalid/mailbox/internal',{
      method:'POST',body:JSON.stringify({action:'ack',licenseCode:license,
        deviceId:device,cursor:0})}),store);
    assert.equal(ack.status,200,'repeat '+i);
  }
  assert.equal(await store.get('ack-count'),1,'one physical device uses one capacity slot');
  const other=await mailboxDoRoute(new Request('https://do.invalid/mailbox/internal',{
    method:'POST',body:JSON.stringify({action:'ack',licenseCode:license,
      deviceId:deviceB,cursor:0})}),store);
  assert.equal(other.status,200);
  assert.equal(await store.get('ack-count'),2);
});

test('mailbox unavailable without explicit canary and denies other shops before DO work',async()=>{
 const f=fixture();
 const request=new Request('https://worker.example/mailbox/session',{method:'POST',
   headers:{'content-type':'application/json'},body:JSON.stringify({
     licenseCode:license,pin:'123',deviceId:device})});
 const disabled=await mailboxPublicRoute(request,{...env,MAILBOX_CANARY_LICENSE_CODE:''},{
   getPinDo:()=>null,getMailboxDo:()=>null});
 assert.equal(disabled.status,503);
 const outside=new Request('https://worker.example/mailbox/session',{method:'POST',
   headers:{'content-type':'application/json'},body:JSON.stringify({
     licenseCode:'F123-OTHER-SYNTHETIC',pin:'123',deviceId:device})});
 const blocked=await mailboxPublicRoute(outside,env,{
   getPinDo:()=>{throw Error('should not query central PIN for other shops')},
   getMailboxDo:()=>{throw Error('should not create DO for other shops')}});
 assert.equal(blocked.status,403);
 assert.equal((await f.session()).status,200,'explicit synthetic pilot works');
});
