'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const files=name=>fs.readFileSync(path.resolve(__dirname,'../docs',name),'utf8');

test('PIN, backup, Dashboard y panel conservan el origen legacy al abrir rescate',()=>{
 for(const file of ['auth-ui.js','avanzado-extra.js','dashboard.html','panel.html']){
  assert.match(files(file),/href=["']\.\/pwa-rescue\.html\?stay=1["']/i,file);
 }
});

test('el rescate vuelve a la tienda y Dashboard viejos sin abandonar sus bases aisladas',()=>{
 const page=files('pwa-rescue.html');
 assert.match(page,/href=["']\.\/\?stay=1["']/i);
 assert.match(page,/href=["']\.\/dashboard\.html\?stay=1["']/i);
 assert.match(page,/friendly123\.com\/app\//);
 assert.match(page,/IndexedDB|IDB/);
 for(const op of ['indexedDB.deleteDatabase(', 'localStorage.clear(', 'caches.delete(', '.unregister(']){
  assert.ok(!page.includes(op),'Rescate no debe borrar: '+op);
 }
});

test('pasarela legacy con stay=1 sirve recuperación desde el mismo origen en vez de redireccionar',async()=>{
 const {serveApp}=await import('../sitio-friendly123/official-app.mjs');
 let upstream='';
 const upstreamResponse=async(url)=>{upstream=url;return new Response('<!doctype html><title>Rescate PWA</title>',{status:200,headers:{'Content-Type':'text/html'}});};
 const kept=await serveApp(new Request('https://friendly123.com/app/pwa-rescue.html?stay=1',{headers:{Accept:'text/html','Sec-Fetch-Mode':'navigate'}}),{},upstreamResponse);
 assert.equal(kept.status,200);
 assert.equal(kept.headers.get('Location'),null);
 assert.match(await kept.text(),/Rescate PWA/);
 assert.equal(new URL(upstream).pathname,'/friendly-123/pwa-rescue.html');
 const bounced=await serveApp(new Request('https://friendly123.com/app/pwa-rescue.html',{headers:{Accept:'text/html','Sec-Fetch-Mode':'navigate'}}),{},upstreamResponse);
 assert.equal(bounced.status,307);
 assert.match(bounced.headers.get('Location'),/^https:\/\/jfcarpiopuntocom\.github\.io\/friendly-123\/pwa-rescue\.html/);
});
