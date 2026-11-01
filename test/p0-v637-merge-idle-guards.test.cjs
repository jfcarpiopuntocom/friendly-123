'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../docs/mock-backend.js'),'utf8');
const start = source.indexOf('  let _mergeSucio = false, _mergeGuardado = null;');
const end = source.indexOf('  function guardarEstadoLocal(', start);
assert.ok(start > 0 && end > start, 'idle helper exists in shipped backend');
function fixture(save) {
 const jobs=[], listeners={};
 const ctx = { Promise, requestIdleCallback: fn => { jobs.push(fn); return jobs.length; },
   setTimeout: fn => { jobs.push(fn); return jobs.length; }, guardarEstadoLocal: save,
   window: { addEventListener: (k, fn) => { listeners[k] = fn; } },
   document: { visibilityState:'visible', addEventListener:(k,fn)=>{listeners[k]=fn;} } };
 vm.createContext(ctx);
 vm.runInContext(source.slice(start,end) + '\nthis.api={enqueue:_programarGuardadoMerge,flush:_guardarMergePendienteYa,dirty:()=>_mergeSucio};',ctx);
 return {ctx,jobs,listeners,api:ctx.api};
}
test('remote merges coalesce into one idle write while preserving visibility-first ordering', async () => {
 let saves=0;const f=fixture(()=>{saves++;return true;});
 const a=f.api.enqueue(), b=f.api.enqueue();
 assert.equal(a,b);assert.equal(saves,0);assert.equal(f.jobs.length,1);
 f.jobs.shift()();assert.equal(await a,true);assert.equal(saves,1);assert.equal(f.api.dirty(),false);
});
test('false save result remains dirty and pagehide retries rather than discarding the remote merge', async () => {
 let saves=0;const f=fixture(()=>++saves>1);
 const p=f.api.enqueue();f.jobs.shift()();
 assert.equal(await p,false);assert.equal(f.api.dirty(),true);
 f.listeners.pagehide();assert.equal(saves,2);assert.equal(f.api.dirty(),false);
});
