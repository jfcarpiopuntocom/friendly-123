'use strict';
// C94 true production-facade extraction: iPhone Safari background must not
// leave a stale "2.0 active" bit while C21a has already closed the catalog.
// Synthetic event harness only; zero customer storage, network, pins or licenses.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const src=fs.readFileSync(path.join(__dirname,'../docs/sync-yjs.js'),'utf8');
const a=src.indexOf('      API.crearCoordinadorCorte20 = async function (docPrivado, headCongelado, opc) {');
const end='\n      };';
const b=src.indexOf(end,a)+end.length;
assert(a>0&&b>a,'real C27 product facade source required');
const actualFacade=src.slice(a,b);

function fixture(){
 const coordinators=[],opts=[];
 const pilot={
  async crearCoordinadorCorte20(privateDoc,head,options){
   const c={
    destroyed:false,
    destroy(){this.destroyed=true;},
    signal(mode,reason='document-hidden'){options?.onModeChange?.({mode,reason});}
   };
   coordinators.push(c);
   opts.push(options);
   return c;
  }
 };
 const API={modoCorte20Activo:false,coordinadorCorte20:null};
 new Function('API','piloto',actualFacade+'\nreturn API.crearCoordinadorCorte20;')(API,pilot);
 return {API,coordinators,opts};
}
test('C94 RED iPhone hidden: real facade must immediately disarm stale 2.0 commercial flag when coordinator fails back',async()=>{
 const f=fixture();
 const c=await f.API.crearCoordinadorCorte20({},'synthetic-head');
 f.API.modoCorte20Activo=true;
 c.signal('failback-legacy-1.0','document-hidden');
 assert.equal(f.API.modoCorte20Activo,false,'P0: no stale flag after Safari background');
});
test('C94 RED writer conflict and missing catalog certificate revoke 2.0 in facade',async()=>{
 const f=fixture();
 const c=await f.API.crearCoordinadorCorte20({},'synthetic-head');
 for(const reason of ['writer-conflict','catalog-certification-failed','pagehide']){
  f.API.modoCorte20Activo=true;
  c.signal('failback-legacy-1.0',reason);
  assert.equal(f.API.modoCorte20Activo,false,reason);
 }
});
test('C94 RED callback cannot remotely arm 2.0, only existing strict C38 activation may',async()=>{
 const f=fixture();
 const c=await f.API.crearCoordinadorCorte20({},'synthetic-head');
 c.signal('active-2.0','fake-ack');
 assert.equal(f.API.modoCorte20Activo,false,'do not bypass exact pre/post dual-writer guard');
});
test('C94 RED stale callback from destroyed older coordinator cannot disable new certified cutover',async()=>{
 const f=fixture();
 const old=await f.API.crearCoordinadorCorte20({},'synthetic-head');
 const newer=await f.API.crearCoordinadorCorte20({},'synthetic-head-2');
 assert.equal(old.destroyed,true);
 f.API.modoCorte20Activo=true;
 old.signal('failback-legacy-1.0','late pagehide');
 assert.equal(f.API.modoCorte20Activo,true,'old stale observer may not revoke new source');
 newer.signal('failback-legacy-1.0','writer-conflict');
 assert.equal(f.API.modoCorte20Activo,false,'current writer must be revoked');
});
test('C94 RED coordinator replacement clears old active facade before async new proof',async()=>{
 const f=fixture();
 await f.API.crearCoordinadorCorte20({},'synthetic-head');
 f.API.modoCorte20Activo=true;
 await f.API.crearCoordinadorCorte20({},'synthetic-head-2');
 assert.equal(f.API.modoCorte20Activo,false,'replacement cannot retain old 2.0 active signal');
});
test('C94 RED external observer still receives all mode transitions and caller options immutable',async()=>{
 const f=fixture(),seen=[];
 const options=Object.freeze({onModeChange:e=>seen.push(e.reason),rol:'dueno'});
 const c=await f.API.crearCoordinadorCorte20({},'synthetic-head',options);
 c.signal('failback-legacy-1.0','pagehide');
 assert.deepEqual(seen,['pagehide']);
 assert.equal(options.rol,'dueno');
 assert.notStrictEqual(f.opts[0],options,'must not mutate frozen source option object');
});
