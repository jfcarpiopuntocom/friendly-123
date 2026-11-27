'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
for(const file of ['docs/hechos.js','docs/hechos.min.js'])test(file+' abort rejects, next write commits, original fact can retry',async()=>{
 const code=fs.readFileSync(file,'utf8'),a=code.indexOf('function guardar(hecho)'),b=code.indexOf('function importarRemoto',a);
 assert.ok(a>=0&&b>a);
 const txs=[],committed=[];
 const db={transaction(){let fact;const tx={error:null,objectStore:()=>({add:h=>{fact=h;return {}}}),commit(){committed.push(fact.id);tx.oncomplete()},abort(){tx.onabort?.()}};txs.push(tx);return tx}};
 const guardar=new Function('abrirDB','STORE',code.slice(a,b)+';return guardar')(()=>Promise.resolve(db),'hechos');
 const tick=()=>new Promise(r=>setImmediate(r));let result='pending';
 const first=guardar({id:'one'}).then(()=>result='resolved',e=>result=e.name);
 await tick();txs[0].abort();await tick();assert.equal(result,'AbortError');await first;assert.deepEqual(committed,[]);
 const next=guardar({id:'two'});await tick();txs[1].commit();assert.equal((await next).id,'two');
 const retry=guardar({id:'one'});await tick();txs[2].commit();assert.equal((await retry).id,'one');assert.deepEqual(committed,['two','one']);
});
