'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname,'../src/app/app-inline-01.js'),'utf8');
const deployed = fs.readFileSync(path.join(__dirname,'../docs/app-inline-01.min.js'),'utf8');
const start = source.indexOf('  on("ventas", function () {');
const stop = source.indexOf('  return { emitir: function (tipo)',start);
assert(start > 0 && stop > start, 'sale reactive callback exists in source');
const snippet = source.slice(start,stop);
function simulate(todayActive) {
  let callback, todayRenders = 0;
  const context = {
    on: (type,fn) => { if (type === 'ventas') callback=fn; },
    window: {},
    document: {getElementById: id => id === 'vista-hoy' ? {classList:{contains: x => x==='activa'&&todayActive}} : null },
    cargarHoy: () => {todayRenders++;}
  };
  vm.runInNewContext(snippet, context);
  assert.equal(typeof callback,'function');
  callback();
  return todayRenders;
}
assert.equal(simulate(true),1, 'sale refreshes active Today to avoid stale stock');
assert.equal(simulate(false),0,'hidden Today is not refetched');
assert.match(deployed,/on\("ventas",function\(\)\{try\{var vh=document\.getElementById\("vista-hoy"\)/,'deployed bundle contains same Today refresh');
console.log('PASS active Today refresh after sale without background UI fetch');
