'use strict';
// C168 Safari P0: update check on register() is automatic.
// Avoid the immediate SECOND sw.js network update during a memory-heavy boot.
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const src=fs.readFileSync(path.join(__dirname,'../src/app/app-inline-03.js'),'utf8');
test('C168 Safari: first load registers once with updateViaCache none and does not manually run reg.update immediately',async()=>{
 const start=src.indexOf('if ("serviceWorker" in navigator) {'),end=src.indexOf('// 4D: compare',start);
 assert.ok(start>=0&&end>start,'inspect the real first-load registration block');
 const callbacks={};let registers=0,updates=0,argumentsSeen=null;
 const sw={
   register(_path,opts){registers++;argumentsSeen={path:_path,opts};return Promise.resolve({update(){updates++;return Promise.resolve();}});},
   addEventListener(type,fn){callbacks['sw:'+type]=fn;},
 };
 const sandbox={navigator:{serviceWorker:sw},window:{addEventListener(type,fn){callbacks[type]=fn;}},localStorage:{getItem(){return null;}},sessionStorage:{setItem(){}},console};
 vm.runInNewContext(src.slice(start,end),sandbox,{filename:'safari-real-first-load-registration.js'});
 assert.equal(typeof callbacks.load,'function');
 callbacks.load();
 await Promise.resolve();
 await Promise.resolve();
 assert.equal(registers,1);
 assert.equal(argumentsSeen.path,'./sw.js');
 assert.equal(argumentsSeen.opts.updateViaCache,'none');
 assert.equal(updates,0,'navigator.serviceWorker.register itself checks updates; do not force an extra update during Safari boot');
 assert.equal(typeof callbacks['sw:message'],'function','keep existing controlled shell update notifications');
});
test('C168: explicit authoritative version mismatch still supports service worker update',()=>{
 assert.ok(src.includes('getRegistrations()')&&src.includes('g.update()'),'version mismatch still forces update');
 assert.match(src,/f123_version_vista/);
 assert.match(src,/version\.json\?ts=/);
 assert.match(src,/function _recargarSeguroVersion/);
});
