'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const s=fs.readFileSync(path.join(__dirname,'../docs/crypto-store.js'),'utf8');
const pos=s.indexOf('  async function instalarCredencialesDesdeSala(pins) {');
const end=s.indexOf('  // Lee los PINs visibles',pos);
assert.ok(pos>=0 && end>pos,'extract the actual fresh-device implementation');
const method=s.slice(pos,end);
const TESTLIC='F123-SYNTHETIC-FAKE';
async function sim({secret='vacio',recovering=false,room=true,owner='432',own=TESTLIC,peerOwner='432'}={}){
 let called=0,pinsSaved=null,current=secret;
 const code=[
  'let current=secret,called=0,pinsSaved=null;',
  'const estadoSecreto=()=>current;',
  'const guardarSecreto=async(o,emps,acct,email)=>{called++;pinsSaved={o,emps,acct,email};current="ok";return true};',
  'const localStorage={getItem:()=>JSON.stringify({licenseCode:own})};',
  'const window={OCTienda:{licenciaActual:()=>own},OCYjs:room?{roomId:"synthetic-room",canal:{recuperando:recovering},meta:{get:()=>({owner:peerOwner})}}:null};',
  method,
  'return instalarCredencialesDesdeSala({owner,emp:"671",acct:"128"}).then(ok=>({ok,called,pinsSaved,current}));'
 ].join('\n');
 return await new Function('secret','recovering','room','owner','own','peerOwner',code)(secret,recovering,room,owner,own,peerOwner);
}
test('fresh licensed phone can adopt only the actual PINs of a verified encrypted-room catalog',async()=>{
 const x=await sim();
 assert.equal(x.ok,true);assert.equal(x.called,1);
 assert.deepEqual(x.pinsSaved,{o:'432',emps:['671'],acct:'128',email:''});
});
test('never overwrite an existing owner credential',async()=>{
 const x=await sim({secret:'ok'});assert.equal(x.ok,false);assert.equal(x.called,0);
});
test('never create credentials from an unverified/pending room',async()=>{
 for(const opts of [{recovering:true},{room:false},{peerOwner:'918'}]){
  const x=await sim(opts);assert.equal(x.ok,false);assert.equal(x.called,0);
 }
});
test('factory demo PIN and an unlicensed room never establish owner credentials',async()=>{
 for(const opts of [{owner:'456',peerOwner:'456'},{own:'demo'}]){
  const x=await sim(opts);assert.equal(x.ok,false);assert.equal(x.called,0);
 }
});
