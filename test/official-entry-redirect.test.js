const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {pathToFileURL}=require('node:url');

let modulePromise;
function app(){return modulePromise ||= import(pathToFileURL(path.resolve(__dirname,'../sitio-friendly123/official-app.mjs')).href)}
async function serve(route,init={}){
 const called=[];
 const url='https://friendly123.com'+route;
 const fetchUpstream=async(target,options)=>{
  called.push({target,options});
  return new Response(JSON.stringify({schema:1,commit:'a'.repeat(40),shell:'f123-shell-v522'}),
    {status:200,headers:{'Content-Type':'application/json','set-cookie':'test=1',
      'Cache-Control':'public,max-age=300'}});
 };
 const env={ASSETS:{fetch:()=>new Response('ORIGINAL LANDING',{status:200})}};
 const {serveApp}=await app();
 return {response:await serveApp(new Request(url,init),env,fetchUpstream),called};
}
const prefix='https://jfcarpiopuntocom.github.io/friendly-123/';
test('official /app and /app/ redirect directly via 307, without any origin fetch',async()=>{
 for(const route of ['/app','/app/','/app/index.html']){
   const {response,called}=await serve(route,{headers:{accept:'text/html'}});
   assert.equal(response.status,307,route);
   assert.equal(response.headers.get('location'),prefix);
   assert.equal(response.headers.get('cache-control'),'no-store, max-age=0');
   assert.equal(response.headers.get('referrer-policy'),'no-referrer');
   assert.deepEqual(called,[]);
 }
});
test('new /app?entry=1 bypasses an old cached permanent /app → /app/ mapping',async()=>{
 const {response,called}=await serve('/app?entry=1&licenseCode=NOT-FORWARDABLE',{headers:{accept:'text/html'}});
 assert.equal(response.status,307);
 assert.equal(response.headers.get('location'),prefix);
 assert.equal(called.length,0);
});
test('invalid double-slash HTML paths are not externally redirected',async()=>{
 const {response,called}=await serve('/app//wrong.html',{headers:{accept:'text/html'}});
 assert.equal(response.status,404);
 assert.equal(called.length,0);
});
test('a deep HTML entry preserves its relative view, never arbitrary query data or license',async()=>{
 const {response,called}=await serve('/app/dashboard.html?licenseCode=TOP-SECRET&estable=1',
 {headers:{accept:'text/html'}});
 assert.equal(response.status,307);
 assert.equal(response.headers.get('location'),prefix+'dashboard.html?estable=1');
 assert.ok(!response.headers.get('location').includes('TOP-SECRET'));
 assert.equal(called.length,0);
});
test('JS, SW, version and immutable release proof are still served from the one stable branch',async()=>{
 for(const route of ['/app/sw.js','/app/auth-ui.js','/app/version.json','/app/_release.json']){
   const {response,called}=await serve(route,{headers:{accept:'application/json'}});
   assert.equal(response.status,200,route);
   assert.equal(called.length,1,route);
   assert.equal(called[0].options.cache,'no-store');
   assert.equal(response.headers.get('cache-control'),'public, no-cache, max-age=0, must-revalidate, no-transform');
   assert.equal(response.headers.has('set-cookie'),false);
   if(route.endsWith('_release.json')){
     const p=await response.json();
     assert.equal(p.ref,'estable');
     assert.equal(p.sha,'a'.repeat(40));
   }
 }
});
test('clients who already own a new-origin notebook retain a non-destructive escape',async()=>{
 const root=await serve('/app/?stay=1',{headers:{accept:'text/html'}});
 assert.equal(root.response.status,200);
 assert.equal(root.called.length,1,'stay=1 uses existing new-origin stable read-through');
 const noSlash=await serve('/app?stay=1');
 assert.equal(noSlash.response.status,307);
 assert.equal(noSlash.response.headers.get('location'),'https://friendly123.com/app/?stay=1');
});
test('HEAD is not a login redirect, POST is never redirected, landing is untouched',async()=>{
 const head=await serve('/app/index.html',{method:'HEAD'});
 assert.equal(head.response.status,200);
 assert.equal(head.called.length,1);
 const post=await serve('/app/',{method:'POST'});
 assert.equal(post.response.status,405);
 assert.equal(post.called.length,0);
 const landing=await serve('/');
 assert.equal(await landing.response.text(),'ORIGINAL LANDING');
 assert.equal(landing.called.length,0);
});
test('the existing PWA updates are already incremental and safe: no new library or sync mutations',()=>{
 const html=fs.readFileSync(path.resolve(__dirname,'../docs/index.html'),'utf8');
 const sw=fs.readFileSync(path.resolve(__dirname,'../docs/sw.js'),'utf8');
 const dash=fs.readFileSync(path.resolve(__dirname,'../docs/dashboard-updates.js'),'utf8');
 assert.match(html,/serviceWorker\.register\("\.\/sw\.js", \{ updateViaCache: "none" \}/);
 assert.match(html,/window\.addEventListener\("online"|visibilitychange/);
 assert.match(html,/BroadcastChannel\("f123-version"\)/);
 assert.match(html,/setInterval\(revisar, 600000\)/);
 assert.match(html,/function seguro\(\)/);
 assert.match(sw,/const CACHE_GENERACION/);
 assert.match(sw,/CACHE_LOCAL/);
 assert.match(sw,/cache\.match\(evento\.request\)/);
 assert.match(dash,/if \(!await bridge\.prepare\(\) \|\| !bridge\.safe\(\)\)/);
});
