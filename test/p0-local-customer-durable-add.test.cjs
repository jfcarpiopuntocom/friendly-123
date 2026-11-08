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


test('P0 same-tab FIFO: rejected first Add cannot erase a later durable customer',async()=>{
  // Two HTTP POSTs may overlap even in one apparatus (different tabs/routes).
  // Inject controlled strict IndexedDB CAS results; do not touch real records.
  const w=browser();w.OCAuth={rolActual:()=> 'dueno'};
  const writes=[];
  w.OCEstadoIDB={
    soportado:true,
    guardarConRevision:(snapshot,revision)=>new Promise(resolve=>{
      writes.push({resolve,revision,snapshot:JSON.parse(JSON.stringify(snapshot))});
    }),
    ultimoError:()=>null
  };
  const names=['Synthetic rejected concurrent Add P0','Synthetic accepted concurrent Add P0'];
  const add=nombre=>w.fetch('/api/clientes',{
    method:'POST',body:JSON.stringify({nombre,telefono:'0000000000'})
  });
  const first=add(names[0]);
  for(let i=0;i<200&&writes.length<1;i++)await Promise.resolve();
  assert.equal(writes.length,1,'the first customer starts a real strict CAS');
  const second=add(names[1]);
  for(let tick=0;tick<60;tick++)await Promise.resolve();
  assert.equal(writes.length,1,'same-tab business writes must stay FIFO until the first ACK or rejection');
  // Reject the older CAS while the second customer request is queued.
  writes[0].resolve(false);
  for(let i=0;i<300&&writes.length<2;i++)await Promise.resolve();
  assert.equal(writes.length,2,'second Add must eventually reach a strict CAS');
  // Allow the independent newer Add to commit, whichever snapshot it received.
  writes[1].resolve(true);
  const [a,b]=await Promise.all([first,second]);
  assert.notEqual(a.status,200,'failed older Add must not claim success');
  assert.equal(b.status,200,'independently committed newer Add must succeed');
  const after=await w.request('/api/respaldo/exportar');
  assert.equal(after.clientes.filter(c=>c.nombre===names[0]).length,0,
    'rejected first customer must not appear');
  assert.equal(after.clientes.filter(c=>c.nombre===names[1]).length,1,
    'rollback of the older request must not delete the newer committed customer');
  assert.equal(after.movimientos.filter(m=>m.tipo==='cliente-alta'&&m.detalle?.cliente===names[1]).length,1,
    'newer accepted customer must retain exactly one audit movement');
});


test('P0 cross-tab CAS: a losing customer Add cannot erase the other tab\'s committed customer',async()=>{
  // Distinct VM/browser windows share durable storage but not the same-tab
  // write FIFO. Synthetic IDB strictly mimics one atomic revision CAS.
  const a=browser(),b=browser(a.localStorage);
  a.OCAuth={rolActual:()=> 'dueno'};
  b.OCAuth={rolActual:()=> 'dueno'};
  let persisted=null,revision=0;
  const writes=[];
  for(const [device,w] of [['A',a],['B',b]]){
    w.OCEstadoIDB={
      soportado:true,
      guardarConRevision:(snapshot,expected)=>new Promise(resolve=>{
        writes.push({device,resolve,expected,snapshot:JSON.parse(JSON.stringify(snapshot))});
      }),
      leer:async()=>persisted ? JSON.parse(JSON.stringify(persisted)) : null,
      ultimoError:()=>null
    };
  }
  const nameA='Synthetic independent tab A losing CAS';
  const nameB='Synthetic independent tab B durable customer';
  const post=(w,nombre)=>w.fetch('/api/clientes',{
    method:'POST',body:JSON.stringify({nombre,telefono:'0000000000'})
  });
  const pendingA=post(a,nameA);
  for(let i=0;i<200&&writes.length<1;i++)await Promise.resolve();
  assert.equal(writes.length,1);
  assert.equal(writes[0].device,'A');
  const pendingB=post(b,nameB);
  for(let i=0;i<200&&writes.length<2;i++)await Promise.resolve();
  assert.equal(writes.length,2,
    'separate windows must reach CAS independently, without sharing a tab FIFO');
  assert.equal(writes[1].device,'B');
  assert.equal(writes[0].expected,writes[1].expected,
    'both attempted to commit against the same previous durable revision');
  // B wins the exact shared CAS. A must reject its stale snapshot.
  assert.equal(writes[1].expected,revision);
  persisted=writes[1].snapshot;
  revision=persisted._rev;
  writes[1].resolve(true);
  const responseB=await pendingB;
  assert.equal(responseB.status,200);
  assert.notEqual(writes[0].expected,revision,'A is now objectively stale');
  writes[0].resolve(false);
  const responseA=await pendingA;
  assert.notEqual(responseA.status,200,'stale losing customer must not be acknowledged');
  assert.equal(persisted.clientes.filter(c=>c.nombre===nameA).length,0);
  assert.equal(persisted.clientes.filter(c=>c.nombre===nameB).length,1,
    'failed A must not delete B from the shared durable snapshot');
  assert.equal(persisted.movimientos.filter(m=>m.tipo==='cliente-alta'&&m.detalle?.cliente===nameB).length,1,
    'winning B keeps one durable audit movement');
  const reopened=browser(a.localStorage);
  reopened.OCAuth={rolActual:()=> 'dueno'};
  const after=await reopened.request('/api/clientes');
  assert.equal(after.filter(c=>c.nombre===nameB).length,1,
    'the winning durable customer must survive a fresh same-apparatus reload');
  assert.equal(after.filter(c=>c.nombre===nameA).length,0,
    'the losing tab must not resurrect its uncommitted customer');
});
