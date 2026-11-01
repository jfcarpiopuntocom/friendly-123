'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const src=fs.readFileSync(path.join(__dirname,'../docs/sync-yjs.js'),'utf8');
const vendor=fs.readFileSync(path.join(__dirname,'../docs/vendor/yjs-bundle.min.js'),'utf8');

function listenerFor(docName, unavailable=false) {
  const anchor=docName+'.on("update", function (update, origin) {';
  const start=src.indexOf(anchor);
  assert.ok(start>=0,'actual production listener '+docName);
  const end=src.indexOf('\n    });',start);
  assert.ok(end>start,'listener terminator '+docName);
  let captured;
  const sends=[], broadcasts=[], hydrations=[];
  const doc={on(type,fn){assert.equal(type,'update');captured=fn;}};
  const idb=unavailable?null:{name:docName+'-real-IDB-origin'};
  const API={
    doc:docName==='API.doc'?doc:null,
    fotosDoc:docName==='API.fotosDoc'?doc:null,
    opsDoc:docName==='API.opsDoc'?doc:null,
    idb:docName==='API.doc'?idb:{},
    fotosIdb:docName==='API.fotosDoc'?idb:{},
    opsIdb:docName==='API.opsDoc'?idb:{},
    bc:{postMessage(u){broadcasts.push(u);}},
    fotosBc:{postMessage(u){broadcasts.push(u);}},
    opsBc:{postMessage(u){broadcasts.push(u);}},
    canal:{enviarUpdate(u){sends.push(u);}},
    fotosCanal:{enviarUpdate(u){sends.push(u);}},
    opsCanal:{enviarUpdate(u){sends.push(u);}}
  };
  vm.runInNewContext(src.slice(start,end+8),{
    API,pedirVolcarFotos(){hydrations.push('photos');},
    pedirProcesarEventos(){hydrations.push('ops');}
  });
  assert.equal(typeof captured,'function');
  return {idb,captured,sends,broadcasts,hydrations};
}

test('real vendor restores historical Yjs updates with IndexeddbPersistence as origin',()=>{
  assert.match(vendor,/x\(e\.doc,\(\)=>\{s\.forEach\(i=>Pr\(e\.doc,i\)\)\},e,!1\)/);
});

for (const docName of ['API.doc','API.fotosDoc','API.opsDoc']) {
  test('S1 '+docName+': IndexedDB hydration never becomes a new durable relay op',()=>{
    const f=listenerFor(docName),update=new Uint8Array([1,2,3]);
    f.captured(update,f.idb);
    assert.equal(f.sends.length,0,'hydrated history is already in the local Yjs journal');
    assert.equal(f.broadcasts.length,0,'hydrated history is not a new local edit');
    if(docName==='API.fotosDoc')assert.deepEqual(f.hydrations,['photos']);
    if(docName==='API.opsDoc')assert.deepEqual(f.hydrations,['ops']);
    f.captured(update,'red');f.captured(update,'bc');
    assert.equal(f.sends.length,0,'remote/BC updates are not echoed');
    f.captured(update,'seed');
    assert.equal(f.sends.length,1,'a fresh local Yjs event must remain durable');
    f.captured(update,null);
    assert.equal(f.sends.length,2,'locally initiated edits with no explicit origin still propagate');
  });
}

for (const docName of ['API.doc','API.fotosDoc','API.opsDoc']) {
  test('S1 '+docName+': without IndexedDB a null-origin local edit still publishes',()=>{
    const f=listenerFor(docName,true);
    f.captured(new Uint8Array([4,5]),null);
    assert.equal(f.sends.length,1,'no persistence instance must not suppress legitimate local updates');
  });
}
