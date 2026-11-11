'use strict';
// v732 (JFC 2026-11-11): una sola recarga automatica por version del shell y por pestana.
// Sintetico: sin red, sin datos de clientes.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.join(__dirname,'..');
const src=fs.readFileSync(path.join(root,'src/app/app-inline-03.js'),'utf8');
const a=src.indexOf('function puedeRecargarVersion(motivo)'),b=src.indexOf('try { window.__f123PuedeRecargarVersion',a);
assert.ok(a>0&&b>a,'el tope anti-bucle debe existir');
function ctx(version){
  const ls=new Map([['f123_version_vista',version]]),ss=new Map(),marks=[];
  const c={localStorage:{getItem:k=>ls.has(k)?ls.get(k):null,setItem:(k,v)=>ls.set(k,v)},
    sessionStorage:{getItem:k=>ss.has(k)?ss.get(k):null,setItem:(k,v)=>ss.set(k,v)},
    marcarRecarga:m=>marks.push(m)};
  vm.createContext(c);vm.runInContext(src.slice(a,b)+'\nthis.cap=puedeRecargarVersion;',c);
  return {c,ls,ss,marks};
}
test('la primera recarga automatica de una version se permite y la segunda se omite y se anota',()=>{
  const x=ctx('0.7.32|f123-shell-v732');
  assert.equal(x.c.cap('login-diferida'),true);
  assert.equal(x.c.cap('login-diferida'),false,'segunda recarga de la misma version: bucle');
  assert.equal(x.c.cap('version-segura'),false,'ningun otro camino puede recargar de nuevo en esa version');
  assert.deepEqual(x.marks,['omitida-tope:login-diferida','omitida-tope:version-segura']);
});
test('una version nueva vuelve a tener su unica recarga',()=>{
  const x=ctx('0.7.32|f123-shell-v732');
  assert.equal(x.c.cap('a'),true);
  x.ls.set('f123_version_vista','0.7.33|f123-shell-v733');
  assert.equal(x.c.cap('a'),true);
});
test('si sessionStorage falla se conserva la conducta anterior (permitir)',()=>{
  const x=ctx('v');x.c.sessionStorage.setItem=()=>{throw new Error('quota');};
  assert.equal(x.c.cap('a'),true);
});
test('los tres caminos automaticos consultan el tope',()=>{
  const auth=fs.readFileSync(path.join(root,'docs/auth-ui.js'),'utf8');
  const dash=fs.readFileSync(path.join(root,'docs/dashboard-updates.js'),'utf8');
  assert.match(auth,/__f123PuedeRecargarVersion\("login-diferida"\)/);
  assert.match(src,/__f123PuedeRecargarVersion\("version-segura"\)/);
  assert.match(dash,/f123_dash_recarga:/);
});
test('el anillo de errores existe, es local y no muestra nada',()=>{
  assert.match(src,/f123_errores_log/);
  assert.doesNotMatch(src.slice(src.indexOf('f123_errores_log')-400,src.indexOf('f123_errores_log')+900),/fetch\(|XMLHttpRequest|alert\(|innerHTML/);
});
