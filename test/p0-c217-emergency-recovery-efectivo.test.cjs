'use strict';
// C217 (JFC 22 nov 2026): the original Emergency recovery button must be EFFECTIVE at forcing the current
// version ("no es ningun rescate, es forzar la version actual"): it routes to the proven force-update page (reenganchar.html, covered by p0-c210-safari-legacy-rescue.browser.cjs) and never
// deletes local business data (PRIME DIRECTIVE 1).
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const auth=fs.readFileSync('docs/auth-ui.js','utf8'),rescue=fs.readFileSync('docs/reenganchar.html','utf8');
test('C217: Emergency recovery click forces the current version through the proven page before any in-page cleanup',()=>{
 const click=auth.indexOf('_purgeBtn.addEventListener("click"');
 const route=auth.indexOf('reenganchar.html?desde=emergencia',click);
 const unreg=auth.indexOf('navigator.serviceWorker.getRegistrations()',click);
 assert.ok(click>0 && route>click && unreg>route,'rescue navigation comes first, in-page cleanup stays as fallback');
 assert.ok(auth.indexOf('id="oc-purge-btn"')>0,'original button still rendered');
});
test('C217: neither the button handler nor the force-update page deletes local business data',()=>{
 const click=auth.indexOf('_purgeBtn.addEventListener("click"');
 const handler=auth.slice(click,auth.indexOf('} catch',auth.indexOf('location.replace(url)',click)));
 for(const src of [handler,rescue]){
  assert.ok(!/indexedDB\.deleteDatabase|localStorage\.clear\(\)|localStorage\.removeItem/.test(src),'no local business data deletion');
 }
 assert.ok(rescue.includes('f123-shell-v'),'force-update page deletes only f123-shell-vN program caches');
});
