'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {browser}=require('./helpers/browser.cjs');
const root=path.join(__dirname,'..');

test('P0 ONE apparatus: Add Customer must NOT acknowledge an uncommitted write',async()=>{
  const w=browser();w.OCAuth={rolActual:()=> 'dueno'};
  const original=w.localStorage.setItem.bind(w.localStorage);
  w.localStorage.setItem=()=>{const e=new Error('Synthetic quota');e.name='QuotaExceededError';throw e};
  w.OCEstadoIDB={
    soportado:true,
    guardar:async()=>false,
    guardarConRevision:async()=>false,
    ultimoError:()=>null
  };
  const before=await w.request('/api/respaldo/exportar');
  const result=await w.fetch('/api/clientes',{
    method:'POST',body:JSON.stringify({nombre:'Synthetic uncommitted draft',telefono:'0000000000'})
  });
  w.localStorage.setItem=original;
  assert.ok(result.status>=500,'an unsaved customer MUST NOT return HTTP 200');
  const after=await w.request('/api/respaldo/exportar');
  assert.equal(after.clientes.filter(c=>c.nombre==='Synthetic uncommitted draft').length,0,
    'failed Add must roll back the complete customer');
  assert.equal(after.movimientos.length,before.movimientos.length,
    'failed Add must roll back its audit movement');
});

test('P0 ONE apparatus: Add waits for exact IndexedDB ACK before success, then survives reload',async()=>{
  const w=browser();w.OCAuth={rolActual:()=> 'dueno'};
  let confirm,committed;let answered=false;
  w.OCEstadoIDB={soportado:true,guardarConRevision:(state,expected)=>{
    assert.ok(state._rev>expected);
    return new Promise(resolve=>{confirm=ok=>{
      if(ok)committed=JSON.parse(JSON.stringify(state));
      resolve(ok);
    }});
  },ultimoError:()=>null};
  const response=w.fetch('/api/clientes',{method:'POST',
    body:JSON.stringify({nombre:'Synthetic durable client',telefono:'0000000000'})}).then(r=>{answered=true;return r});
  for(let i=0;i<80&&!confirm;i++)await Promise.resolve();
  assert.equal(typeof confirm,'function','Add must request strict CAS');
  assert.equal(answered,false,'button may not receive success before commit');
  confirm(true);
  const saved=await response;
  assert.equal(saved.status,200);
  assert.equal(committed.clientes.filter(c=>c.nombre==='Synthetic durable client').length,1);
  const restored=browser(w.localStorage);restored.OCAuth={rolActual:()=> 'dueno'};
  const customers=await restored.request('/api/clientes');
  assert.equal(customers.filter(c=>c.nombre==='Synthetic durable client').length,1,
    'customer must survive reopening the same device');
});

test('P0 ONE apparatus: automatic shell reload refuses a dirty or saving customer form',()=>{
 const source=fs.readFileSync(path.join(root,'src/app/app-inline-03.js'),'utf8');
 const begin=source.indexOf('  function seguroCon(sinRecuperacion) {');
 const end=source.indexOf('  /* (JFC 2026-10-27) Parte Yjs',begin);
 assert.ok(begin>=0&&end>begin,'actual auto-update guard must be present');
 const dirty={value:'Synthetic unsaved name'};
 const save={disabled:false};
 const context={
  document:{getElementById:id=>id==='cliNombre'?dirty:id==='btnAltaCliente'?save:null,
    activeElement:{tagName:'BUTTON'},querySelectorAll:()=>[]},
  window:{__f123AltaClientePendiente:false},
  sessionStorage:{getItem:()=> '1'},
  recuperacionPendiente:()=>false,
  visible:()=>false,
  _ventasEnCurso:new Set(),
  getComputedStyle:()=>({display:'none'})
 };
 vm.createContext(context);
 vm.runInContext(source.slice(begin,end)+'this.check=seguroCon;',context);
 assert.equal(vm.runInContext('check(false)',context),false,
   'unfocused dirty customer form must block version auto-reload');
 dirty.value='';
 context.window.__f123AltaClientePendiente=true;
 assert.equal(vm.runInContext('check(false)',context),false,
   'pending customer Add must block version auto-reload');
 context.window.__f123AltaClientePendiente=false;
 assert.equal(vm.runInContext('check(false)',context),true,
   'normal empty form must allow the updater to resume');
});
