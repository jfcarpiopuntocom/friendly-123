'use strict';
// P1 forensic proof: never let an outdated recovered room re-authorize a
// locally retired Owner PIN. Synthetic PINs and license only; no user secrets.
const {test}=require('node:test'), assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const src=fs.readFileSync(path.join(__dirname,'../docs/crypto-store.js'),'utf8');
const start=src.indexOf('  async function identificarPin(pin) {');
const end=src.indexOf('  function limpiarLockouts()',start);
assert.ok(start>=0 && end>start,'extract the exact production authentication function');
const fn=src.slice(start,end);
const license='F123-SYNTHETIC-TEST-ONLY';
function open({localPin='321',canonical='321',pending=false}={}) {
  const local={
    salt:'synthetic-salt',ownerHash:'owner:'+localPin,
    employeeHashes:[],acctHash:'none',
    retiredOwnerHashes:localPin!==canonical?['owner:'+canonical]:[],
    pendingOwnerRotation:pending
  };
  const meta={pinsRol:{owner:canonical},ownerPinConfirmado:canonical};
  const room={roomId:'synthetic-room',canal:{recuperando:false},meta:{get:k=>meta[k]}};
  const w={OCTienda:{licenciaActual:()=>license},OCYjs:room};
  const ls={getItem:k=>k==='f123_owned'?JSON.stringify({licenseCode:license}):null};
  const factory=new Function('window','localStorage','leerSecreto','hashPin',
    'leerPinQueAbre','directorioNormalizado','leerPinsEquipo',
    fn+';return identificarPin;');
  return factory(w,ls,()=>local,(p,salt,role)=>Promise.resolve(role+':'+p),
    ()=>({}),()=>({acct:null,empleados:[]}),()=>({}));
}
test('baseline: shared and local same Owner credential retains ordinary login',async()=>{
  const login=open();assert.equal(await login('321'),'dueno');assert.equal(await login('654'),null);
});
test('P1: room still holding retired Owner credential must not resurrect it on reconnect',async()=>{
  const login=open({localPin:'654',canonical:'321',pending:true});
  assert.equal(await login('321'),null,'retired Owner PIN must stay revoked on this device');
});
test('P1: locally durable new Owner verifier must remain usable until shared publication',async()=>{
  const login=open({localPin:'654',canonical:'321',pending:true});
  assert.equal(await login('654'),'dueno','locally confirmed Owner rotation must survive restart');
});
