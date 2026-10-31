'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {createHash}=require('node:crypto');
const {createFeed,MAX_BYTES}=require('../lab/license-feed/contract.cjs');
const hash=b=>createHash('sha256').update(b).digest('hex');
const now=Date.now()+60000;
const accounts={
 a:{licenseId:'F123-SYNTHETIC-A',notebookId:'book-A',deviceId:'opera',pinRevision:2,expiresAt:now},
 b:{licenseId:'F123-SYNTHETIC-A',notebookId:'book-A',deviceId:'safari',pinRevision:2,expiresAt:now},
 c:{licenseId:'F123-SYNTHETIC-A',notebookId:'book-A',deviceId:'pwa',pinRevision:2,expiresAt:now},
 x:{licenseId:'F123-SYNTHETIC-B',notebookId:'book-B',deviceId:'stranger',pinRevision:1,expiresAt:now}
};
function setup(){const storage={};const authorize=t=>accounts[t]||null;
 return {a:createFeed({authorize,storage}),b:createFeed({authorize,storage}),storage};}
function envelope(opId,nb='book-A',message='ciphertext-only'){
 const raw=Buffer.from(message,'utf8');
 return {notebookId:nb,opId,ciphertext:raw.toString('base64'),sha256:hash(raw),parents:[]};
}
test('one enrolled license: Opera->Safari->PWA see identical operations through two gateways',()=>{
 const {a,b}=setup();
 const first=a.append('a',envelope('valid-event-01'));
 assert.equal(first.seq,1);assert.equal(first.durable,false,'lab cannot masquerade as disk durable');
 assert.deepEqual(b.page('b').envelopes,a.page('c').envelopes);
 assert.equal(b.append('b',envelope('valid-event-01')).duplicate,true);
 assert.equal(a.page('a').envelopes.length,1);
});
test('an offline Safari can replay in ordered pages after other replicas add events',()=>{
 const {a,b}=setup();
 for(let i=0;i<5;i++)a.append('a',envelope('event-key-'+i));
 let cursor=0,received=[];
 do{
  const page=b.page('b',{after:cursor,limit:2});
  received=received.concat(page.envelopes);
  cursor=page.cursor;
  if(!page.hasMore)break;
 }while(true);
 assert.deepEqual(received.map(x=>x.seq),[1,2,3,4,5]);
 assert.equal(b.page('c',{after:cursor}).envelopes.length,0);
});
test('authorization, business scoping, token expiry and forged cross-business notebook fail closed',()=>{
 const {a}=setup();
 assert.throws(()=>a.page('nobody'),/unauthorized/);
 assert.throws(()=>a.append('x',envelope('valid-event-02')),/invalid-envelope/);
 assert.equal(a.page('x').envelopes.length,0);
 accounts.expired={...accounts.a,deviceId:'expired',expiresAt:Date.now()-1000};
 assert.throws(()=>a.page('expired'),/unauthorized/);
 delete accounts.expired;
});
test('same opId cannot rewrite encrypted event content or impersonate another operation',()=>{
 const {a}=setup();
 a.append('a',envelope('valid-event-01'));
 assert.throws(()=>a.append('b',envelope('valid-event-01','book-A','different bytes')),/event-id-conflict/);
 const e=envelope('valid-event-02');e.sha256='0'.repeat(64);
 assert.throws(()=>a.append('b',e),/invalid-encrypted-payload/);
 assert.equal(a.page('c').envelopes.length,1);
});
test('bounded messages, honest ACK semantics and monotonic receipts',()=>{
 const {a}=setup();
 const large=envelope('valid-event-03','book-A','a'.repeat(MAX_BYTES+1));
 assert.throws(()=>a.append('a',large),/invalid-encrypted-payload/);
 a.append('a',envelope('valid-event-04'));
 const ack=a.receipt('b',{cursor:1,appliedDigest:'1'.repeat(64)});
 assert.equal(ack.allReplicasApplied,false);
 assert.throws(()=>a.receipt('b',{cursor:2,appliedDigest:'1'.repeat(64)}),/invalid-receipt/);
 assert.throws(()=>a.receipt('b',{cursor:-1,appliedDigest:'1'.repeat(64)}),/invalid-receipt/);
});
test('provider fallback is same storage; two separate storage objects cannot claim convergence',()=>{
 const {a,b}=setup();
 a.append('a',envelope('valid-event-05'));
 assert.equal(b.page('b').envelopes[0].opId,'valid-event-05');
 const rogue=createFeed({authorize:t=>accounts[t]||null,storage:{}});
 assert.equal(rogue.page('b').envelopes.length,0);
 assert.notDeepEqual(rogue.page('b').envelopes,b.page('b').envelopes);
});
test('never accept raw PIN, license or personally identifying business data as plaintext event metadata',()=>{
 const {a}=setup(),e=envelope('valid-event-06');
 assert.throws(()=>a.append('a',{...e,pin:'123'}),/invalid-envelope/);
 assert.throws(()=>a.append('a',{...e,customerName:'Private customer'}),/invalid-envelope/);
 assert.throws(()=>a.append('a',{...e,licenseCode:'F123-SYNTHETIC-A'}),/invalid-envelope/);
});
