'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const src=fs.readFileSync(path.join(__dirname,'../docs/auth-ui.js'),'utf8');
const start=src.indexOf('  function pintarNegocioGate() {');
const end=src.indexOf('  /* Pinta la versión REAL',start);
assert.ok(start>0&&end>start,'exercise the actual PIN gate painter');
const code=src.slice(start,end);
function harness(joined=false){
  let writes=0,name=joined?'Galería A':'Mi tienda';
  const element={style:{display:'none'},_html:'',
    get innerHTML(){return this._html;},
    set innerHTML(v){writes++;this._html=String(v);}
  };
  const license='F123-SYNTH12345678';
  const window={t:(key,fallback)=>fallback||key,
    OCTienda:{esUnida:()=>joined,nombreActivo:()=>name,licenciaActual:()=>license},
    OCYjs:{roomId:'syn',canal:{recuperando:true},meta:{get:()=>''}}};
  const storage={getItem:(key)=>key==='f123_owned'?JSON.stringify({licenseCode:license}):null};
  const doc={getElementById:(id)=>id==='oc-gate-negocio'?element:null};
  const paint=new Function('document','window','localStorage','dispositivoApropiado',code+';return pintarNegocioGate;')
    (doc,window,storage,()=>true);
  return {paint,element,get writes(){return writes;},name(v){name=v;}};
}
test('C195 PIN: 1000 unchanged sync-merge paints do not rebuild any DOM',()=>{
  for(const joined of [false,true]){
    const x=harness(joined);
    x.paint();assert.equal(x.writes,1,'initial paint once');
    for(let i=0;i<1000;i++)x.paint();
    assert.equal(x.writes,1,'same name/license must NOT trigger 2000 Safari DOM replacements');
    assert.match(x.element.innerHTML,/5678/);
  }
});
test('C195 PIN: real name change still paints immediately, only once',()=>{
  const x=harness(false);
  x.paint();x.name('Negocio actualizado');x.paint();
  assert.equal(x.writes,2);
  assert.match(x.element.innerHTML,/Negocio actualizado/);
  for(let i=0;i<20;i++)x.paint();
  assert.equal(x.writes,2);
});
test('C195 PIN: joined store pending label changes to real team name without false own name',()=>{
  const x=harness(true);x.name('');
  x.paint();assert.match(x.element.innerHTML,/Team/);
  x.name('idiomARTE');x.paint();
  assert.match(x.element.innerHTML,/idiomARTE/);
  assert.doesNotMatch(x.element.innerHTML,/Joined\. This device is now syncing/);
  assert.equal(x.writes,2);
});

test('C195 PIN: missing own-store name hides the banner without changing credentials',()=>{
  const x=harness(false);
  x.paint();
  assert.equal(x.element.style.display,'block');
  x.name('');
  x.paint();
  assert.equal(x.element.style.display,'none');
});
