'use strict';
// P0 deterministic convergence of competing physical epoch read models.
// Isolated synthetic profiles. No customer data, real relay, PIN or license.
const {test}=require('node:test'),assert=require('node:assert/strict');
const {browser}=require('./helpers/browser.cjs');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {webcrypto}=require('node:crypto');

async function seed(w, epoch, base, pn, ts) {
  const f=await w.request('/api/respaldo/exportar');
  const p=f.productos.find(x=>Number(x.stockActual)>=1);
  assert.ok(p,'fixture product');
  const net=base+Object.values(pn).reduce((n,x)=>n+x.add-x.sub,0);
  f.productos=[{...p,id:'epoch-convergence',nombre:'Synthetic epoch convergence',
    barcode:'SYN-EPOCH',stockEpochId:epoch,stockBase:base,
    stockPN:pn,stockActual:Math.max(0,net),stockDeficit:Math.max(0,-net),
    stockTs:ts,rev:{c:1,d:'fixture'}}];
  f.ventas=[];f.movimientos=[];
  const result=await w.request('/api/respaldo/importar','POST',f);
  assert.ok(result,'seed imported');
}
const item=async w=>(await w.request('/api/respaldo/exportar')).productos.find(p=>p.id==='epoch-convergence');

test('P0 rival explicit epochs preserve each physical count and both witness histories',async()=>{
  const a=browser(),b=browser();
  await seed(a,'E-OLDER',7,{actorA:{add:2,sub:0}},1000);
  await seed(b,'E-NEWER',7,{actorB:{add:0,sub:1}},2000);
  // Take immutable copies BEFORE either side mutates.
  const ar=a.catalog(),br=b.catalog();
  a.OCSync.aplicarCatalogo(br,null);
  b.OCSync.aplicarCatalogo(ar,null);
  for(const [w,expected,epoch] of [[a,9,'E-OLDER'],[b,6,'E-NEWER']]){
    const p=await item(w);
    assert.equal(p.stockActual,expected);
    assert.equal(p.stockEpochId,epoch);
    assert.equal(p.stockEvidencias?.[JSON.stringify([7,'E-OLDER'])]?.pn?.actorA?.add,2,
      'losing same-base epoch survives full product export');
    assert.equal(p.stockEvidencias?.[JSON.stringify([7,'E-NEWER'])]?.pn?.actorB?.sub,1,
      'winning same-base epoch survives full product export');
  }
  for(let i=0;i<3;i++){
    const aa=a.catalog(),bb=b.catalog();
    a.OCSync.aplicarCatalogo(bb,null);b.OCSync.aplicarCatalogo(aa,null);
  }
  assert.equal((await item(a)).stockActual,9);
  assert.equal((await item(b)).stockActual,6);
});

test('P0 equal timestamps retain independent explicit epochs and their evidence',async()=>{
  const a=browser(),b=browser();
  await seed(a,'E-A',5,{actorA:{add:3,sub:0}},5000);
  await seed(b,'E-Z',9,{actorB:{add:0,sub:2}},5000);
  const ar=a.catalog(),br=b.catalog();
  b.OCSync.aplicarCatalogo(ar,null);a.OCSync.aplicarCatalogo(br,null);
  for(const [w,expected,epoch] of [[a,8,'E-A'],[b,7,'E-Z']]){
    const p=await item(w);
    assert.equal(p.stockActual,expected);
    assert.equal(p.stockEpochId,epoch);
    assert.ok(p.stockEvidencias?.[JSON.stringify([5,'E-A'])]?.pn?.actorA?.add===3,
      'losing independent epoch is exported with its identity');
    assert.ok(p.stockEvidencias?.[JSON.stringify([9,'E-Z'])]?.pn?.actorB?.sub===2,
      'winning independent epoch is exported with its identity');
  }
});

async function ypeer() {
  const w=browser();delete w.JSON;
  Object.assign(w,{crypto:webcrypto,TextEncoder,TextDecoder,
    F123Relay:{connect(){throw Error('External relay forbidden');}},
    BroadcastChannel:class{constructor(){throw Error('External channel forbidden');}}});
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../docs/vendor/yjs-bundle.min.js'),'utf8'),w);
  w.IndexeddbPersistence=class{once(){}};
  w.localStorage.setItem('f123_owned',JSON.stringify({licenseCode:'F123-SYNTHETIC-EPOCH'}));
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../docs/sync-yjs.js'),'utf8'),w);
  for(let i=0;i<100&&w.OCYjs.estado!=='activo';i++)
    await new Promise(resolve=>setTimeout(resolve,10));
  assert.equal(w.OCYjs.estado,'activo');
  return w;
}
function deliver(from,to){
  to.Y.applyUpdate(to.OCYjs.doc,from.Y.encodeStateAsUpdate(from.OCYjs.doc),'red');
  to.OCYjs._store.aplicar();
}
async function converge(a,b,reverse=false){
  for(let i=0;i<5;i++){
    a.OCYjs._store.sembrar();b.OCYjs._store.sembrar();
    if(reverse){deliver(b,a);deliver(a,b);}
    else {deliver(a,b);deliver(b,a);}
    await new Promise(resolve=>setImmediate(resolve));
  }
}
test('P0 Yjs cross-replay retains both movement witnesses without forging physical agreement',async()=>{
  for(const reverse of [false,true,false,true,false,true]){
    const a=await ypeer(),b=await ypeer();
    await seed(a,'E-OLDER',7,{actorA:{add:2,sub:0}},1000);
    await seed(b,'E-NEWER',7,{actorB:{add:0,sub:1}},2000);
    await converge(a,b,reverse);
    const pa=await item(a),pb=await item(b);
    assert.equal(pa.stockActual,9,'first device retains its physical count');
    assert.equal(pb.stockActual,6,'second device retains its physical count');
    assert.equal(pa.stockEpochId,'E-OLDER');
    assert.equal(pb.stockEpochId,'E-NEWER');
    assert.ok(a.OCYjs.stockPNTestigos.size>=2,'both source movement witnesses retained');
    assert.ok(b.OCYjs.stockPNTestigos.size>=2,'receiver retained both movement witnesses');
    function hasEpoch(p, epoch, actor, field, n){
      const active=p.stockEpochId===epoch && p.stockPN?.[actor]?.[field]===n;
      const historical=p.stockEvidencias?.[JSON.stringify([7,epoch])]?.pn?.[actor]?.[field]===n;
      return active || historical;
    }
    for(const p of [pa,pb]){
      assert.ok(hasEpoch(p,'E-OLDER','actorA','add',2),
        'export retains old epoch as active or historic evidence');
      assert.ok(hasEpoch(p,'E-NEWER','actorB','sub',1),
        'export retains new epoch as active or historic evidence');
    }
    await converge(b,a,!reverse);
    assert.equal((await item(a)).stockActual,9,'stable old epoch');
    assert.equal((await item(b)).stockActual,6,'stable new epoch');
  }
});
test('P0 six discrepant physical counts remain intact until owner-authorized reconciliation',async()=>{
  const a=browser(),b=browser();
  const fa=await a.request('/api/respaldo/exportar');
  const fb=await b.request('/api/respaldo/exportar');
  const template=fa.productos.find(p=>Number(p.stockActual)>=1);
  assert.ok(template);
  const pca=[3,4,7,7,6,16],mobile=[7,7,7,7,7,7];
  function rows(numbers,epoch,ts){
    return numbers.map((stock,i)=>({...template,id:'synthetic-item-'+i,
      nombre:'Synthetic item '+i,barcode:'SYN-5-'+i,
      stockActual:stock,stockBase:stock,stockDeficit:0,
      stockPN:{},stockEpochId:epoch+'-'+i,stockTs:ts,rev:{c:1,d:'fixture'}}));
  }
  fa.productos=rows(pca,'PC',1000);fa.ventas=[];fa.movimientos=[];
  fb.productos=rows(mobile,'PHONE',2000);fb.ventas=[];fb.movimientos=[];
  await a.request('/api/respaldo/importar','POST',fa);
  await b.request('/api/respaldo/importar','POST',fb);
  for(let round=0;round<4;round++){
    const aa=a.catalog(),bb=b.catalog();
    a.OCSync.aplicarCatalogo(bb,null);b.OCSync.aplicarCatalogo(aa,null);
  }
  const aa=(await a.request('/api/respaldo/exportar')).productos;
  const bb=(await b.request('/api/respaldo/exportar')).productos;
  for(let i=0;i<6;i++){
    const x=aa.find(p=>p.id==='synthetic-item-'+i);
    const y=bb.find(p=>p.id==='synthetic-item-'+i);
    assert.equal(x.stockActual,pca[i],'PC physical ledger untouched for product '+i);
    assert.equal(y.stockActual,7,'phone physical ledger untouched for product '+i);
    assert.notEqual(x.stockEpochId,y.stockEpochId,'unreconciled physical epochs remain distinct');
  }
});
