'use strict';
const { test }=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const src=fs.readFileSync(path.join(__dirname,'../docs/sync-realtime.js'),'utf8');
const begin=src.indexOf('  window.OCSyncEmit = function (tipo, payload) {');
const end=src.indexOf('  /* NO PERDER EN SILENCIO',begin);
assert.ok(begin>=0&&end>begin);
const emitter=src.slice(begin,end);
test('local queue precedes both transport publications',()=>{
 const saved=emitter.indexOf('const encolada = encolar(op)');
 const published=emitter.indexOf('new CustomEvent("oc-op-local"');
 assert.ok(saved>=0&&published>saved);
});
test('queue error still keeps Yjs best-effort publication',()=>{
 assert.ok(emitter.indexOf('new CustomEvent("oc-op-local"')<emitter.indexOf('if (!encolada) return false'));
});
test('offline emitter does not enqueue twice',()=>{
 const immediate=emitter.slice(0,emitter.indexOf('if (ws && ws.readyState'));
 assert.equal((immediate.match(/encolar\(op\)/g)||[]).length,1);
});
