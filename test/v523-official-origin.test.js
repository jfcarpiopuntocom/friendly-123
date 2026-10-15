const {test}=require('node:test');
const assert=require('node:assert/strict');
const {pathToFileURL}=require('node:url');
const path=require('node:path');
const SOURCE='https://jfcarpiopuntocom.github.io/friendly-123/';
async function serve(pathname,body,status=200){
 const app=await import(pathToFileURL(path.resolve(__dirname,'../sitio-friendly123/official-app.mjs')).href);
 const requests=[];
 const readSource=async(url,opts)=>{
  requests.push({url,method:opts.method,cache:opts.cache,redirect:opts.redirect});
  return new Response(body,{status,headers:{'Cache-Control':'public, max-age=300','set-cookie':'should-not-pass=1'}});
 };
 const assets={fetch:async()=>new Response('LANDING',{status:200})};
 const response=await app.serveApp(new Request('https://friendly123.com'+pathname),{ASSETS:assets},readSource);
 return {response,requests};
}
test('v523 official /app/ is an always-revalidated same-origin stable release, never a stale five-minute asset',async()=>{
 const body=JSON.stringify({shell:'f123-shell-v522',releaseName:'v522'});
 const {response,requests}=await serve('/app/version.json',body);
 assert.equal(response.status,200);
 assert.equal(requests.length,1);
 assert.ok(requests[0].url.startsWith(SOURCE+'version.json?official='));
 assert.equal(requests[0].cache,'no-store');
 assert.equal(response.headers.get('Cache-Control'),'public, no-cache, max-age=0, must-revalidate, no-transform');
 assert.equal(response.headers.has('set-cookie'),false,'never carry GitHub cookies into the app origin');
 assert.deepEqual(await response.json(),JSON.parse(body));
});
test('v523 the public proof reports the exact stable SHA, without consulting a separate Cloudflare app build',async()=>{
 const sha='a'.repeat(40);
 const {response,requests}=await serve('/app/_release.json',JSON.stringify({schema:1,commit:sha,shell:'f123-shell-v523',cacheGeneration:'golden87'}));
 assert.equal(requests.length,1);
 assert.ok(requests[0].url.startsWith(SOURCE+'release-proof.json?official='));
 const data=await response.json();
 assert.equal(data.sha,sha);
 assert.equal(data.commit,sha);
 assert.equal(data.ref,'estable');
 assert.equal(data.delivery,'same-published-source');
});
test('v523 missing stable source fails visibly, rather than silently falling back to a demo asset',async()=>{
 const {response}=await serve('/app/index.html','not found',404);
 assert.equal(response.status,404);
 const noBody=await serve('/app/sw.js','unavailable',503);
 assert.equal(noBody.response.status,503);
});
