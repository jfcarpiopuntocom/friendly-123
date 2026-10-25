'use strict';
// Source-anchored RED contract: never report rejection after durable pointer commit.
// Synthetic state and injected UI failure only. No production/customer storage.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const source=fs.readFileSync(path.resolve(__dirname,'../docs/mock-backend.js'),'utf8');
const begin=source.indexOf('  function _guardarEstadoLocalAhora(');
const end=source.indexOf('  function avisoEspacioJusto(',begin);
assert.ok(begin>=0&&end>begin,'extract actual A/B writer');
const writer=source.slice(begin,end);

async function attempt({idb=false,throwUI=false}={}){
  const storage=new Map([
    ['state_ptr','A'],['state_A','SYNTHETIC_OLD'],['state_B','SYNTHETIC_OLDER']
  ]);
  const signal=[];
  const context={
    localStorage:{
      getItem:k=>storage.has(k)?storage.get(k):null,
      setItem(k,v){storage.set(k,String(v));signal.push('set '+k);},
      removeItem(k){storage.delete(k);signal.push('delete '+k);}
    },
    OC_STATE_PTR:'state_ptr',OC_STATE_SELLO:'state_sello',
    _localRev:9,_localRevReservado:9,
    estadoActualExportable:()=>({note:'SYNTHETIC_NEW'}),
    claveBuffer:letter=>'state_'+letter,
    _espejarEnIDB:()=>Promise.resolve(idb),
    ocultarAvisoRecorte(){if(throwUI)throw Error('SYNTHETIC UI ERROR');},
    despejarAvisoMemoriaLlena(){},_publicarAdminPins(){},
    avisoEspacioJusto(){},
    avisoMemoriaLlena(){signal.push('reported failure');}
  };
  vm.createContext(context);
  vm.runInContext(writer+';this.save=_guardarEstadoLocalAhora;',context);
  const ack=await context.save(true,true);
  return {ack,storage,signal};
}
function committed(out){
  return out.storage.get('state_ptr')==='B' &&
    String(out.storage.get('state_B')).includes('SYNTHETIC_NEW');
}

test('control: pointer commit can complete despite IDB rejection',async()=>{
  const out=await attempt({idb:false});
  assert.equal(committed(out),true);
  assert.equal(out.ack,true);
});

for(const idb of [false,true]){
  test('1AAA RED: non-durable UI exception after pointer commit cannot turn ACK false; IDB='+idb,async()=>{
    const out=await attempt({idb,throwUI:true});
    assert.equal(committed(out),true,'LS pointer + new value were durably updated');
    assert.equal(out.ack,true,'never report HTTP507 after an already committed snapshot');
    assert.equal(out.signal.includes('reported failure'),false,
      'must not warn business owner that a committed change was rejected');
  });
}
