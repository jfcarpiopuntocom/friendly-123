'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const ui=read('docs/ui2.css');
const auth=read('docs/auth-ui.js');
const app=read('src/app/app-inline-03.js');
test('C209: all UI2 inventory card rules target only inventory DOM (not the PIN gate)',()=>{
  assert.doesNotMatch(ui,/html\.ui2\s+\.caja(?:[\s.>:{]|$)/);
  const selectors=ui.match(/html\.ui2\s+#gridInventario\s+\.caja/g)||[];
  assert.ok(selectors.length>=12,'every descendant/card rule must be scoped');
  assert.match(ui,/html\.ui2 #gridInventario \.caja>div:not\(\.ajuste-rapido\)\{display:block!important/);
});
test('C209: real PIN style preserves horizontal 3 slots and 5-column keyboard on narrow screens',()=>{
  assert.match(auth,/#oc-gate \.caja\{[^}]*box-sizing:border-box;min-width:0/s);
  assert.match(auth,/\.oc-slots\{display:flex;/);
  assert.match(auth,/\.oc-pad\{display:grid;grid-template-columns:repeat\(5,minmax\(0,1fr\)\)/);
  assert.match(auth,/\.oc-pad button\{[^}]*min-width:0;/);
});
test('C209: manual repair serializes navigation and blocks competing SW adoption',()=>{
  assert.match(auth,/if \(window\.__f123PurgeEnCurso\) return;/);
  assert.match(auth,/window\.__f123PurgeEnCurso = true;\s*_purgeBtn\.disabled = true;/);
  assert.match(app,/function seguroCon\(sinRecuperacion\) \{\s*if \(window\.__f123PurgeEnCurso === true\) return false;/);
  assert.match(app,/async function revisar\(\) \{\s*if \(window\.__f123PurgeEnCurso === true\) return;/);
  assert.match(app,/function onShellTomado\(\) \{\s*if \(window\.__f123PurgeEnCurso === true\) return;/);
  for(const p of ['docs/auth-ui.min.js','docs/app-inline-03.min.js'])
    assert.match(read(p),/__f123PurgeEnCurso/,'published bundle '+p+' must contain the guard');
});

test('C209: manual purge reentry is exactly one navigation, and stale update latches do not fire',()=>{
  const index=read('docs/index.html');
  assert.ok(index.includes('window.__f123ManualPurgeReentry = true'));
  assert.ok(app.includes('const manualPurgeReentry = window.__f123ManualPurgeReentry === true'));
  assert.match(app,/if \(manualPurgeReentry\) return false;\s*vigilar\(\);/);
  assert.ok(app.includes('if (manualPurgeReentry && String(vj.shell) === manualPurgeShell)'));
  assert.ok(auth.includes('sessionStorage.removeItem("f123_act_sola_pendiente")'));
  assert.ok(auth.includes('sessionStorage.removeItem("f123_autorecarga")'));
  assert.ok(auth.includes('location.replace(url)'));
});
