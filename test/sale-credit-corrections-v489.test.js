const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const {browser}=require('./helpers/browser.cjs');
function app(ls,facts=[]){
 const w=browser(ls);w.OCAuth={rolActual:()=> 'dueno'};
 w.AMG={Hechos:{todos:async()=>facts.slice(),verificarCadenas:async()=>({ok:true}),registrar:async(tipo,datos)=>{const h={id:'synthetic-credit-'+facts.length,tipo,datos:JSON.parse(JSON.stringify(datos)),ts:Date.now()+facts.length};facts.push(h);return h;}}};
 vm.runInContext(fs.readFileSync(path.join(__dirname,'../docs/cartera.js'),'utf8'),w);
 return {w,facts};
}
async function setup(){
 const s=app();s.a=await s.w.request('/api/clientes','POST',{nombre:'Synthetic A'});
 s.b=await s.w.request('/api/clientes','POST',{nombre:'Synthetic B'});
 s.p=await s.w.request('/api/productos','POST',{nombre:'Synthetic article',barcode:'SYNTH-CREDIT-489',precio:10,costo:2,stockInicial:20});
 const sale=await s.w.request('/api/productos/'+s.p.id+'/venta','POST',{cantidad:2,clienteId:s.a.id,info:{formaPago:'cash'}});
 s.id=sale.ventaId;return s;
}
const edit=(s,b)=>s.w.request('/api/ventas/'+s.id,'PATCH',b);
const balance=(s,id=s.a.id)=>s.w.request('/api/clientes/'+id+'/cartera');
const sale=async s=>(await s.w.request('/api/ventas/todas')).find(v=>v.id===s.id);

test('settled cash walk-in sale may acquire its first debtor only during correction to fiado, without changing paid commission',async()=>{
 const s=await setup();
 const person=await s.w.request('/api/promotoras','POST',{nombre:'Synthetic first debtor payee',comisionBase:40});
 const rack=await s.w.request('/api/ubicaciones','POST',{nombre:'Synthetic first debtor rack',tipo:'socio'});
 await s.w.request('/api/ubicaciones/'+rack.id,'PUT',{promotoraId:person.id});
 const p=await s.w.request('/api/productos','POST',{nombre:'Synthetic first debtor item',barcode:'FIRST-DEBT',precio:10,costo:2,stockInicial:4,ubicacionId:rack.id});
 const r=await s.w.request('/api/productos/'+p.id+'/venta','POST',{cantidad:2,info:{formaPago:'cash'}});s.id=r.ventaId;
 await s.w.request('/api/liquidaciones/'+rack.id+'/marcar-pagado','POST',{payeeId:person.id,amountCents:400,medioPago:'efectivo',opId:'first-debt-paid'});
 const before=JSON.parse(JSON.stringify(s.w.catalog().ventas.find(v=>v.id===s.id).split));
 await edit(s,{clienteId:s.a.id,info:{formaPago:'fiado'}});await edit(s,{info:{formaPago:'fiado'}});
 assert.deepEqual(s.w.catalog().ventas.find(v=>v.id===s.id).split,before);assert.equal((await balance(s)).saldo,-20);
 assert.equal((await s.w.request('/api/productos/'+p.id)).stockActual,2);
 assert.equal(s.facts.filter(h=>h.tipo==='cartera_cargo').length,1);
 await assert.rejects(()=>edit(s,{clienteId:s.b.id}),/customer|settled/i);
});
test('manually linked legacy debt is reused, never doubled or reassigned',async()=>{
 const s=await setup();
 s.facts.push({id:'synthetic-legacy-cargo',tipo:'cartera_cargo',datos:{clienteId:s.a.id,monto:20,motivo:'Legacy charge'},ts:1});
 s.facts.push({id:'synthetic-manual-link',tipo:'cartera_vinculo',datos:{clienteId:s.a.id,cargoId:'synthetic-legacy-cargo',ventaId:s.id,accion:'vincular'},ts:2});
 const before=JSON.parse(JSON.stringify(s.facts));
 await assert.rejects(()=>edit(s,{clienteId:s.b.id}),/409.*customer/i);
 await edit(s,{precioUnit:12,info:{formaPago:'fiado'}});
 assert.equal((await balance(s)).saldo,-24);assert.deepEqual(s.facts,before);
});
test('sale-linked receipt prevents reassigning customer, including after switching to cash',async()=>{
 const s=await setup();await edit(s,{info:{formaPago:'fiado'}});
 const before=JSON.parse(JSON.stringify(s.facts));
 await assert.rejects(()=>edit(s,{clienteId:s.b.id}),/409.*customer/i);
 assert.equal((await sale(s)).clienteId,s.a.id);assert.equal((await balance(s)).saldo,-20);assert.equal((await balance(s,s.b.id)).saldo,0);
 await edit(s,{info:{formaPago:'cash'}});await assert.rejects(()=>edit(s,{clienteId:s.b.id}),/409.*customer/i);
 assert.equal((await balance(s)).saldo,0);assert.deepEqual(s.facts,before);
});
test('cash fiado cash price correction fiado reuses original immutable receipt',async()=>{
 const s=await setup();await edit(s,{info:{formaPago:'fiado'}});const receipt=JSON.parse(JSON.stringify(s.facts));
 await edit(s,{info:{formaPago:'cash'},precioUnit:12});
 await edit(s,{info:{formaPago:'fiado'}});await edit(s,{info:{formaPago:'fiado'}});
 assert.equal((await balance(s)).saldo,-24);assert.deepEqual(s.facts,receipt);assert.equal((await sale(s)).cantidad,2);
 // General receipt identity rules must stay strict outside sale corrections.
 await assert.rejects(()=>s.w.AMG.Cartera.registrarMovimiento(s.a.id,'cargo',25,'different',{ventaId:s.id}),/correccion/);
});
test('settled commission locks customer, quantity and price; method correction preserves split',async()=>{
 const s=await setup();
 const person=await s.w.request('/api/promotoras','POST',{nombre:'Synthetic payee',comisionBase:40});
 const rack=await s.w.request('/api/ubicaciones','POST',{nombre:'Synthetic rack',tipo:'socio'});
 await s.w.request('/api/ubicaciones/'+rack.id,'PUT',{promotoraId:person.id});
 const p=await s.w.request('/api/productos','POST',{nombre:'Synthetic commission item',barcode:'SYNTH-PAYOUT-489',precio:10,costo:2,stockInicial:4,ubicacionId:rack.id});
 const result=await s.w.request('/api/productos/'+p.id+'/venta','POST',{cantidad:2,clienteId:s.a.id,info:{formaPago:'cash'}});
 s.id=result.ventaId;
 await s.w.request('/api/liquidaciones/'+rack.id+'/marcar-pagado','POST',{payeeId:person.id,amountCents:400,medioPago:'efectivo',opId:'synthetic-partial-489'});
 const before=JSON.parse(JSON.stringify(s.w.catalog().ventas.find(v=>v.id===s.id).split));
 await assert.rejects(()=>edit(s,{clienteId:s.b.id}),/400.*settled/i);
 await assert.rejects(()=>edit(s,{cantidad:3}),/400.*settled/i);
 await assert.rejects(()=>edit(s,{precioUnit:11}),/400.*settled/i);
 await edit(s,{info:{formaPago:'fiado'}});assert.deepEqual(s.w.catalog().ventas.find(v=>v.id===s.id).split,before);assert.equal((await balance(s)).saldo,-20);
});
test('failed final sale persistence rolls back quantity, method, log, and sends no stock/catalog',async()=>{
 const s=await setup();const before=await s.w.request('/api/respaldo/exportar');
 const original=s.w.localStorage.setItem.bind(s.w.localStorage);let sent=0,notices=0;
 s.w.OCSyncEmit=()=>sent++;s.w.addEventListener('oc-catalogo-cambiado',()=>notices++);
 s.w.localStorage.setItem=()=>{throw Error('synthetic disk full')};s.w.OCEstadoIDB={guardar:async()=>false};
 await assert.rejects(()=>edit(s,{cantidad:3,info:{formaPago:'fiado'}}),/503.*saved/i);
 s.w.localStorage.setItem=original;delete s.w.OCEstadoIDB;
 const after=await s.w.request('/api/respaldo/exportar');
 assert.deepEqual(after.ventas,before.ventas);assert.deepEqual(after.productos,before.productos);
 assert.deepEqual(after.movimientos,before.movimientos);assert.equal(sent,0);assert.equal(notices,0);
 assert.equal((await balance(s)).saldo,0,'retained receipt does not fabricate debt on an unchanged cash sale');
 await edit(s,{cantidad:3,info:{formaPago:'fiado'}});assert.equal((await balance(s)).saldo,-30);assert.equal(s.facts.length,1);
});
test('IndexedDB fallback is awaited before response and stock notification',async()=>{
 const s=await setup();const original=s.w.localStorage.setItem.bind(s.w.localStorage);let resolveSave,sent=0;
 s.w.OCSyncEmit=()=>sent++;s.w.localStorage.setItem=()=>{throw Error('synthetic quota')};
 s.w.OCEstadoIDB={guardar:()=>new Promise(r=>{resolveSave=r;})};
 let finished=false;const pending=edit(s,{cantidad:3,info:{formaPago:'fiado'}}).then(r=>{finished=true;return r});
 for(let i=0;i<20&&!resolveSave;i++)await new Promise(r=>setTimeout(r,2));
 assert.equal(finished,false);assert.equal(sent,0);resolveSave(true);await pending;
 s.w.localStorage.setItem=original;delete s.w.OCEstadoIDB;assert.equal(finished,true);assert.equal(sent,1);assert.equal((await balance(s)).saldo,-30);
});
test('reload, synthetic peer and export restore keep corrected debt, stock and immutable receipt',async()=>{
 const s=await setup();await edit(s,{info:{formaPago:'fiado'}});await edit(s,{info:{formaPago:'cash'},precioUnit:12});await edit(s,{info:{formaPago:'fiado'}});
 const receipts=JSON.parse(JSON.stringify(s.facts)),reloaded=app(s.w.localStorage,s.facts);
 assert.equal((await reloaded.w.request('/api/clientes/'+s.a.id+'/cartera')).saldo,-24);
 const peer=app(undefined,receipts);peer.w.receive(s.w);
 assert.equal((await peer.w.request('/api/clientes/'+s.a.id+'/cartera')).saldo,-24);
 const exported=await s.w.request('/api/respaldo/exportar'),restored=app(undefined,receipts);
 await restored.w.request('/api/respaldo/importar','POST',exported);
 assert.equal((await restored.w.request('/api/clientes/'+s.a.id+'/cartera')).saldo,-24);
 assert.equal((await restored.w.request('/api/productos')).find(p=>p.id===s.p.id).stockActual,18);
 assert.deepEqual(receipts,s.facts);assert.equal(s.facts.length,1);
});
