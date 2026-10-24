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
  assert.equal(shipped.split('["op","ckpt","pull","ts","head"].includes').length-1,2);
  assert.ok(shipped.includes('k:"head-result"'));
});
