'use strict';
// C195: PIN screen must not rebuild identical DOM on each Sync3 merge.
// Execute the exact gate painter from production with a counting DOM stub.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const src=fs.readFileSync(path.join(__dirname,'../docs/auth-ui.js'),'utf8');
const a=src.indexOf('  function pintarNegocioGate() {');
const b=src.indexOf('  /* Pinta la versión REAL del shell',a);
assert.ok(a>0&&b>a,'extract actual PIN business label code');
function setup(joined){
 let writes=0,html='', name='Mi tienda',lang='ES';
 const el={style:{display:''},get innerHTML(){return html;},set innerHTML(v){writes++;html=String(v);}};
 const doc={getElementById(){return el}};
 const store={getItem(){return JSON.stringify({licenseCode:'F123-ABCDEFGHIJ'});}};
 const w={t:(key)=>lang+':'+key,OCTienda:{
   esUnida:()=>joined,nombreActivo:()=>name,licenciaActual:()=> 'F123-ABCDEFGHIJ'
 }};
 const paint=new Function('document','window','localStorage','dispositivoApropiado',
  src.slice(a,b)+'\nreturn pintarNegocioGate;')(doc,w,store,()=>true);
 return {paint,el,get writes(){return writes},get html(){return html},setName:n=>{name=n},setLang:x=>{lang=x}};
}
test('C195 own PIN label: 100 identical Sync3 updates cause only ONE DOM replacement',()=>{
 const s=setup(false);
 for(let i=0;i<100;i++)s.paint();
 assert.equal(s.writes,1,'repeated sync merge must not reallocate/reparse identical HTML');
 assert.match(s.html,/Mi tienda/);assert.match(s.html,/••••GHIJ/);
 s.setName('Otra tienda');s.paint();assert.equal(s.writes,2);
 s.setLang('EN');s.paint();assert.equal(s.writes,3,'language changes still repaint');
});
test('C195 joined PIN label: keeps sync notice and updated name without repeated writes',()=>{
 const s=setup(true);
 for(let i=0;i<100;i++)s.paint();
 assert.equal(s.writes,1);
 assert.match(s.html,/Mi tienda/);assert.match(s.html,/••••GHIJ/);
 s.setName('idiomARTE');s.paint();assert.equal(s.writes,2);
});
