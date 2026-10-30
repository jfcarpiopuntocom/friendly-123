'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {chromium,webkit}=require('playwright');
const root=path.join(__dirname,'..');
const runtime=fs.readFileSync(path.join(root,'docs/estado-idb.js'),'utf8');
const backend=fs.readFileSync(path.join(root,'docs/mock-backend.js'),'utf8');
const ab=fs.readFileSync(path.join(root,'docs/estado-ab.js'),'utf8');
function sale(rev,id,stock){return {_rev:rev,_abCommit:'synthetic-'+id,nombreNegocio:'SYNTHETIC',productos:[{id:'synthetic-product',stockActual:stock}],ventas:[{id}],movimientos:[{id:'m-'+id}],clientes:[],payouts:[]};}
test('P0: two live browser tabs cannot both acknowledge incompatible sales from one revision',async()=>{
 const server=http.createServer((req,res)=>{res.writeHead(200,{'Content-Type':'text/html'});res.end('<!doctype html><title>Synthetic local notebook</title>')});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const browser=await chromium.launch({headless:true});
 try{
  const context=await browser.newContext(),base='http://127.0.0.1:'+server.address().port+'/';
  const a=await context.newPage(),b=await context.newPage();
  await Promise.all([a.goto(base),b.goto(base)]);
  await Promise.all([a.addScriptTag({content:runtime}),b.addScriptTag({content:runtime})]);
  const save=(p,rev,id,stock)=>p.evaluate(args=>window.OCEstadoIDB.guardarConRevision(args.state,args.expected),{state:sale(rev,id,stock),expected:rev-1});
  const [okA,okB]=await Promise.all([save(a,1,'sale-A',99),save(b,1,'sale-B',99)]);
  assert.equal(Number(okA)+Number(okB),1,'one committed sale per prior revision');
  const durable=await a.evaluate(()=>window.OCEstadoIDB.leer());
  assert.equal(durable._rev,1);
  assert.equal(durable.ventas.length,1);
  assert.equal(durable.productos[0].stockActual,99);
  const winner=durable.ventas[0].id;
  const loser=winner==='sale-A'?'sale-B':'sale-A';
  const stale=await save(winner==='sale-A'?b:a,1,'sale-stale',98);
  assert.equal(stale,false,'stale tab cannot commit same base revision');
  const mirrored=await b.evaluate(x=>window.OCEstadoIDB.guardar(x,false),sale(0,'old-buffer',100));
  assert.equal(mirrored,false,'older async backup must not overwrite committed sale');
  const next=await save(a,2,'sale-next',98);
  assert.equal(next,true,'new revision can be committed after reloading current durable state');
  const committed=await b.evaluate(()=>window.OCEstadoIDB.leer());
  assert.equal(committed._rev,2);
  assert.equal(committed.ventas[0].id,'sale-next');
  assert.equal(committed.productos[0].stockActual,98);
  assert.ok(loser);
 }finally{await browser.close();await new Promise(r=>server.close(r));}
});
test('P0: browser transaction abort must not acknowledge a sale',async()=>{
 const server=http.createServer((_,res)=>{res.writeHead(200,{'Content-Type':'text/html'});res.end('synthetic')});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const browser=await chromium.launch({headless:true});
 try{const page=await browser.newPage();await page.goto('http://127.0.0.1:'+server.address().port+'/');await page.addScriptTag({content:runtime});
 const first=await page.evaluate(x=>window.OCEstadoIDB.guardarConRevision(x,0),sale(1,'ok',9));
 assert.equal(first,true);
 const denied=await page.evaluate(x=>window.OCEstadoIDB.guardarConRevision(x,0),sale(2,'wrong-stale',8));
 assert.equal(denied,false,'caller with old revision cannot acknowledge a replacement');
 const after=await page.evaluate(()=>window.OCEstadoIDB.leer());
 assert.equal(after.ventas[0].id,'ok');assert.equal(after._rev,1);
 }finally{await browser.close();await new Promise(r=>server.close(r));}
});
test('P0: no 10-second Web Locks in either sales write gate, strict sale requires durable CAS',()=>{
 const write=backend.slice(backend.indexOf('  const _fetchConCandado = async function'),backend.indexOf('  const _fetchInterno = async function'));
 const save=backend.slice(backend.indexOf('  function _guardarEstadoLocalAhora('),backend.indexOf('  /* v608',backend.indexOf('  function _guardarEstadoLocalAhora(')));
 assert.doesNotMatch(write,/navigator\.locks\.request|10000|Promise\.race\(\[locked/);
 assert.doesNotMatch(ab,/f123-estado-ab:|navigator\.locks\.request/);
 assert.match(save,/idb\.guardarConRevision\(completo, _localRev\)/);
 assert.match(save,/if \(ok !== true\) return terminar\(false\)/,'reject non-boolean CAS acknowledgements');
 assert.match(save,/const ack = terminar\(true\)/);
 assert.match(save,/if \(ab && tokenOk\) setTimeout/);
 assert.doesNotMatch(save,/ab\.conCandado\(/);
});

test('P0 WebKit: atomic IndexedDB sale across two installed-PWA-style pages',async()=>{
 const server=http.createServer((_,res)=>{res.writeHead(200,{'Content-Type':'text/html'});res.end('synthetic notebook')});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const browser=await webkit.launch({headless:true});
 try{const context=await browser.newContext(),base='http://127.0.0.1:'+server.address().port+'/';
 const p1=await context.newPage(),p2=await context.newPage();
 await Promise.all([p1.goto(base),p2.goto(base)]);
 await Promise.all([p1.addScriptTag({content:runtime}),p2.addScriptTag({content:runtime})]);
 const [one,two]=await Promise.all([
  p1.evaluate(state=>window.OCEstadoIDB.guardarConRevision(state,0),sale(1,'webkit-a',7)),
  p2.evaluate(state=>window.OCEstadoIDB.guardarConRevision(state,0),sale(1,'webkit-b',7))]);
 assert.equal(Number(one)+Number(two),1);
 const saved=await p1.evaluate(()=>window.OCEstadoIDB.leer());
 assert.equal(saved.ventas.length,1);
 assert.equal(saved._rev,1);
 assert.equal(saved.productos[0].stockActual,7);
 const retry=await p2.evaluate(state=>window.OCEstadoIDB.guardarConRevision(state,0),sale(2,'stale',6));
 assert.equal(retry,false);
 }finally{await browser.close();await new Promise(r=>server.close(r));}
});
