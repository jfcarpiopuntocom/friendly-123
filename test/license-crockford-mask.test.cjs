'use strict';
// Synthetic licenses come from the real issuer, never from a parallel checksum implementation.
const {test}=require('node:test'), assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const auth=fs.readFileSync(path.join(__dirname,'../docs/auth-ui.js'),'utf8');
const dashboard=require('./helpers/page-source.cjs').readFileSync(path.join(__dirname,'../docs/dashboard.html'),'utf8');
function issued(){
  let n=0;
  const c={Uint8Array,self:{crypto:{getRandomValues(bytes){bytes.fill(0);bytes[14]=Math.floor(n/32);bytes[15]=n%32;return bytes;}}}};
  vm.createContext(c);
  vm.runInContext(auth.slice(auth.indexOf('  var OC_B32 ='),auth.indexOf('  /* AVISO DE LICENCIA')),c);
  const byCheck=new Map();
  for(n=0;n<1024;n++){const code=c.generarCodigoSync();byCheck.set(code.at(-1),code);}
  assert.equal(byCheck.size,37,'the real issuer must exercise every checksum');
  return byCheck;
}
const licenses=issued();
function mask(file){
  const handlers={},timers=[];
  const input={value:'',dataset:{},setAttribute(){},setSelectionRange(){},addEventListener:(name,fn)=>{handlers[name]=fn;},dispatchEvent(e){handlers[e.type]?.(e);}};
  const c={window:{},setTimeout:fn=>timers.push(fn),Event:class{constructor(type){this.type=type;}},$:()=>input};
  vm.createContext(c);
  if(file==='app'){
    const start=auth.indexOf('  function _ocMascaraCodigo(inp) {');
    vm.runInContext(auth.slice(start,auth.indexOf('  function abrirUnirseEquipo()',start))+';this.bind=_ocMascaraCodigo;',c);c.bind(input);
  }else{
    const start=dashboard.indexOf('  (function () {',dashboard.indexOf('LOS GUIONES LOS PONE LA APP'));
    vm.runInContext(dashboard.slice(start,dashboard.indexOf('  })();',start)+7),c);
  }
  return {input,handlers,timers};
}
for(const file of ['app','dashboard']){
  test(file+': real issued codes retain their 17 characters and every final checksum',()=>{
    const s=mask(file);
    for(const [check,code] of licenses){s.input.value=code;s.handlers.input();assert.equal(s.input.value,code,'lost issuer checksum '+check);assert.equal(s.input.value.replace(/^F123-/,'').replace(/-/g,'').length,17);}
  });
  test(file+': aliases canonicalize the body and checksum, including repeated old prefix',()=>{
    const s=mask(file),code=licenses.get('U');
    const ambiguous=code.replace(/^F123-/,'TEAM-F123-').replace(/0/g,'o').replace(/1/g,'l');
    // Keep prefix digits literal: aliases belong to the license body.
    const raw=ambiguous.replace('Fl23','F123');
    let prevented=false;s.handlers.paste({clipboardData:{getData:()=>raw},preventDefault(){prevented=true;}});
    assert.equal(prevented,true);assert.equal(s.input.value,code);
    for(const [canonical,aliases] of [['0',['O']],['1',['I','L']]]){
      for(const alias of aliases){s.input.value=licenses.get(canonical).slice(0,-1)+alias;s.handlers.input();assert.equal(s.input.value,licenses.get(canonical),'checksum aliases retain the normalizer contract');}
    }
  });
  test(file+': checksum-only symbols cannot become body characters',()=>{
    const s=mask(file);
    for(const check of '*~$=U'){s.input.value='F123-'+check+'000-0000-0000-0000';s.handlers.input();assert.doesNotMatch(s.input.value.replace(/^F123-/,''),/[*~$=U]/);}
  });
  test(file+': empty clipboard preserves native fallback and formats after insertion',()=>{
    const s=mask(file),code=licenses.get('U');let prevented=false;
    s.input.value='F123-';s.handlers.paste({clipboardData:{getData:()=>''},preventDefault(){prevented=true;}});
    assert.equal(prevented,false);s.input.value=code;s.timers.forEach(fn=>fn());assert.equal(s.input.value,code);
  });
}
