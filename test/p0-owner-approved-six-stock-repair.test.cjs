'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {plan,run,fingerprint}=require('../docs/owner-approved-inventory-repair.js');
const labels=['Aventuras de James Bond','Hielo del Chimborazo','Prueba B',
  'Spray de la verdad','Spray de la verdad — Bourgeois','Crema'];
const orig=[3,4,7,7,6,16];
function fixture(numbers=orig){
  return {productos:labels.map((nombre,i)=>({
    nombre,id:'synthetic-'+i,stockActual:numbers[i],borrado:false
  }))};
}
function fake(options={}){
  const state=fixture(options.numbers),op=[],audit=[],marker=[];
  const deps={
    authorized:()=>options.authorized!==false,
    done:()=>marker.includes('done'),
    catalog:()=>state,
    audit:async p=>{if(options.auditFails)throw Error('audit unavailable');audit.push(JSON.parse(JSON.stringify(p)));},
    adjust:async(id,delta)=>{
      if(options.adjustFails&&id==='synthetic-4')throw Error('storage unavailable');
      const row=state.productos.find(x=>x.id===id);
      assert.ok(row,'known product ID');
      row.stockActual+=delta;
      op.push({id,delta});
      return {stockActual:row.stockActual};
    },
    finish:async()=>{if(options.finishFails)throw Error('marker unavailable');marker.push('done')}
  };
  return {state,op,audit,marker,deps};
}
test('P0 exact six supplied stock counts become six 7s via four normal adjustments, then stay idempotent',async()=>{
 const f=fake();
 assert.deepEqual(plan(f.state).map(p=>p.delta),[4,3,0,0,1,-9]);
 const r=await run(f.deps);
 assert.deepEqual(r,{changed:4,complete:true});
 assert.deepEqual(f.state.productos.map(p=>p.stockActual),[7,7,7,7,7,7]);
 assert.deepEqual(f.op.map(x=>x.delta),[4,3,1,-9]);
 assert.equal(f.audit.length,1);
 assert.deepEqual(f.audit[0].rows.map(p=>p.before),orig);
 assert.deepEqual(await run(f.deps),{changed:0,skipped:'unauthorized-or-complete'});
 assert.equal(f.op.length,4,'no second stock exit');
});
test('P0 unrecognized goods, duplicate names and later sales never get altered',async()=>{
 for(const changed of [[3,4,7,7,6,15],[2,4,7,7,6,16],[3,4,7,7,6,16]]){
  const f=fake({numbers:changed});
  if(changed.join(',')!==orig.join(','))assert.equal(plan(f.state),null);
 }
 const f=fake(); f.state.productos.push({...f.state.productos[0],id:'synthetic-duplicate'});
 assert.equal(plan(f.state),null);
 const missing=fake();missing.state.productos.pop();assert.equal(plan(missing.state),null);
 const unauthorized=fake({authorized:false});
 assert.equal((await run(unauthorized.deps)).changed,0);assert.equal(unauthorized.op.length,0);
});
test('P0 failed audit cannot create even one movement',async()=>{
 const f=fake({auditFails:true});await assert.rejects(run(f.deps),/audit unavailable/);
 assert.equal(f.op.length,0);assert.deepEqual(f.state.productos.map(x=>x.stockActual),orig);
});
test('P0 recovery after partial durable adjustment only publishes still-missing movements',async()=>{
 const f=fake({adjustFails:true});
 await assert.rejects(run(f.deps),/storage unavailable/);
 assert.deepEqual(f.state.productos.map(x=>x.stockActual),[7,7,7,7,6,16]);
 assert.equal(f.marker.length,0);
 f.deps.adjust=async(id,delta)=>{const p=f.state.productos.find(x=>x.id===id);p.stockActual+=delta;f.op.push({id,delta});return {stockActual:p.stockActual}};
 const r=await run(f.deps);
 assert.equal(r.changed,2);
 assert.deepEqual(f.state.productos.map(x=>x.stockActual),[7,7,7,7,7,7]);
 assert.equal(f.op.length,4,'resume does not double earlier moves');
});
test('P0 exact deployment references are bundled without exposing license/PIN',()=>{
 const read=p=>fs.readFileSync(path.join(__dirname,'../docs',p),'utf8');
 const script=read('owner-approved-inventory-repair.js'),html=read('index.html'),sw=read('sw.js');
 assert.match(html,/defer src="\.\/owner-approved-inventory-repair\.js"/);
 assert.equal(html.split('owner-approved-inventory-repair.js').length,2);
 assert.match(sw,/"\.\/owner-approved-inventory-repair\.js"/);
 assert.match(script,/6583453063440131/);
 assert.match(script,/OCAuth\.rolActual\(\) === "dueno"/);
 assert.ok(fingerprint('F123-SYNTHETIC-LICENSE')!==6583453063440131);
 assert.ok(!script.includes('F123-A6YK-'));
 assert.ok(!script.includes('333'));
 assert.ok(!script.includes('555'));
});
