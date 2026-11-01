'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');
const source=fs.readFileSync(path.join(root,'supabase-relay/transport.mjs'),'utf8');
const shipped=fs.readFileSync(path.join(root,'docs/vendor/supabase-relay.min.js'),'utf8');
test('E1: shipped browser relay includes source HEAD probe',()=>{
  assert.match(source,/'head-result'/);
  // S0 (PR #534): the active command whitelist remains singular; durable writes and pulls now have separate lanes.
  assert.equal(shipped.split('["op","ckpt","pull","ts","head"].includes').length-1,1);
  assert.ok(shipped.includes('["op","ckpt"].includes'), 'op/ckpt retain their ordered durable lane');
  assert.ok(shipped.includes('["pull","ts","head"].includes'), 'pull/head/ts get an independent read lane');
  assert.ok(shipped.includes('k:"head-result"'));
  assert.match(source,/MAX_CKPT_FRAME = 1088 \* 1024/);
  assert.match(source,/export const CKPT_CIPHER_BYTES = 768 \* 1024/);
  assert.ok(shipped.includes('ckptFrameBytes=786432'), 'shipped adapter advertises exact ciphertext capability');
  assert.ok(shipped.includes('1114112'), 'shipped transport has the larger RPC-only checkpoint frame cap');
});
