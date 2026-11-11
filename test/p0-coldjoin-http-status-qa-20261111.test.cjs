'use strict';
// QA-only status classification, no production data, no external requests.
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const script=fs.readFileSync(path.join(__dirname,'../scripts/canario-union-fria.cjs'),'utf8');
const a=script.indexOf('const crearObservadorRed = ');
const b=script.indexOf('// Passive relay budget snapshot',a);
assert.ok(a>=0&&b>a,'real canary HTTP observer present');
function observer() {
 const ctx={JSON,URL,Number};
 vm.runInNewContext(script.slice(a,b)+'\nthis.make=crearObservadorRed;',ctx);
 return ctx.make();
}
const sf='https://uhvzdrlhmznxxelniizi.supabase.co/rest/v1/rpc/f123_relay_pull?room=SECRET-ROOM';
const fb='https://friendly-123-ab7b3-default-rtdb.firebaseio.com/f123/SECRET-ROOM/k.json';
test('RED: distinguish narrow Supabase 4xx classes, preserve 403 and unknown as separate',()=>{
 const o=observer();
 for(const status of [401,402,403,404,409,429,418,200])o.respuesta({url:()=>sf,status:()=>status});
 o.respuesta({url:()=>fb,status:()=>200});
 const r=o.resumen();
 assert.equal(r.supabase.rechazo401,1);
 assert.equal(r.supabase.rechazo402,1);
 assert.equal(r.supabase.rechazo403,1);
 assert.equal(r.supabase.rechazo404,1);
 assert.equal(r.supabase.rechazo409,1);
 assert.equal(r.supabase.rechazo429,1);
 assert.equal(r.supabase.error4xx,1);
 assert.equal(r.supabase.ok2xx,1);
 assert.equal(r.firebase.ok2xx,1);
 for(const secret of ['SECRET-ROOM','f123_relay_pull','supabase.co','firebaseio.com']) assert.ok(!JSON.stringify(r).includes(secret));
});
test('RED: distinguish Firebase request aborts from network failures without leaking errors',()=>{
 const o=observer();
 for(const errorText of ['net::ERR_ABORTED','net::ERR_CONNECTION_RESET','net::ERR_TIMED_OUT','net::ERR_FAILED','SENSITIVE-PRIVATE-URL']){
   o.fallida({url:()=>fb,failure:()=>({errorText})});
 }
 const r=o.resumen();
 assert.equal(r.firebase.errorRed,5);
 assert.equal(r.firebase.errorAbortado,1);
 assert.equal(r.firebase.errorTimeout,1);
 assert.equal(r.firebase.errorConexion,1);
 assert.equal(r.firebase.errorOtro,2);
 assert.ok(!JSON.stringify(r).includes('SENSITIVE-PRIVATE-URL'));
});
