'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const c = fs.readFileSync(path.join(__dirname, '../docs/crypto-store.js'), 'utf8');
const a = fs.readFileSync(path.join(__dirname, '../docs/auth-ui.js'), 'utf8');
const start = c.indexOf('  async function identificarPin(pin) {');
const end = c.indexOf('  function limpiarLockouts()', start);
assert.ok(start>0 && end>start);
const method=c.slice(start,end);
const lic='F123-SYNTHETIC-NOT-REAL';
async function identify(joined, ready, pin='432', isCurrent=true) {
 const fn=new Function('joined','ready','pin','isCurrent','lic',
 'const window={OCTienda:{licenciaActual:()=>lic,esUnida:()=>joined},OCYjs:{roomId:"synthetic-room",canal:{recuperando:!ready},meta:{get:k=>k==="pinsRol"?{owner:"432",emp:"671",acct:"128"}:null}}};'+
 'const localStorage={getItem:k=>k==="f123_owned"?JSON.stringify({licenseCode:isCurrent?lic:"F123-OTHER",instanceId:"synthetic-device"}):null};'+
 'const leerSecreto=()=>null;'+method+';return identificarPin(pin);');
 return fn(joined,ready,pin,isCurrent,lic);
}
test('same authenticated, recovered license unlocks browser-joined AND installed-PWA-owned contexts',async()=>{
 assert.equal(await identify(true,true),'dueno');
 assert.equal(await identify(false,true),'dueno');
 assert.equal(await identify(false,true,'671'),'empleado');
 assert.equal(await identify(false,true,'128'),'contador');
});
test('both contexts deny incomplete recovery, wrong namespace, demo and wrong PIN',async()=>{
 assert.equal(await identify(true,false),null);
 assert.equal(await identify(false,false),null);
 assert.equal(await identify(false,true,'432',false),null);
 assert.equal(await identify(false,true,'456'),null);
 assert.equal(await identify(false,true,'000'),null);
});
test('successful login never rewrites f123_secure or repeats expensive PBKDF2',async()=>{
 const at=a.indexOf('  async function alinearYEntrar(code, rolEntrada) {');
 const end=a.indexOf('  async function validar(code)',at);
 assert.ok(at>0 && end>at);
 const src=a.slice(at,end);
 const code=src+';return alinearYEntrar("432","dueno");';
 let mutations=0, entries=0;
 const fn=new Function('window','localStorage','entrar',code);
 const storage={getItem:()=>null};
 const window={OCSecure:{recordarPinQueAbre(){},fijarOwnerPin(){mutations++;return Promise.resolve(true)}},OCTienda:{esUnida:()=>false}};
 await fn(window,storage,()=>{entries++;return true});
 assert.equal(entries,1);
 assert.equal(mutations,0,'login is authentication only; Advanced owns PIN writes');
});
