"use strict";
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {webcrypto}=require('node:crypto');
const {browser}=require('./helpers/browser.cjs');
const BASE='f123_estado_v4', A=BASE+'_A', B=BASE+'_B', PTR=BASE+'_ptr', JOURNAL=BASE+'_journal';

// Web Storage counts UTF-16 keys and values; quota errors leave prior bytes intact.
function disk(entries={}) {
  const map=new Map(Object.entries(entries));
  const store={map,events:[],limit:Infinity,beforeSet:null,beforeGet:null,beforeRemove:null,
    get length(){return map.size;},key:i=>[...map.keys()][i],
    getItem(k){k=String(k);if(store.beforeGet)store.beforeGet(k);return map.get(k)??null;},
    setItem(k,v){
      k=String(k);v=String(v);if(store.beforeSet)store.beforeSet(k,v);
      const size=[...map].reduce((n,[key,value])=>n+2*(key.length+value.length),0);
      const old=map.has(k)?2*(k.length+map.get(k).length):0;
      if(size-old+2*(k.length+v.length)>store.limit)throw new DOMException('synthetic quota','QuotaExceededError');
      store.events.push(['set',k,v]);map.set(k,v);
    },
    removeItem(k){k=String(k);if(store.beforeRemove&&store.beforeRemove(k)===false)return;store.events.push(['remove',k]);map.delete(k);}
  };
  return store;
}
function snapshot(label,rev) {
  return {schemaVersion:3,_rev:rev,ubicaciones:[{id:'synthetic-shelf',nombre:'Synthetic shelf',foto:'data:image/jpeg;base64,'+label}],
    productos:[{id:'synthetic-product',nombre:'Synthetic product',ubicacionId:'synthetic-shelf',precio:8,costo:3,stockActual:7}],
    ventas:[],movimientos:[{id:'history-'+label,tipo:'synthetic-history',fecha:'2026-01-01',detalle:label}],
    transferencias:[],gastos:[],ajustesComision:[],payouts:[],sucursales:[],promotoras:[],clientes:[],usuarios:[],
    configuracion:{retencion:{id:'retencion',dias:7}},nombreNegocio:'Synthetic '+label,instanceId:'synthetic-instance'};
}
function fixture({priorTarget=true}={}) {
  const oldA=JSON.stringify(snapshot('ACTIVE-A',10)),oldB=JSON.stringify(snapshot('UNIQUE-B',9));
  const storage=disk({[A]:oldA,...(priorTarget?{[B]:oldB}:{}),[PTR]:'A',f123_notebook_unificado_v2:'1'});
  const app=browser(storage);app.OCAuth={rolActual:()=> 'dueno'};
  return {storage,app,oldA,oldB};
}
const hold=(app,dias=14)=>app.fetch('/api/config/retencion',{method:'PUT',body:JSON.stringify({dias})});
const exportState=app=>app.request('/api/respaldo/exportar');
function pointerAndRestoreFailure(f,{swallowDelete=false}={}) {
  f.storage.beforeSet=(k,v)=>{
    if(k===JOURNAL&&JSON.parse(v).phase==='COMMITTED')throw Error('synthetic commit marker failure');
    if(k===PTR&&v==='B')throw Error('synthetic pointer failure');
    if(k===B&&v===f.oldB)throw Error('synthetic restore failure');
  };
  if(swallowDelete)f.storage.beforeRemove=k=>k===B?false:undefined;
}

test('rejected full-backend save preserves unique prior B for recovery after active A corruption',async()=>{
  const f=fixture();pointerAndRestoreFailure(f);
  assert.equal((await hold(f.app)).status,507);
  assert.equal(f.storage.getItem(PTR),'A');
  f.storage.beforeSet=null;f.storage.map.set(A,'{corrupt active A');
  const recovered=await exportState(browser(f.storage));
  assert.equal(recovered.nombreNegocio,'Synthetic UNIQUE-B');
  assert.equal(recovered.ubicaciones[0].foto,'data:image/jpeg;base64,UNIQUE-B');
  assert.ok(recovered.movimientos.some(m=>m.id==='history-UNIQUE-B'));
  assert.equal(recovered.configuracion.retencion.dias,7,'rejected pending retention is never adopted');
});

test('swallowed failed deletion cannot make rejected B into a committed restart fallback',async()=>{
  const f=fixture();pointerAndRestoreFailure(f,{swallowDelete:true});
  assert.equal((await hold(f.app)).status,507);
  f.storage.beforeSet=null;f.storage.map.set(A,'{corrupt active A');
  const recovered=await exportState(browser(f.storage));
  assert.equal(recovered.nombreNegocio,'Synthetic UNIQUE-B');
  assert.equal(recovered.configuracion.retencion.dias,7);
  assert.ok(recovered.movimientos.some(m=>m.id==='history-UNIQUE-B'));
});


function helper(storage,extra={}) {
  const context={localStorage:storage,crypto:webcrypto,navigator:{},...extra};
  context.window=context;vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../docs/estado-ab.js'),'utf8'),context);
  return context.OCEstadoAB.crear({storage,claveBase:BASE});
}
const raw=(name,rev)=>JSON.stringify({...snapshot(name,rev),_abCommit:'synthetic-token-'+name});
const committedName=reader=>JSON.parse(reader.leer().buffers[reader.leer().activo]).nombreNegocio;

for (const priorTarget of [true,false]) {
  test('failed commit marker exposes only preimage; prior target '+priorTarget,async()=>{
    const f=fixture({priorTarget}),reader=helper(f.storage);
    pointerAndRestoreFailure(f,{swallowDelete:true});
    assert.equal(await reader.guardar(raw('REJECTED',11)),false);
    const view=reader.leer();
    assert.equal(view.activo,'A');assert.equal(view.buffers.A,f.oldA);
    assert.equal(view.buffers.B,priorTarget?f.oldB:null);
    assert.equal(f.storage.events.some(([op])=>op==='remove'),false,'protocol never relies on deletions');
  });
}

test('preimage journal failure aborts before either prior snapshot is overwritten',async()=>{
  const f=fixture(),reader=helper(f.storage);f.storage.events.length=0;
  f.storage.beforeSet=k=>{if(k===JOURNAL)throw Error('synthetic journal quota');};
  assert.equal(await reader.guardar(raw('REJECTED',11)),false);
  assert.equal(f.storage.getItem(A),f.oldA);assert.equal(f.storage.getItem(B),f.oldB);
  assert.equal(f.storage.events.some(([,k])=>k===A||k===B),false);
});

test('native journal access failure is not mistaken for journal absence',async()=>{
  const f=fixture(),reader=helper(f.storage);f.storage.events.length=0;
  f.storage.beforeGet=k=>{if(k===JOURNAL)throw new DOMException('synthetic storage denied','SecurityError');};
  assert.throws(()=>reader.leer(),/synthetic storage denied/);
  assert.equal(await reader.guardar(raw('REJECTED',11)),false);
  assert.equal(f.storage.events.length,0,'fail closed before writing snapshots');
});

test('ordinary byte quota preserves A, B, old photo keys and movement evidence',async()=>{
  const f=fixture(),reader=helper(f.storage);
  f.storage.setItem('legacy-photo-key','unique photo evidence');
  const before=new Map(f.storage.map);
  f.storage.limit=[...before].reduce((n,[k,v])=>n+2*(k.length+v.length),0);
  assert.equal(await reader.guardar(raw('TOO-LARGE',11)),false);
  assert.deepEqual(f.storage.map,before,'atomic quota failure retains every old byte');
});

test('pointer hint failure after a durable commit is successful and survives fresh readers',async()=>{
  const f=fixture(),reader=helper(f.storage);
  f.storage.beforeSet=k=>{if(k===PTR)throw Error('synthetic pointer hint failure');};
  assert.equal(await reader.guardar(raw('COMMITTED',11)),true);
  assert.equal(f.storage.getItem(PTR),'A','old pointer does not override committed journal');
  assert.equal(committedName(helper(f.storage)),'Synthetic COMMITTED');
  f.storage.beforeSet=null;
  const reloaded=await exportState(browser(f.storage));
  assert.equal(reloaded.nombreNegocio,'Synthetic COMMITTED');
});

test('unresolved journal restoration blocks the next overwrite and retains its preimage',async()=>{
  const f=fixture(),reader=helper(f.storage);pointerAndRestoreFailure(f);
  assert.equal(await reader.guardar(raw('REJECTED',11)),false);
  const pending=f.storage.getItem(JOURNAL),storedB=f.storage.getItem(B);
  assert.equal(await reader.guardar(raw('NEXT-REJECTED',12)),false);
  assert.equal(f.storage.getItem(JOURNAL),pending,'do not replace the only historical preimage');
  assert.equal(f.storage.getItem(B),storedB,'do not overwrite an unresolved candidate');
  assert.equal(reader.leer().buffers.B,f.oldB);
});

test('completed preimage restoration allows repeated A/B/A commits and fresh views',async()=>{
  const f=fixture(),reader=helper(f.storage);pointerAndRestoreFailure(f);
  assert.equal(await reader.guardar(raw('REJECTED',11)),false);
  f.storage.beforeSet=null;
  for(const [name,rev] of [['FIRST',12],['SECOND',13],['THIRD',14]]){
    assert.equal(await reader.guardar(raw(name,rev)),true);
    assert.equal(committedName(helper(f.storage)),'Synthetic '+name);
  }
  assert.equal((await exportState(browser(f.storage))).nombreNegocio,'Synthetic THIRD');
});

for (const idbResult of [true,false,1,'true',{},null,undefined]) {
  test('full backend authorizes IDB fallback only for exact true: '+String(idbResult),async()=>{
    const f=fixture(),before=await exportState(f.app),writes=[];
    f.app.OCEstadoIDB={guardar:async(body,strict)=>{writes.push({body:JSON.parse(JSON.stringify(body)),strict});return idbResult;}};
    f.storage.beforeSet=()=>{throw new DOMException('synthetic quota','QuotaExceededError');};
    const response=await hold(f.app);
    assert.equal(response.status,idbResult===true?200:507);
    assert.equal(writes.length,1,'one full snapshot mirrored after the local decision');
    assert.equal(writes[0].strict,true,'fallback cannot accept a reduced snapshot');
    assert.equal(writes[0].body.configuracion.retencion.dias,14);
    const after=await exportState(f.app);
    assert.equal(after.configuracion.retencion.dias,idbResult===true?14:before.configuracion.retencion.dias);
    assert.equal(f.storage.getItem(A),f.oldA);assert.equal(f.storage.getItem(B),f.oldB);
  });
}

test('full backend waits for the real IDB acknowledgement before reporting success',async()=>{
  const f=fixture();let resolve,entered=false;
  f.app.OCEstadoIDB={guardar:()=>{entered=true;return new Promise(r=>{resolve=r;});}};
  f.storage.beforeSet=()=>{throw new DOMException('synthetic quota','QuotaExceededError');};
  let finished=false;const pending=hold(f.app).then(r=>{finished=true;return r;});
  for(let i=0;i<12&&!entered;i++)await Promise.resolve();
  assert.equal(entered,true);assert.equal(finished,false,'pending is not durable success');
  resolve(true);assert.equal((await pending).status,200);
});

test('two helper instances observe committed revisions across A/B/A without stale pointer authority',async()=>{
  const f=fixture(),one=helper(f.storage),two=helper(f.storage);
  assert.equal(await one.guardar(raw('TAB-ONE',11)),true);
  assert.equal(committedName(two),'Synthetic TAB-ONE');
  assert.equal(await two.guardar(raw('TAB-TWO',12)),true);
  assert.equal(committedName(one),'Synthetic TAB-TWO');
  assert.equal(await one.guardar(raw('TAB-ONE-AGAIN',13)),true);
  assert.equal(committedName(two),'Synthetic TAB-ONE-AGAIN');
});

test('legacy A/B snapshots remain readable before and after the first transactional commit',async()=>{
  const f=fixture(),reader=helper(f.storage);
  assert.equal(reader.leer().buffers.A,f.oldA);assert.equal(reader.leer().buffers.B,f.oldB);
  assert.equal(committedName(reader),'Synthetic ACTIVE-A');
  assert.equal(await reader.guardar(raw('MODERN',11)),true);
  assert.equal(committedName(helper(f.storage)),'Synthetic MODERN');
});


test('legacy overwrite during committed journal write preserves both exact accepted bytes and foreign snapshot',async()=>{
  const f=fixture(),reader=helper(f.storage),peer=raw('LEGACY-PEER',12);
  f.storage.beforeSet=(k,v)=>{
    if(k===JOURNAL&&JSON.parse(v).phase==='COMMITTED'){
      f.storage.map.set(B,peer);f.storage.map.set(PTR,'B');f.storage.map.set(PTR,'A');
    }
  };
  const candidate=raw('JOURNAL-COMMITTED',11);
  assert.equal(await reader.guardar(candidate),true,'full committed journal is durable even after a foreign physical overwrite');
  assert.equal(reader.leer().buffers.B,candidate,'exact accepted candidate comes from its durable journal');
  assert.equal(f.storage.getItem(B),peer,'do not roll back a newer legacy snapshot');
  f.storage.beforeSet=null;
  assert.equal(await reader.guardar(raw('NEXT',13)),false,'unresolved foreign bytes block the next overwrite');
  assert.equal(f.storage.getItem(B),peer);
});

test('pending journal refuses to overwrite a legacy committed snapshot from another tab',async()=>{
  const f=fixture(),reader=helper(f.storage);pointerAndRestoreFailure(f);
  assert.equal(await reader.guardar(raw('REJECTED',11)),false);
  const journal=f.storage.getItem(JOURNAL),peer=raw('LEGACY-PEER',12);
  f.storage.map.set(B,peer);f.storage.map.set(PTR,'B');f.storage.beforeSet=null;
  assert.equal(await helper(f.storage).guardar(raw('NEXT',13)),false);
  assert.equal(f.storage.getItem(B),peer);assert.equal(f.storage.getItem(JOURNAL),journal);
});

test('failed restoration of a missing preimage remains safe when removeItem swallows failure',async()=>{
  const f=fixture({priorTarget:false}),reader=helper(f.storage);pointerAndRestoreFailure(f,{swallowDelete:true});
  assert.equal(await reader.guardar(raw('REJECTED',11)),false);
  const journal=f.storage.getItem(JOURNAL),pending=f.storage.getItem(B);
  assert.equal(await reader.guardar(raw('NEXT',12)),false,'readback detects removal that did nothing');
  assert.equal(f.storage.getItem(JOURNAL),journal);assert.equal(f.storage.getItem(B),pending);
  assert.equal(reader.leer().buffers.B,null,'uncommitted buffer cannot become a recovery fallback');
});


test('same nonce with altered physical payload cannot replace the exact committed journal snapshot',async()=>{
  const f=fixture(),reader=helper(f.storage),candidate=raw('COMMITTED',11);
  assert.equal(await reader.guardar(candidate),true);
  const altered=JSON.parse(candidate);altered.nombreNegocio='Synthetic ALTERED';
  f.storage.map.set(B,JSON.stringify(altered));
  assert.equal(reader.leer().buffers.B,candidate,'logical view retains the original exact bytes');
  assert.equal(await reader.guardar(raw('NEXT',12)),false,'do not erase unexpected changed physical bytes');
  assert.equal(f.storage.getItem(B),JSON.stringify(altered));
});

test('pending cleanup does not overwrite changed bytes that retained a candidate nonce',async()=>{
  const f=fixture(),reader=helper(f.storage),candidate=raw('REJECTED',11);
  pointerAndRestoreFailure(f);assert.equal(await reader.guardar(candidate),false);
  const peer=JSON.parse(candidate);peer.nombreNegocio='Synthetic PEER-EDIT';
  const peerRaw=JSON.stringify(peer),journal=f.storage.getItem(JOURNAL);
  f.storage.map.set(B,peerRaw);f.storage.beforeSet=null;
  assert.equal(await reader.guardar(raw('NEXT',12)),false);
  assert.equal(f.storage.getItem(B),peerRaw,'preserve unexpected third-party bytes');
  assert.equal(f.storage.getItem(JOURNAL),journal,'preserve historical preimage evidence');
});

test('corrupt physical active buffer reopens its exact committed journal snapshot',async()=>{
  const f=fixture(),reader=helper(f.storage);
  assert.equal(await reader.guardar(raw('COMMITTED',11)),true);
  f.storage.map.set(B,'{synthetic corrupt committed B');
  const recovered=await exportState(browser(f.storage));
  assert.equal(recovered.nombreNegocio,'Synthetic COMMITTED');
  assert.equal(recovered.ubicaciones[0].foto,'data:image/jpeg;base64,COMMITTED');
  assert.ok(recovered.movimientos.some(m=>m.id==='history-COMMITTED'));
});


test('successful native commit is not reported rejected when its next journal read throws',async()=>{
  const f=fixture(),reader=helper(f.storage),candidate=raw('DURABLE',11);
  f.storage.beforeSet=(k,v)=>{
    if(k===JOURNAL&&JSON.parse(v).phase==='COMMITTED')f.storage.beforeGet=key=>{if(key===JOURNAL)throw Error('synthetic later read failure');};
  };
  assert.equal(await reader.guardar(candidate),true);
  f.storage.beforeSet=null;f.storage.beforeGet=null;
  assert.equal(helper(f.storage).leer().buffers.B,candidate);
});

test('valid committed journal remains authority when the legacy pointer hint is corrupt',async()=>{
  const f=fixture(),reader=helper(f.storage),candidate=raw('DURABLE',11);
  assert.equal(await reader.guardar(candidate),true);f.storage.map.set(PTR,'corrupt-pointer-hint');
  assert.equal(helper(f.storage).leer().buffers.B,candidate);
  assert.equal((await exportState(browser(f.storage))).nombreNegocio,'Synthetic DURABLE');
});


test('failed startup consolidation preserves joined namespace and does not mark migration complete',async()=>{
  const suffix='::SYNTHETIC-JOINED',oldA=JSON.stringify(snapshot('JOINED-A',10)),oldB=JSON.stringify(snapshot('JOINED-B',9));
  const storage=disk({[BASE+suffix+'_A']:oldA,[BASE+suffix+'_B']:oldB,[BASE+suffix+'_ptr']:'A',f123_tienda_activa:suffix});
  storage.beforeSet=k=>{if(k===JOURNAL)throw new DOMException('synthetic migration quota','QuotaExceededError');};
  const app=browser(storage);
  assert.equal(storage.getItem('f123_tienda_activa'),suffix,'failed migration cannot orphan the selected namespace');
  assert.notEqual(storage.getItem('f123_notebook_unificado_v2'),'1','uncommitted consolidation is never marked complete');
  assert.equal(storage.getItem(BASE+suffix+'_A'),oldA);assert.equal(storage.getItem(BASE+suffix+'_B'),oldB);
  assert.equal((await exportState(app)).nombreNegocio,'Synthetic JOINED-A');
});

test('boot read failure blocks later writes instead of replacing inaccessible history with seed data',async()=>{
  const oldA=JSON.stringify(snapshot('ACTIVE-A',10)),oldB=JSON.stringify(snapshot('UNIQUE-B',9));
  const storage=disk({[A]:oldA,[B]:oldB,[PTR]:'A',f123_notebook_unificado_v2:'1'});
  storage.beforeGet=k=>{if(k===JOURNAL)throw new DOMException('synthetic journal access denied','SecurityError');};
  const app=browser(storage);app.OCAuth={rolActual:()=> 'dueno'};
  assert.equal((await hold(app)).status,507);
  assert.equal(storage.map.get(A),oldA);assert.equal(storage.map.get(B),oldB);
  assert.equal(storage.events.some(([,k])=>k===A||k===B||k===JOURNAL),false);
});


test('two full backend tabs serialize writes and retain both committed audit movements',async()=>{
  const f=fixture(),second=browser(f.storage),tails=new Map();
  const locks={request(name,options,callback){
    const run=typeof options==='function'?options:callback;
    const current=(tails.get(name)||Promise.resolve()).then(()=>run());
    tails.set(name,current.catch(()=>{}));return current;
  }};
  for(const app of [f.app,second]){app.navigator.locks=locks;app.OCAuth={rolActual:()=> 'dueno'};}
  const results=await Promise.all([hold(f.app,14),hold(second,30)]);
  assert.ok(results.every(result=>result.status===200));
  const reloaded=await exportState(browser(f.storage));
  assert.equal(reloaded.configuracion.retencion.dias,30);
  assert.equal(reloaded.movimientos.filter(m=>m.tipo==='config-retencion').length,2,
    'second tab reloads first durable state before its own write');
  assert.ok(reloaded.movimientos.some(m=>m.id==='history-ACTIVE-A'));
});

test('PREPARED recovery leaves its pointer untouched and accepts the next real save',async()=>{
  const f=fixture();pointerAndRestoreFailure(f,{swallowDelete:true});
  assert.equal((await hold(f.app)).status,507);
  f.storage.beforeSet=null;f.storage.map.set(A,'{corrupt active');
  const app=browser(f.storage);app.OCAuth={rolActual:()=> 'dueno'};
  assert.equal((await exportState(app)).nombreNegocio,'Synthetic UNIQUE-B');
  assert.equal(f.storage.getItem(PTR),'A','virtual preimage must not point legacy readers at a rejected physical candidate');
  assert.equal((await hold(app,30)).status,200);
  assert.equal((await exportState(browser(f.storage))).configuracion.retencion.dias,30);
});

test('Dashboard uses the same preimage after active corruption instead of a rejected candidate',async()=>{
  const f=fixture();pointerAndRestoreFailure(f,{swallowDelete:true});
  assert.equal((await hold(f.app)).status,507);
  f.storage.map.set(A,'{corrupt active');
  const html=fs.readFileSync(path.join(__dirname,'../docs/dashboard.html'),'utf8');
  const start=html.indexOf('  function leerEstadoLocal() {');
  const source=html.slice(start,html.indexOf('  /* Read the complete IndexedDB mirror',start));
  const context={window:{OCEstadoAB:{crear:()=>helper(f.storage)}},localStorage:{getItem:k=>k==='f123_owned'?'{}':f.storage.getItem(k)},K_ESTADO:BASE,sufijoTienda:()=>''};
  vm.createContext(context);vm.runInContext(source+';this.state=leerEstadoLocal();',context);
  assert.equal(context.state.nombreNegocio,'Synthetic UNIQUE-B');
  assert.equal(context.state.configuracion.retencion.dias,7);
});

test('known PREPARED restoration quota permits another exact IDB commit without overwriting its journal',async()=>{
  const f=fixture();pointerAndRestoreFailure(f,{swallowDelete:true});
  f.app.OCEstadoIDB={guardar:async()=>true};
  assert.equal((await hold(f.app,14)).status,200,'first attempt is confirmed only in IDB');
  const journal=f.storage.getItem(JOURNAL);let mirrored;
  f.app.OCEstadoIDB={guardar:async state=>{mirrored=JSON.parse(JSON.stringify(state));return true;}};
  assert.equal((await hold(f.app,30)).status,200,'restoration failure must not disable healthy IDB');
  assert.equal(mirrored.configuracion.retencion.dias,30);
  assert.equal(f.storage.getItem(JOURNAL),journal,'pending recovery evidence remains byte-identical');
});

test('foreign physical bytes never authorize an IDB fallback from stale RAM',async()=>{
  const f=fixture();assert.equal((await hold(f.app,14)).status,200);
  f.storage.map.set(B,JSON.stringify(snapshot('FOREIGN',30)));
  let calls=0;f.app.OCEstadoIDB={guardar:async()=>{calls++;return true;}};
  assert.equal((await hold(f.app,30)).status,507);
  assert.equal(calls,0,'conflict must not masquerade as ordinary quota');
  assert.equal(JSON.parse(f.storage.getItem(B)).nombreNegocio,'Synthetic FOREIGN');
});

test('a third value appearing during preimage readback cannot authorize IDB fallback',async()=>{
  const f=fixture();pointerAndRestoreFailure(f,{swallowDelete:true});
  assert.equal((await hold(f.app)).status,507);
  let restored=false,calls=0;const foreign=JSON.stringify(snapshot('FOREIGN-READBACK',30));
  f.storage.beforeSet=(k,v)=>{if(k===B&&v===f.oldB)restored=true;};
  f.storage.beforeGet=k=>{if(k===B&&restored){restored=false;f.storage.map.set(B,foreign);}};
  f.app.OCEstadoIDB={guardar:async()=>{calls++;return true;}};
  assert.equal((await hold(f.app,30)).status,507);
  assert.equal(calls,0);assert.equal(f.storage.getItem(B),foreign);
});

test('a foreign readable snapshot is exported intact and blocks publication until resolved',async()=>{
  const f=fixture(),reader=helper(f.storage),foreign=raw('FOREIGN-READABLE',12);
  assert.equal(await reader.guardar(raw('ACCEPTED',11)),true);
  f.storage.map.set(B,foreign);
  const app=browser(f.storage);app.OCAuth={rolActual:()=> 'dueno'};
  const state=await exportState(app);
  assert.ok(state.recuperacionAB.copias.some(copy=>copy.raw===foreign),'foreign bytes remain readable in the ordinary full backup');
  assert.equal(app.OCSync.catalogoPropio(),null,'do not publish a silently selected branch');
  let calls=0;app.OCEstadoIDB={guardar:async()=>{calls++;return true;}};
  assert.equal((await hold(app,30)).status,507);assert.equal(calls,0);
  assert.equal(f.storage.getItem(B),foreign);
});

test('corrupt physical bytes remain preserved while healthy IDB accepts the next save',async()=>{
  const f=fixture(),reader=helper(f.storage);
  assert.equal(await reader.guardar(raw('ACCEPTED',11)),true);
  f.storage.map.set(B,'{corrupt');
  const app=browser(f.storage);app.OCAuth={rolActual:()=> 'dueno'};
  let accepted;app.OCEstadoIDB={guardar:async body=>{accepted=body;return true;}};
  assert.equal((await hold(app,30)).status,200);
  assert.equal(accepted.configuracion.retencion.dias,30);
  assert.equal(f.storage.getItem(B),'{corrupt','do not destroy forensic bytes during recovery');
});
