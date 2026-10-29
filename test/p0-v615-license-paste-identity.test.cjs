'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const mock=fs.readFileSync(path.join(__dirname,'../docs/mock-backend.js'),'utf8');
const sync=fs.readFileSync(path.join(__dirname,'../docs/sync-realtime.js'),'utf8');
const auth=fs.readFileSync(path.join(__dirname,'../docs/auth-ui.js'),'utf8');

const method=mock.slice(mock.indexOf('    cambiar(licencia, opts) {'),
 mock.indexOf('    /* CLAIM / MERGE',mock.indexOf('    cambiar(licencia, opts) {')));
assert.ok(method.startsWith('    cambiar(')&&method.includes('sufDest'));

function change(from,destination,active,storedOwned,registry='{}',pending=''){
 const m=new Map([
 ['f123_owned',JSON.stringify({licenseCode:storedOwned})],
 ['f123_tienda_activa',active],
 ['f123_tiendas',registry],
 ['f123_estado_v4_A','{"nombreNegocio":"Store A","productos":[{"id":"A"}]}']
 ]);
 if (pending) m.set('f123_join_pending_v1',JSON.stringify({licenseCode:pending,instanceId:'synthetic-actor'}));
 let reloads=0, flushes=0;
 const env=[
 'const localStorage={getItem:k=>m.get(k)??null,setItem:(k,v)=>m.set(k,String(v))};',
 'const _normLic=c=>String(c||"").trim().toUpperCase().replace(/\\s+/g,"");',
 'const _licenciaPropia=()=>JSON.parse(localStorage.getItem("f123_owned")||"{}").licenseCode||"";',
 'const _licenciaActual=()=>from;',
 'const OC_STATE_SUFIJO=active;',
 'const guardarEstadoLocal=()=>flushes++;',
 'const window={OCSyncControl:{fijarSala(){return {ok:true}}}};',
 'const location={reload(){reloads++}};',
 'const obj={'+method+'};',
 'const result=obj.cambiar(destination,{desde:from});',
 'return {result,active:m.get("f123_tienda_activa"),owned:_licenciaPropia(),oldData:m.get("f123_estado_v4_A"),reloads,flushes};'
 ].join('\n');
 return new Function('m','from','destination','active','flushes','reloads',env)(m,from,destination,active,flushes,reloads);
}
const A='F123-SYNTHETIC-A',B='F123-SYNTHETIC-B';
test('P0: change to another license after sidecar was overwritten MUST switch notebook',()=>{
 const r=change(A,B,'',B);
 assert.equal(r.result.cambiado,true);
 assert.equal(r.result.mismo,undefined);
 assert.equal(r.active,'::'+B);
 assert.equal(r.reloads,1);
 assert.match(r.oldData,/Store A/);
});
test('P0: the genuine same-license rejoin must not create another namespace',()=>{
 const r=change(B,B,'::'+B,B);
 assert.equal(r.result.mismo,true);
 assert.equal(r.active,'::'+B);
 assert.equal(r.reloads,0);
});
test('P0: an old own-license notebook remains in its existing slot on same-license rejoin',()=>{
 const r=change(A,A,'',A);
 assert.equal(r.result.mismo,true);
 assert.equal(r.active,'');
});
test('P0: a v614 duplicated alias MUST NOT silently hide its existing notebook',()=>{
 const registry=JSON.stringify({[A]:'',[B]:''});
 const r=change(B,B,'',B,registry,B);
 // v615 incorrectly auto-jumped to an empty ::B despite no proof who
 // actually owns the original namespace. v616 fails closed instead.
 assert.equal(r.result.ok,false,'a shared alias is not authenticated notebook ownership');
 assert.equal(r.active,'','the existing notebook stays selected');
 assert.equal(r.reloads,0,'no reload that hides the original shop');
 assert.match(r.oldData,/Store A/,'old business data was preserved byte-for-byte');
});
test('P0: a registered target namespace is honored even after the owned sidecar was changed',()=>{
 const r=change(B,B,'',B,JSON.stringify({[B]:'::'+B}),B);
 assert.equal(r.result.cambiado,true);
 assert.equal(r.active,'::'+B);
});
test('P0: joining must not connect to destination relay before notebook switch',()=>{
 assert.match(sync,/unirse\(codigo\)\s*\{[\s\S]*?this\.activar\(codigo,\s*\{\s*esJoin:\s*true\s*\}\)/);
 const start=sync.indexOf('    activar(codigo, opciones) {'),end=sync.indexOf('    fijarSala(codigo) {',start);
 assert.ok(start>0&&end>start);
 const segment=sync.slice(start,end);
 assert.match(segment,/if\s*\(!\(opciones\s*&&\s*opciones\.esJoin\)\)\s*conectar\(\)/);
});
test('P0: iOS native license paste focus must not inject prefix into editable selection',()=>{
 const start=auth.indexOf('  function _ocMascaraCodigo(inp) {');
 const end=auth.indexOf('  function abrirUnirseEquipo()',start);
 assert.ok(start>0&&end>start);
 const ctx={setTimeout(){},window:{},Event:class{constructor(type){this.type=type}}};
 vm.createContext(ctx);
 vm.runInContext(auth.slice(start,end)+';this.mask=_ocMascaraCodigo',ctx);
 const events={};
 const input={value:'',dataset:{},setAttribute(){},setSelectionRange(){},addEventListener(k,fn){events[k]=fn},dispatchEvent(e){events[e.type]?.(e)}};
 ctx.mask(input);
 if(events.focus)events.focus();
 assert.equal(input.value,'','native selection and Paste UI require an untouched empty field');
 input.value='F123-TEST';
 events.input();
 assert.match(input.value,/^F123-/);
});
