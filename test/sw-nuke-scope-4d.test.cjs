'use strict';
// The old one-time automatic pre-PIN purge was retired by owner direction.
// Keep channel identity isolation and explicit manual-repair coverage.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const html=fs.readFileSync(path.join(__dirname,'../docs/index.html'),'utf8');
const sw=fs.readFileSync(path.join(__dirname,'../docs/sw.js'),'utf8');
const auth=fs.readFileSync(path.join(__dirname,'../docs/auth-ui.js'),'utf8');
test('no automatic cleanup in HEAD for a new or already authenticated browser',()=>{
  const prefix=html.slice(0,html.indexOf('id="oc-negocio-nombre"'));
  assert.doesNotMatch(prefix,/f123_sw_nuke_v1|serviceWorker\.getRegistrations\(|\.unregister\(\)/);
});
test('SW cache identities still protect stable / next / previo channels',()=>{
  assert.match(sw,/const CACHE = "f123-shell-v614"/);
  assert.match(sw,/const CACHE_GENERACION = "-golden160"/);
  assert.match(sw,/\bnext\b/);
  assert.match(sw,/\bprevio\b/);
});
test('owner manual purge capability remains available',()=>{
  assert.match(auth,/getElementById\(["']oc-purge-btn["']\)/);
  assert.match(auth,/location\.replace\(url\)/);
});
