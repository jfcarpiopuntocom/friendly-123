'use strict';
// The former pre-login service worker nuke is intentionally retired.
// P0: no browser may lose its local recovery context before PIN.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const html=fs.readFileSync(path.join(__dirname,'../docs/index.html'),'utf8');
const auth=fs.readFileSync(path.join(__dirname,'../docs/auth-ui.js'),'utf8');
test('P0: HTML head never unregisters the service worker before PIN',()=>{
  const beforeLogin=html.slice(0,html.indexOf('id="oc-negocio-nombre"'));
  assert.doesNotMatch(beforeLogin,/f123_sw_nuke_v1|serviceWorker\.getRegistrations\(/);
  assert.doesNotMatch(beforeLogin,/\.unregister\(\)/);
});
test('manual repair remains available without involuntary cache removal',()=>{
  assert.match(auth,/oc-purge-btn/);
  assert.match(auth,/location\.replace\(url\)/);
});
