'use strict';
// v637: COMMITTED sin preimagen; lector v636 real pinneado en fixtures.
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
function cargar(src){const mem=new Map();const storage={getItem:k=>mem.has(k)?mem.get(k):null,setItem:(k,v)=>mem.set(k,String(v)),removeItem:k=>mem.delete(k)};
 const win={localStorage:storage,crypto:require('node:crypto').webcrypto};const ctx=vm.createContext({window:win,JSON,Map,Set,Number,Object,Array,Math,Error,Uint32Array,String});
 vm.runInContext(src,ctx);return {mem,storage,AB:win.OCEstadoAB||ctx.OCEstadoAB};}
const nuevo=fs.readFileSync(path.join(__dirname,'../docs/estado-ab.js'),'utf8');
const v636=fs.readFileSync(path.join(__dirname,'fixtures/estado-ab-v636.js'),'utf8');
test('COMMITTED sin preimagen: lo escribe v637 y lo leen v637 y v636',()=>{
 const a=cargar(nuevo);assert.ok(a.AB&&a.AB.crear,'API OCEstadoAB.crear');
 const ab=a.AB.crear({claveBase:'t',storage:a.storage,leer:k=>a.storage.getItem(k)});
 for(let rev=1;rev<=3;rev++) assert.equal(ab.guardarAhora(JSON.stringify({_rev:rev,datos:'x'.repeat(1000)+rev})),true);
 const j=JSON.parse(a.mem.get('t_journal'));assert.equal(j.phase,'COMMITTED');assert.equal(j.anterior,null);
 assert.equal(JSON.parse(ab.leer().buffers[ab.leer().activo])._rev,3);
 const b=cargar(v636);const viejo=b.AB.crear({claveBase:'t',storage:a.storage,leer:k=>a.storage.getItem(k)});
 const vista=viejo.leer();assert.equal(JSON.parse(vista.buffers[vista.activo])._rev,3);assert.equal(vista.conflictos.length,0);assert.equal(vista.danados.length,0);
});
