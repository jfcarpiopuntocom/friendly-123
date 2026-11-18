'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const {chromium,webkit}=require('playwright');
const s=fs.readFileSync(path.join(__dirname,'../src/dashboard/dashboard-main.js'),'utf8');
const a=s.indexOf('      /* No previous shop / revision finance facts may survive until IDB replies. */');
const b=s.indexOf('      try {\n        var o = JSON.parse(localStorage.getItem("f123_owned")',a);
assert.ok(a>0&&b>a);
const reader=s.slice(a,b);
const prelude=[
 'var datos={}, e={ajustesComision:[],productos:[],ventas:[],clientes:[],gastos:[]}, d={resumen:{}};',
 "var autorizado=true,codigoSesionActual='SYNTHETIC-NOTEBOOK',codeHere='SYNTHETIC-NOTEBOOK',_generacionPinturaLocal=0;",
 "function codigoLocalActivo(){return 'SYNTHETIC-NOTEBOOK'}",
 'window.__diag=[]; function mostrar(){window.__diag.push({status:datos.cobertura.hechosFinancieros,reason:datos.cobertura.motivoHechos,count:datos.hechosFinancieros.length})};'
].join('\n');
const server=http.createServer((req,res)=>{
 res.writeHead(200,{'Content-Type':'text/html','Cache-Control':'no-store'});res.end('<!doctype html><meta charset="utf-8"><title>synthetic finance notebook</title>');
});
async function serve(){
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 return 'http://127.0.0.1:'+server.address().port+'/';
}
async function seed(page,name,records){
 return page.evaluate(({name,records})=>new Promise((resolve,reject)=>{
  const req=indexedDB.open(name,1);
  req.onupgradeneeded=()=>{const o=req.result.createObjectStore('hechos',{keyPath:'id'});records.forEach(x=>o.put(x))};
  req.onerror=()=>reject(req.error?.message||'open error');req.onsuccess=()=>{req.result.close();resolve()};
 }),{name,records});
}
async function run(page){
 await page.addScriptTag({content:prelude+'\n'+reader});
 await page.waitForFunction(()=>window.__diag.length>=1);
 return page.evaluate(()=>window.__diag.at(-1));
}
for(const [name,engine] of [['Chromium',chromium],['WebKit',webkit]]){
 test('Hermes H1 '+name+': legacy-only DB does not create phantom modern journal or expose unscoped cash',async()=>{
  const url=await serve(),browser=await engine.launch({headless:true});
  try{
   const page=await browser.newPage();await page.goto(url);
   await seed(page,'amg_hechos_db',[{id:'legacy-1',tipo:'cartera_abono',monto:9999}]);
   const diag=await run(page);
   assert.equal(diag.status,false);
   assert.equal(diag.count,0);
   assert.equal(diag.reason,'sin-migrar');
   const names=await page.evaluate(()=>indexedDB.databases().then(a=>a.map(x=>x.name)));
   assert.equal(names.includes('f123_hechos_db'),false);
  }finally{await browser.close();await new Promise(r=>server.close(r));}
 });
 test('Hermes H1 '+name+': legitimate modern ledger becomes available only after READONLY tx complete',async()=>{
  const url=await serve(),browser=await engine.launch({headless:true});
  try{
   const page=await browser.newPage();await page.goto(url);
   await seed(page,'f123_hechos_db',[
    {id:'new-1',tipo:'cartera_abono',monto:5},{id:'new-2',tipo:'caja_chica_ingreso',monto:2},
    {id:'new-3',tipo:'plan_pago_creado',monto:100}]);
   const diag=await run(page);
   assert.equal(diag.status,true);
   assert.equal(diag.reason,null);
   assert.equal(diag.count,2);
  }finally{await browser.close();await new Promise(r=>server.close(r));}
 });
 test('Hermes H1 '+name+': missing modern journal stays unknown; no accidental DB create',async()=>{
  const url=await serve(),browser=await engine.launch({headless:true});
  try{
   const page=await browser.newPage();await page.goto(url);
   const diag=await run(page);
   assert.equal(diag.status,false);assert.equal(diag.reason,'sin-almacen');
   const names=await page.evaluate(()=>indexedDB.databases().then(a=>a.map(x=>x.name)));
   assert.equal(names.includes('f123_hechos_db'),false);
  }finally{await browser.close();await new Promise(r=>server.close(r));}
 });
}
