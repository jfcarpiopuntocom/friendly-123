'use strict';
// Synthetic E2EE handoff: high-entropy key comes from a trusted enrollment,
// never from a three-digit PIN or the envelope server.
const {test}=require('node:test'),assert=require('node:assert/strict');
const {webcrypto,createHash,randomBytes}=require('node:crypto');
const {createFeed}=require('../lab/license-feed/contract.cjs');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const auth={opera:{licenseId:'F123-TEST',notebookId:'book-1',deviceId:'opera',pinRevision:3,expiresAt:Date.now()+60000},
 pwa:{licenseId:'F123-TEST',notebookId:'book-1',deviceId:'pwa',pinRevision:3,expiresAt:Date.now()+60000}};
async function encryptedEnvelope(key,op){
 const iv=randomBytes(12),data=new TextEncoder().encode(JSON.stringify(op));
 const c=Buffer.from(await webcrypto.subtle.encrypt({name:'AES-GCM',iv},key,data));
 const payload=Buffer.concat([iv,c]);
 return {opId:op.eventId,notebookId:'book-1',sha256:hash(payload),parents:[],ciphertext:payload.toString('base64')};
}
async function decrypt(key,event){
 const payload=Buffer.from(event.ciphertext,'base64'),iv=payload.subarray(0,12),data=payload.subarray(12);
 const result=await webcrypto.subtle.decrypt({name:'AES-GCM',iv},key,data);
 return JSON.parse(new TextDecoder().decode(result));
}
test('Opera to PWA replay: E2EE movement decrypts to identical causal content after enrolling same high-entropy business key',async()=>{
 const storage={};
 const f=createFeed({storage,authorize:token=>auth[token]||null});
 const key=await webcrypto.subtle.generateKey({name:'AES-GCM',length:256},true,['encrypt','decrypt']);
 const op={eventId:'movement-01',productId:'book-test',delta:-1,kind:'FULFILL',causes:['order-01']};
 const ciphertext=await encryptedEnvelope(key,op);
 const receipt=f.append('opera',ciphertext);
 assert.equal(receipt.durable,false,'lab transport does not prove disk durability');
 const received=f.page('pwa');
 assert.equal(received.envelopes.length,1);
 assert.deepEqual(await decrypt(key,received.envelopes[0]),op);
 const wrongKey=await webcrypto.subtle.generateKey({name:'AES-GCM',length:256},true,['encrypt','decrypt']);
 await assert.rejects(decrypt(wrongKey,received.envelopes[0]));
 assert.equal(Object.hasOwn(received.envelopes[0],'productId'),false,'server stores no plaintext product metadata');
});
