'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const read=rel=>fs.readFileSync(path.join(__dirname,'..',rel),'utf8');
test('P0 browser app and dashboard load encrypted durable native relay before all sync clients',()=>{
 const app=read('docs/index.html'),dashboard=read('docs/dashboard.html');
 const script='./vendor/supabase-relay.min.js';
 for(const [file,s,following] of [['app',app,'./sync-realtime.js'],['dashboard',dashboard,'./dashboard-main.min.js']]){
   assert.equal(s.split(script).length,2,file+': exactly one native adapter');
   assert.ok(!/\<script[^>]+src=["']\.\/peer-sync\.js/.test(s),file+': no peer-only adapter');
   assert.ok(s.indexOf(script)<s.indexOf(following),file+': adapter ready before consumers');
 }
 assert.ok(app.indexOf(script)<app.indexOf('./sync-yjs.js'),'Yjs initializes after native adapter');
});
test('P0 existing shipped browser bundle routes to persistent encrypted Supabase transport',()=>{
 const code=read('docs/vendor/supabase-relay.min.js');
 assert.ok(code.length>10000,'bundled runtime exists');
 for(const symbol of ['f123_relay_route','f123_relay_command','f123_relay_has_topic','F123Relay']) assert.ok(code.includes(symbol),symbol+' in shipped bundle');
 assert.ok(code.includes('supabase.co'),'native backend configured');
 const transport=read('supabase-relay/transport.mjs'),gateway=read('supabase-relay/gateway.mjs');
 assert.match(transport,/private: true/);
 assert.match(transport,/\['op', 'ckpt', 'pull', 'ts', 'head'\]/);
 assert.match(transport,/persist-result/);
 assert.match(gateway,/mode === 'legacy'/);
 assert.match(gateway,/mode !== 'supabase'/);
});
test('P0 no destructive or replay bypass and no release version bump on unverified candidate',()=>{
 const app=read('docs/index.html'),dash=read('docs/dashboard.html');
 assert.ok(!app.includes('localStorage.clear()'));
 assert.ok(!dash.includes('localStorage.clear()'));
 const version=JSON.parse(read('docs/version.json'));
 assert.equal(version.shell,'f123-shell-v632');
});
