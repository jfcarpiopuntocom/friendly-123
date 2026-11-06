'use strict';
// No business writes. Reproduce late responses against the real initial
// async cargarInventario() code before its render boundary.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const src = fs.readFileSync(path.join(__dirname,'../src/app/app-inline-01.js'),'utf8');
const marker = 'var _invCargaRevision = 0;';
const at = src.indexOf(marker) >= 0 ? src.indexOf(marker) : src.indexOf('async function cargarInventario(){');
const end = src.indexOf('  if (productos.length === 0){',at);
assert.ok(at > 0 && end > at,'real Inventory async loader found');
const prefix = src.slice(at,end);

function fixture() {
  const responses = [];
  const grid = { innerHTML:'UNCHANGED' };
  const get = () => new Promise((resolve,reject) => { responses.push({resolve,reject}); });
  const args = ['API','document','window','ocMontarTraslado','ubicacionActual',
    'filtroEstadoActual','_verArchivados','fetch','t'];
  const vals = ['/api',{getElementById:id => id === 'gridInventario' ? grid : null},
    {OCAuth:{puedeGestionar:()=>false}},()=>{},'todas','',false,get,x=>x];
  const make = new Function(...args,prefix+'\nreturn productos; }\nreturn cargarInventario;');
  return { run: make(...vals), responses, grid };
}

test('newest Inventory response wins, late older snapshot is not renderable',async()=>{
  const f=fixture();
  const older=f.run(), newer=f.run();
  assert.equal(f.responses.length,2);
  f.responses[1].resolve({json:async()=>[{id:'synthetic',stockActual:33}]});
  const latest=await newer;
  assert.equal(latest[0].stockActual,33);
  f.responses[0].resolve({json:async()=>[{id:'synthetic',stockActual:8}]});
  const stale=await older;
  assert.equal(stale,undefined,'old result must abort before rendering stale stock 8');
});
test('failed older request cannot overwrite the newer rendered UI with an error',async()=>{
  const f=fixture();
  const older=f.run(), newer=f.run();
  f.responses[1].resolve({json:async()=>[{id:'synthetic',stockActual:33}]});
  await newer; f.grid.innerHTML='CURRENT-33';
  f.responses[0].reject(new Error('late synthetic failure'));
  await older;
  assert.equal(f.grid.innerHTML,'CURRENT-33');
});
test('single Inventory request is not skipped when there is no overlap',async()=>{
  const f=fixture(), req=f.run();
  f.responses[0].resolve({json:async()=>[{id:'synthetic',stockActual:33}]});
  assert.equal((await req)[0].stockActual,33);
});
