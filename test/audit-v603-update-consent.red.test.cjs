'use strict';
// JFC withdrew the update banner and manual-update chore for v607.
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
for(const file of ['src/app/app-inline-03.js','docs/app-inline-03.min.js']) {
 const src=fs.readFileSync(path.join(__dirname,'..',file),'utf8');
 test(file+' - recovery monitoring never creates an update banner',()=>{
  const a=src.indexOf('function vigilar()'),b=src.indexOf('var ultimoControladorSW',a);assert.ok(a>=0&&b>a);
  let shown=0,marked=0;
  vm.runInNewContext(src.slice(a,b)+'\nvigilar();',{pendiente:()=>true,recuperacionPendiente:()=>true,limpiarFrenada(){},marcarFrenada(){marked++;},mostrarAviso(){shown++;}});
  assert.equal(marked,1);assert.equal(shown,0);assert.doesNotMatch(src,/f123-aviso-version|function alTocarAviso/);
 });
}