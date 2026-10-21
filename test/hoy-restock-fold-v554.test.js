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
  assert.equal(low.reposicionPlegable,false,'positive low stock remains visible');
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
  assert.match(backend,/reposicionPlegable: e.estado === "rojo"/);
  assert.equal((locale.match(/"hoy.restockFold":/g)||[]).length,2,'English and Spanish labels');
  assert.equal((locale.match(/"hoy.onlyRestock":/g)||[]).length,2,'English and Spanish neutral fallback');
});
