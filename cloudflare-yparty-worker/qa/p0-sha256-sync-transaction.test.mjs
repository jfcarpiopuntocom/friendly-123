// Independent oracle: Node native and WebCrypto SHA-256, including boundary frames.
// The implementation is used only for content-addressed SQL receipts in Workers.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomBytes} from 'node:crypto';
import {Sha256Sync,sha256Sync} from '../src/sha256-sync.mjs';
const hash=value=>createHash('sha256').update(value).digest('hex');
test('known SHA256 vectors and block boundaries match independent native oracle',()=>{
 const vectors=['','abc','The quick brown fox jumps over the lazy dog'];
 const boundaries=[1,15,55,56,57,63,64,65,119,120,127,128,129,256,512,4096,1048576];
 for(const len of boundaries)vectors.push(randomBytes(len));
 for(const value of vectors){
  assert.equal(sha256Sync(value),hash(value));
  const bytes=typeof value==='string'?new TextEncoder().encode(value):value;
  for(const size of [1,7,64,137]){
   const h=new Sha256Sync();
   for(let off=0;off<bytes.length;off+=size)h.update(bytes.subarray(off,off+size));
   assert.equal(h.hex(),hash(value));
  }
 }
});
test('native WebCrypto independently attests the Worker-compatible SHA256',async()=>{
 const bytes=randomBytes(210000);
 const native=await crypto.subtle.digest('SHA-256',bytes);
 assert.equal(sha256Sync(bytes),Buffer.from(native).toString('hex'));
});
test('binary transaction strings and UTF8 produce deterministic independent digest',()=>{
 const raw='id-α\0{"amountCents":123,"kind":"sale.record"}\n';
 const n=new Sha256Sync().update('id-α').update('\0').update('{"amountCents":123,"kind":"sale.record"}').update('\n').hex();
 assert.equal(n,hash(raw));
});
