'use strict';
// The old one-time automatic pre-PIN purge was retired by owner direction.
// Keep channel identity isolation and explicit manual-repair coverage.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const html=fs.readFileSync(path.join(__dirname,'../docs/index.html'),'utf8');
const sw=fs.readFileSync(path.join(__dirname,'../docs/sw.js'),'utf8');
const auth=fs.readFileSync(path.join(__dirname,'../docs/auth-ui.js'),'utf8');
const current=JSON.parse(fs.readFileSync(path.join(__dirname,'../docs/version.json'),'utf8'));
test('no automatic cleanup in HEAD for a new or already authenticated browser',()=>{
  const prefix=html.slice(0,html.indexOf('id="oc-negocio-nombre"'));
  assert.doesNotMatch(prefix,/f123_sw_nuke_v1|serviceWorker\.getRegistrations\(|\.unregister\(\)/);
});
test('SW cache identities still protect stable / next / previo channels',()=>{
  // Compare the actual service worker with the release identity, never a
  // literal from a historical release. Keep separate assertions for each.
  assert.ok(/^f123-shell-v[0-9]+$/.test(current.shell),'release shell has canonical form');
  assert.ok(/^golden[0-9]+$/.test(current.cacheGeneration),'release generation has canonical form');
  assert.ok(sw.includes('const CACHE = "'+current.shell+'"'),'SW shell matches version.json');
  assert.ok(sw.includes('const CACHE_GENERACION = "-'+current.cacheGeneration+'"'),'SW cache generation matches version.json');
  assert.match(sw,/\bnext\b/);
  assert.match(sw,/\bprevio\b/);
});
test('owner manual purge capability remains available',()=>{
  assert.match(auth,/getElementById\(["']oc-purge-btn["']\)/);
  assert.match(auth,/location\.replace\(url\)/);
});
