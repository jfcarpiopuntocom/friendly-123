'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require('node:path').join(__dirname,'../scripts/canario-union-fria.cjs'),'utf8');
function body(start,end){const a=source.indexOf(start),b=source.indexOf(end,a);assert.ok(a>=0&&b>a);return source.slice(a,b);}
test('P0 RED: distinguish Firebase 404 missing metadata from Firebase 429 throttling, no URLs',()=>{
 const s=body('const crearObservadorRed =','\n// Passive relay budget snapshot');
 const c={JSON,URL,Number};vm.runInNewContext(s+';this.make=crearObservadorRed;',c);
 const obs=c.make(),privateUrl='https://friendly-123-ab7b3-default-rtdb.firebaseio.com/f123/'+'a'.repeat(40)+'-y/k/1.json';
 [404,429,404,401,403,400,409,500,200].forEach(status=>obs.respuesta({url:()=>privateUrl,status:()=>status}));
 const f=obs.resumen().firebase;
 assert.equal(f.noEncontrado404,2);
 assert.equal(f.cupo429,1);
 assert.equal(f.sinPermiso401,1);
 assert.equal(f.rechazo403,1);
 assert.equal(f.otros4xx,2);
 assert.equal(f.error4xx,6,'aggregate 4xx excludes separately-counted 403, preserving legacy semantics');
 assert.equal(f.error5xx,1);
 assert.equal(f.ok2xx,1);
 assert.equal(JSON.stringify(f).includes(privateUrl),false,'never export URLs or room capability');
});
test('P0 RED: checkpoint probe unknown must distinguish layer mismatch vs invalid head',async()=>{
 const s=body('const consultarCheckpoint =','\n// Synthetic-only passive network observer');
 const room='a'.repeat(40),ws={relayLayer:'other-layer'},ctx={
  window:{OCYjs:{roomId:room,canal:{ws}},F123FirebaseRelay:{leerHead:async()=>({rev:-1,seq:0})}},
  Promise,Number,setTimeout,clearTimeout
 };
 vm.runInNewContext(s+';this.probe=consultarCheckpoint;',ctx);
 const p={evaluate:fn=>fn()};
 const wrong=await ctx.probe(p);
 assert.equal(wrong.consultado,false);
 assert.equal(wrong.razon,'capa-no-firebase');
 ws.relayLayer='f123_relay_cupo_fb_v1';
 const invalid=await ctx.probe(p);
 assert.equal(invalid.consultado,false);
 assert.equal(invalid.razon,'head-invalido');
 assert.ok(!JSON.stringify(wrong).includes(room));
});
test('P0 RED: browser crash and disconnection get classified without logging exception details',()=>{
 assert.match(source,/\.on\(['"]crash['"]/,'capture Chromium page crash');
 assert.match(source,/CANARIO_ESTADO_NAVEGADOR:/,'bounded final status');
 assert.doesNotMatch(source,/console\.log\(.+?\.message\)/,'do not log raw error details');
});
