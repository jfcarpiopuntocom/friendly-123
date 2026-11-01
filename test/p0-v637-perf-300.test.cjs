'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const sync=fs.readFileSync(path.join(__dirname,'../docs/sync-yjs.js'),'utf8');

test('live Yjs publication records its post-seed signature, preventing the next redundant sweep',()=>{
 const start=sync.indexOf('    function pedirSeed() {');
 const end=sync.indexOf('    window.addEventListener("oc-catalogo-cambiado", pedirSeed);',start);
 assert.ok(start>0&&end>start);
 let published=0,signature=0;
 const ctx=vm.createContext({
  _tSeed:null,_barridoFirma:null,_barridoSaltos:3,
  setTimeout:fn=>{fn();return 1;},
  sembrar:()=>{published++;signature++;},
  firmaBarrido:()=>String(signature)
 });
 vm.runInContext(sync.slice(start,end),ctx);
 vm.runInContext('pedirSeed()',ctx);
 assert.equal(published,1);
 assert.equal(ctx._barridoFirma,'1','signature must be captured after publication');
 assert.equal(ctx._barridoSaltos,0);
 assert.match(sync,/if \(firma !== null && firma === _barridoFirma && _barridoSaltos < 4\)/,
  'the periodic 10-second safety scan must remain in place');
});
