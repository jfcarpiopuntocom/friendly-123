'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../docs/avanzado-extra.js'),'utf8');
test('owner PIN editors repaint after session readiness, not only on oc-login',()=>{
  const i=source.indexOf('    pintarPinsVisibles();\n    pintarApodoDevice();');
  const j=source.indexOf('    $("oc-descargar-csv").addEventListener',i);
  assert.ok(i>0&&j>i);
  const hooks=source.slice(i,j);
  assert.match(hooks,/OCAuth\.listo\(\)\.then\(pintarPinsVisibles\)/);
  assert.match(hooks,/addEventListener\("oc-login", pintarPinsVisibles\)/);
});
test('owner PIN editors repaint on Advanced navigation and disappear after logout',()=>{
  const i=source.indexOf('    pintarPinsVisibles();\n    pintarApodoDevice();');
  const j=source.indexOf('    $("oc-descargar-csv").addEventListener',i);
  const hooks=source.slice(i,j);
  assert.match(hooks,/addEventListener\("oc-logout", pintarPinsVisibles\)/);
  assert.match(hooks,/data-vista="avanzado"/);
  assert.match(hooks,/pintarPinsVisibles\(\)/);
  assert.match(source,/const _puedeOwner = _rolPin === "dueno"/);
  assert.match(source,/const _puedeEmp = _rolPin === "dueno" \|\| _rolPin === "admin"/);
});
