'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {browser}=require('./helpers/browser.cjs');

test('Today keeps nonperishable zero-stock artwork accessible inside a folded restock section',async()=>{
  const w=browser();
  const sculpture=await w.request('/api/productos','POST',{
    nombre:'Synthetic one-off artwork zero',barcode:'SYNTH-HOY-FOLD-ONE',
    stockInicial:0,precio:180,costo:90,umbralRojo:1,umbralAmarillo:3
  });
  const perish=await w.request('/api/productos','POST',{
    nombre:'Synthetic expired food zero',barcode:'SYNTH-HOY-PERISH-ZERO',
    stockInicial:0,precio:14,costo:8,perecible:true,
    fechaCaducidad:'2026-10-01',umbralRojo:1,umbralAmarillo:3
  });
  const urgent=await w.request('/api/productos','POST',{
    nombre:'Synthetic low-stock active',barcode:'SYNTH-HOY-STOCK-ONE',
    stockInicial:1,precio:14,costo:8,umbralRojo:2,umbralAmarillo:4
  });
  assert.ok(sculpture.id&&perish.id&&urgent.id);
  const result=await w.request('/api/dashboard');
  const find=name=>(result.alertas||[]).find(a=>a.mensaje.includes(name));
  const a=find('Synthetic one-off artwork zero');
  const p=find('Synthetic expired food zero');
  const low=find('Synthetic low-stock active');
  assert.ok(a&&p&&low,'all three original alerts remain in the dashboard payload');
  assert.equal(a.estado,'rojo');
  assert.equal(a.reposicionPlegable,true,'nonperishable zero-stock alerts are opt-in review');
  assert.equal(p.reposicionPlegable,false,'perishable emergency remains visible');
  assert.equal(low.reposicionPlegable,true,'v557: low stock of a nonperishable also folds into the closed notices panel');
  assert.equal(result.semaforoGeneral,'rojo','folding does not falsify business warning status');
});

test('Today restock folding uses a native accessible details panel without modifying the inventory UI',()=>{
  const src=fs.readFileSync(path.join(__dirname,'../docs/index.html'),'utf8');
  const backend=fs.readFileSync(path.join(__dirname,'../docs/mock-backend.js'),'utf8');
  const locale=fs.readFileSync(path.join(__dirname,'../docs/i18n.js'),'utf8');
  assert.match(src,/<details id="ocRestockHoy"/);
  assert.match(src,/id="ocRestockHoyTitulo"/);
  assert.match(src,/id="listaReposicionHoy"/);
  assert.match(src,/id="listaAlertas"/,'remaining urgent alert list is still present');
  assert.match(src,/restockPlegado.*reposicionPlegable/);
  assert.match(src,/alertasVisibles.*reposicionPlegable/);
  assert.match(backend,/reposicionPlegable: e.p.perecible !== true/);
  assert.equal((locale.match(/"hoy.restockFold":/g)||[]).length,2,'English and Spanish labels');
  assert.equal((locale.match(/"hoy.onlyRestock":/g)||[]).length,2,'English and Spanish neutral fallback');
});

test('v557 item 1: unique pieces with stock 1 never show as visible red alerts; perishable expiry stays visible',async()=>{
  const w=browser();
  for(let i=1;i<=5;i++) await w.request('/api/productos','POST',{nombre:'Synthetic unique piece '+i,barcode:'SYNTH-UNIQ-'+i,stockInicial:1,precio:100,costo:40,umbralRojo:1,umbralAmarillo:2});
  await w.request('/api/productos','POST',{nombre:'Synthetic expired cheese',barcode:'SYNTH-CHEESE',stockInicial:9,precio:9,costo:4,perecible:true,fechaCaducidad:'2026-10-01',umbralRojo:1,umbralAmarillo:2});
  const r=await w.request('/api/dashboard');
  const visibles=r.alertas.filter(a=>a.reposicionPlegable!==true);
  assert.equal(visibles.filter(a=>/unique piece/.test(a.mensaje)).length,0,'no visible alert for stock-1 pieces');
  assert.equal(r.alertas.filter(a=>a.reposicionPlegable===true&&/unique piece/.test(a.mensaje)).length,5,'all five remain inside the folded panel');
  assert.ok(visibles.some(a=>/expired cheese/.test(a.mensaje)),'expiry notice of a perishable stays visible');
});
