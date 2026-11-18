'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const http=require('node:http');
const {chromium,webkit}=require('playwright');
const blobLib=fs.readFileSync(path.join(__dirname,'../docs/idb-fotos.js'),'utf8');
const source=fs.readFileSync(path.join(__dirname,'../docs/mock-backend.js'),'utf8');
const helperStart=source.indexOf('  function _estadoParaGuardarSinFotos(');
const helperEnd=source.indexOf('  function _guardarEstadoLocalAhora(',helperStart);
assert.ok(helperStart>0&&helperEnd>helperStart);
const helper=source.slice(helperStart,helperEnd);
const server=http.createServer((req,res)=>{
 res.writeHead(200,{'Content-Type':'text/html','Cache-Control':'no-store'});
 res.end('<!doctype html><meta charset="utf-8"><title>synthetic photo snapshot quota</title>');
});
async function listen(){await new Promise(r=>server.listen(0,'127.0.0.1',r));return 'http://127.0.0.1:'+server.address().port+'/'}
for(const [label,engine] of [['Chromium',chromium],['WebKit',webkit]]){
 test('STK-H1 '+label+': exact committed IDB blobs protect 5MB A/B, reopen and rehydrate without photo loss',async()=>{
  const url=await listen(),browser=await engine.launch({headless:true});
  try{
   const context=await browser.newContext(),page=await context.newPage();
   await page.goto(url);
   await page.addScriptTag({content:blobLib});
   await page.addScriptTag({content:helper});
   const result=await page.evaluate(async()=>{
     const data='data:image/jpeg;base64,'+'A'.repeat(420*1024);
     const rows=Array.from({length:15},(_,i)=>({id:'synthetic-'+i, fotoHash:'sha-synthetic-'+i,
       fotoRev:'synthetic',foto:data,stockActual:4}));
     for(const p of rows){
       if(!await window.OCFotos.guardarPorHash(p.fotoHash,p.foto))throw Error('IDB failed');
       if(!window.OCFotos.tieneFotoHashConfirmadoEnIdb(p.fotoHash,p.foto))throw Error('No post-ACK proof');
     }
     const vivo={productos:rows,ubicaciones:[],ventas:[],movimientos:[]};
     const raw=JSON.stringify(vivo);
     const snapshot=JSON.stringify(_estadoParaGuardarSinFotos(vivo));
     const max=5*1024*1024;
     if(raw.length<=max||snapshot.length>=max)throw Error('Quota fixture invalid');
     localStorage.setItem('synthetic-A-B-business-snapshot',snapshot);
     return {rawBytes:raw.length,snapshotBytes:snapshot.length,
       firstLiveImage:rows[0].foto===data,hasAllPointers:rows.every(x=>x.fotoHash)};
   });
   assert.ok(result.rawBytes>5*1024*1024);
   assert.ok(result.snapshotBytes<5*1024*1024);
   assert.equal(result.firstLiveImage,true);
   assert.equal(result.hasAllPointers,true);
   await page.reload();
   await page.addScriptTag({content:blobLib});
   const recovered=await page.evaluate(async()=>{
     const state=JSON.parse(localStorage.getItem('synthetic-A-B-business-snapshot'));
     const first=state.productos[0];
     return {inline:first.foto||null,hash:first.fotoHash,
       bytes:await window.OCFotos.leerPorHash(first.fotoHash),
       proof:window.OCFotos.tieneFotoHashConfirmadoEnIdb(first.fotoHash,
          'data:image/jpeg;base64,'+'A'.repeat(420*1024))};
   });
   assert.equal(recovered.inline,null,'local snapshot keeps pointer only after proof');
   assert.equal(recovered.hash,'sha-synthetic-0');
   assert.equal(recovered.bytes,'data:image/jpeg;base64,'+'A'.repeat(420*1024));
   assert.equal(recovered.proof,true,'readback re-certifies post-reload IDB content');
  }finally{await browser.close();await new Promise(r=>server.close(r));}
 });
}
