import {test} from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {createMailboxYjs} from '../docs/mailbox-bridge.mjs';
import {mailboxPublicRoute,mailboxDoRoute} from '../cloudflare-worker/mailbox-api.mjs';

globalThis.crypto||=webcrypto;
const require=createRequire(import.meta.url),{browser}=require('./helpers/browser.cjs');
const vendor=fs.readFileSync(new URL('../docs/vendor/yjs-bundle.min.js',import.meta.url),'utf8');
const license='F123-SYNTHETIC-MAILBOX',room='a'.repeat(40),pin='123';
function storage(){
 const rows=new Map();
 const clone=x=>x===undefined?undefined:structuredClone(x);
 const tx={get:async k=>clone(rows.get(k)),put:async(k,v)=>{rows.set(k,clone(v))},
   list:async({prefix='',startAfter='',limit=100})=>new Map(
     [...rows].filter(([k])=>k.startsWith(prefix)&&k>startAfter)
       .sort(([a],[b])=>a.localeCompare(b)).slice(0,limit).map(([k,v])=>[k,clone(v)]))};
 return {...tx,transaction:async fn=>fn(tx)};
}
function localStore(){
 const pending=new Map(),inbox=new Map(),stamps=new Map();let cursor=0;
 return {enqueue:async x=>{pending.set(x.eventId,structuredClone(x))},
   enqueueBatch:async(frames,seed)=>{for(const x of frames)pending.set(x.eventId,structuredClone(x));
     if(seed)stamps.set(seed.channel,seed.digest)},
   seedDigest:async channel=>stamps.get(channel),
   pending:async()=>[...pending.values()].map(x=>structuredClone(x)),
   sent:async id=>{pending.delete(id)},
   inbox:async()=>[...inbox.values()].map(x=>structuredClone(x)),
   cursor:async()=>cursor,
   received:async(x,c)=>{inbox.set(x.sequence,structuredClone(x));cursor=c;},
   check:()=>({pending:pending.size,inbox:inbox.size,cursor})};
}
function setup(){
 const dbs=new Map(),env={PIN_PEPPER:'synthetic-owner-pepper-has-at-least-32-bytes',
   REGISTROS:{},MAILBOXES:{},MAILBOX_CANARY_LICENSE_CODE:license};
 const auth={fetch:async(_,options)=>{
   const cmd=JSON.parse(options.body);
   const v=cmd.action==='verify'?
     (cmd.licenseCode===license&&cmd.pin===pin?{ok:true,revision:1}:{ok:false,reason:'invalid-pin'}):
     {configured:true,revision:1};
   return new Response(JSON.stringify(v),{status:v.ok===false?401:200});
 }};
 const hook={getPinDo:()=>auth,getMailboxDo:(_,lic)=>({fetch:(u,opt)=>{
   if(!dbs.has(lic))dbs.set(lic,storage());
   return mailboxDoRoute(new Request(u,opt),dbs.get(lic));
 }})};
 let lostAck=false,lost=false;
 const fetchFn=async(url,opt)=>{
   const response=await mailboxPublicRoute(new Request(url,opt),env,hook);
   if(lostAck&&!lost&&new URL(url).pathname==='/mailbox/events'&&opt.method==='POST'){
     lost=true;throw Error('simulated lost transport ACK after commit');
   }
   return response;
 };
 return {fetchFn,loseAck:()=>{lostAck=true},dbs};
}
function replica(device,key,fetchFn,store=localStore(),actualRoom=room){
 const ctx=browser();Object.assign(ctx,{crypto:webcrypto,TextEncoder,TextDecoder});
 vm.runInContext(vendor,ctx);
 const Y=ctx.Y,docs={catalogo:new Y.Doc(),ops:new Y.Doc(),fotos:new Y.Doc()};
 const client=createMailboxYjs({licenseCode:license,roomId:actualRoom,deviceId:device,key,Y,
   docs,store,fetchFn,cryptoApi:webcrypto});
 return {Y,docs,client,store,close:()=>{client.stop();Object.values(docs).forEach(d=>d.destroy())}};
}
async function key(){return webcrypto.subtle.generateKey({name:'AES-GCM',length:256},false,['encrypt','decrypt'])}
const A='synthetic_device_A1',B='synthetic_device_B2';
test('real Yjs: encrypted catalogue+sale+large photo A shuts down, B opens later',async()=>{
 const relay=setup(),shared=await key();
 const a=replica(A,shared,relay.fetchFn);
 await a.client.login(pin);
 const product=JSON.stringify({id:'synth-p',stockBase:8,stockEpochId:'test-epoch',stockPN:{deviceA:{add:0,sub:3}}});
 a.docs.catalogo.getMap('productos').set('synth-p',product);
 a.docs.ops.getMap('eventos').set('sale-one',JSON.stringify({id:'sale-one',productId:'synth-p',qty:3}));
 const photo='data:image/png;base64,'+'Z'.repeat(90000);
 a.docs.fotos.getMap('blobs').set('synthetic-photo-hash',photo);
 const result=await a.client.flush();assert.equal(result.ok,true);
 assert.ok(result.sent>=6,'photo split, catalogue and sale all persisted');
 assert.equal(a.store.check().pending,0);
 a.close();
 const b=replica(B,shared,relay.fetchFn);await b.client.login(pin);
 const resultB=await b.client.pull();
 assert.equal(resultB.complete,true);
 assert.equal(b.docs.catalogo.getMap('productos').get('synth-p'),product);
 assert.ok(b.docs.ops.getMap('eventos').has('sale-one'));
 assert.equal(b.docs.fotos.getMap('blobs').get('synthetic-photo-hash'),photo);
 const second=JSON.stringify({id:'adjust-two',productId:'synth-p',delta:1});
 b.docs.ops.getMap('eventos').set('adjust-two',second);
 await b.client.flush();b.close();
 const reboot=replica(A,shared,relay.fetchFn);
 await reboot.client.login(pin);
 const got=await reboot.client.pull();
 assert.equal(got.complete,true);
 assert.equal(reboot.docs.ops.getMap('eventos').size,2);
 assert.equal(reboot.docs.ops.getMap('eventos').get('adjust-two'),second);
 assert.equal(reboot.docs.fotos.getMap('blobs').get('synthetic-photo-hash'),photo);
 reboot.close();
});
test('committed encrypted write with lost HTTP acknowledgement retransmits idempotently',async()=>{
 const relay=setup(),shared=await key(),a=replica(A,shared,relay.fetchFn);
 await a.client.login(pin);
 a.docs.ops.getMap('eventos').set('fact','{"delta":-1}');
 relay.loseAck();
 await assert.rejects(()=>a.client.flush(),/lost transport ACK/);
 assert.equal(a.store.check().pending,1,'original ciphertext retained');
 assert.deepEqual(await a.client.flush(),{ok:true,sent:1});
 assert.equal(a.store.check().pending,0);
 const b=replica(B,shared,relay.fetchFn);await b.client.login(pin);
 const got=await b.client.pull();assert.equal(got.cursor,1);
 assert.equal(b.docs.ops.getMap('eventos').size,1);
 a.close();b.close();
});
test('wrong encryption key cannot advance persistent cursor or show customer facts',async()=>{
 const relay=setup(),shared=await key(),other=await key(),a=replica(A,shared,relay.fetchFn);
 await a.client.login(pin);
 a.docs.ops.getMap('eventos').set('fact','{"delta":-1}');
 await a.client.flush();a.close();
 const b=replica(B,other,relay.fetchFn);await b.client.login(pin);
 await assert.rejects(()=>b.client.pull());
 assert.equal(b.store.check().cursor,0);
 assert.equal(b.docs.ops.getMap('eventos').size,0);
 b.close();
});
test('crash after inbox cursor commit replays ciphertext without double Yjs movement',async()=>{
 const relay=setup(),shared=await key(),a=replica(A,shared,relay.fetchFn);
 await a.client.login(pin);a.docs.ops.getMap('eventos').set('fact','{"delta":-1}');
 await a.client.flush();a.close();
 const saved=localStore(),b=replica(B,shared,relay.fetchFn,saved);await b.client.login(pin);
 const first=await b.client.pull();assert.equal(first.complete,true);
 assert.equal(saved.check().cursor,1);
 b.close();
 const restarted=replica(B,shared,relay.fetchFn,saved);await restarted.client.login(pin);
 const second=await restarted.client.pull();assert.equal(second.complete,true);
 assert.equal(restarted.docs.ops.getMap('eventos').size,1);
 restarted.close();
});


test('photo fragments are one durable batch and unchanged seeds never cause quota amplification',async()=>{
 const relay=setup(),shared=await key(),saved=localStore(),a=replica(A,shared,relay.fetchFn,saved);
 await a.client.login(pin);
 a.docs.fotos.getMap('blobs').set('big-photo','data:image/jpeg;base64,'+'A'.repeat(87000));
 await a.client.flush();
 const first=await a.client.seed();
 const afterFirst=saved.check().pending;
 assert.ok(afterFirst>=6,'all three docs seed and split photo saved');
 await a.client.seed();
 assert.equal(saved.check().pending,afterFirst,'identical seed is idempotent');
 await a.client.flush();
 assert.equal(saved.check().pending,0);
 await a.client.seed();
 assert.equal(saved.check().pending,0,'a reload or repeat seed does not requeue photos');
 a.close();
});
test('atomic local batch failure propagates and never flushes a partial photo to Worker',async()=>{
 const relay=setup(),shared=await key(),saved=localStore();
 saved.enqueueBatch=async()=>{throw Error('synthetic IndexedDB quota abort')};
 const a=replica(A,shared,relay.fetchFn,saved);
 await a.client.login(pin);
 a.docs.fotos.getMap('blobs').set('photo','X'.repeat(90000));
 await assert.rejects(()=>a.client.flush(),/quota abort/);
 assert.equal(saved.check().pending,0,'no partial encrypted frame survived');
 assert.equal(relay.dbs.size,0,'no network delivery attempted');
 a.close();
});
