'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const vm=require('node:vm');const path=require('node:path');
const src=fs.readFileSync(path.join(__dirname,'../docs/auth-ui.js'),'utf8');
const start=src.indexOf('    function revalidarSesionEquipo() {');
const end=src.indexOf('    window.addEventListener("oc-equipo-sync"',start);
if(start<0||end<0)throw Error('Session sync guard not found');
const fragment=src.slice(start,end);
async function check(member, roster, sessionRole='empleado'){
 const events=[],window={OCCurrentUser:member,t:(x)=>x};
 const ctx={window,rol:sessionRole,fetch:async()=>({json:async()=>roster}),cerrarSesion:m=>events.push(m),JSON,Array};
 vm.createContext(ctx);vm.runInContext(fragment+'\nrevalidarSesionEquipo();',ctx);
 await new Promise(r=>setImmediate(r));return events;
}
test('deactivated named member is logged out when sync event invokes roster revalidation',async()=>{
 const u={id:'synthetic-member',rev:'v1'};
 const events=await check(u,[{id:'synthetic-member',activo:false,rol:'empleado',rev:'v2'}]);
 assert.deepEqual(events,['team.sessionDeactivated']);
});
test('same member remains logged in when current roster agrees',async()=>{
 const u={id:'synthetic-member',rev:'v1'};
 const events=await check(u,[{id:'synthetic-member',activo:true,rol:'empleado',rev:'v1'}]);
 assert.deepEqual(events,[]);
});
test('missing member is removed on revalidation',async()=>{
 const u={id:'synthetic-member',rev:'v1'};
 const events=await check(u,[]);assert.deepEqual(events,['team.sessionRemoved']);
});