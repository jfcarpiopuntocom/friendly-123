'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const read=(p)=>fs.readFileSync(path.join(root,p),'utf8');
const css=read('docs/ui2.css');
const auth=read('docs/auth-ui.js');
const html=read('docs/index.html');
const update=read('src/app/app-inline-03.js');
const ver=JSON.parse(read('docs/version.json'));
const sw=read('docs/sw.js');

test('C209: commercial UI2 .caja rules scoped only under inventory',()=>{
  assert.doesNotMatch(css,/html\.ui2\s+\.caja(?:\s|[:>{,.])/);
  assert.match(css,/html\.ui2 #gridInventario \.caja>div:not\(\.ajuste-rapido\)\{display:block!important/);
  assert.match(css,/html\.ui2 #oc-gate \.caja\{box-sizing:border-box;min-width:0\}/);
  assert.match(auth,/\.oc-slots\{display:flex;gap:10px/);
  assert.match(auth,/\.oc-pad\{display:grid;grid-template-columns:repeat\(5,minmax\(0,1fr\)\)/);
});
test('C209: one-shot manual reengagement suppresses overlapping updater',()=>{
  assert.match(html,/window\.__f123ManualPurgeReentry = true/);
  assert.match(update,/const manualPurgeReentry = window\.__f123ManualPurgeReentry === true/);
  assert.match(update,/if \(manualPurgeReentry\) return false;\s*vigilar\(\);/);
  assert.match(update,/if \(window\.__f123PurgeEnCurso === true \|\| manualPurgeReentry\) return;/);
  assert.match(auth,/sessionStorage\.removeItem\("f123_act_sola_pendiente"\)/);
  assert.match(auth,/sessionStorage\.removeItem\("f123_autorecarga"\)/);
  assert.match(auth,/location\.replace\(url\)/);
  assert.doesNotMatch(auth,/\b(?:localStorage|sessionStorage)\.clear\(\)/);
});
test('C209: official shell and dashboard identities are unique',()=>{
  assert.equal(ver.shell,'f123-shell-v892');
  assert.equal(ver.cacheGeneration,'golden428');
  assert.match(sw,/const CACHE = "f123-shell-v892"/);
  assert.match(sw,/const CACHE_GENERACION = "-golden428"/);
  assert.match(read('docs/dashboard.html'),/name="dashboard-shell" content="f123-shell-v892"/);
});
