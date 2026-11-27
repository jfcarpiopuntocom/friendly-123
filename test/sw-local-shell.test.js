const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto');
const source=fs.readFileSync(process.env.SW_SOURCE||path.join(__dirname,'../docs/sw.js'),'utf8');
const shell=/^const CACHE = "([^"]+)";/m.exec(source)[1];
const generation=/^const CACHE_GENERACION = "([^"]+)";/m.exec(source)[1];
const cacheName=shell+generation;
const digest=s=>'sha256-'+crypto.createHash('sha256').update(s).digest('hex');
function fixture(){
 const handlers={},network=[],saved=[],local=new Map();
 const scope='https://fixture.test/app/';
 const key=req=>typeof req==='string'?new URL(req,scope).href:req.url;
 const c={self:{location:{origin:'https://fixture.test',href:scope+'sw.js'},registration:{scope},clients:{claim(){},matchAll:async()=>[]},skipWaiting(){},addEventListener:(k,fn)=>handlers[k]=fn},
  URL,Request,Response,console,TextEncoder,crypto:crypto.webcrypto,
  caches:{keys:async()=>[cacheName],open:async()=>({match:async req=>local.get(key(req))?.clone(),put:async(req,res)=>saved.push([req.url,await res.text()])}),match:async(req,opts)=>{assert.equal(opts?.cacheName,cacheName);return local.get(key(req))?.clone()}},
  fetch:async req=>{network.push(req.url);return new Response('downloaded')} };
 vm.createContext(c);vm.runInContext(source,c);
 return {handlers,network,saved,local,async request(file){let result;handlers.fetch({request:new Request(new URL(file,scope)),respondWith:p=>result=p});return result?result:undefined},manifest(files){local.set(scope+'version-manifest.json',new Response(JSON.stringify({shell,files})));}};
}
test('active shell serves its local module without a network request; missing manifest-verified module downloads and remains cached',async()=>{
 const f=fixture();f.local.set('https://fixture.test/app/sync-yjs.min.js',new Response('local-current-version'));
 assert.equal(await (await f.request('sync-yjs.min.js')).text(),'local-current-version');assert.equal(f.network.length,0);
 f.manifest({'./hechos.min.js':digest('downloaded')});
 assert.equal(await (await f.request('hechos.min.js')).text(),'downloaded');await new Promise(r=>setImmediate(r));
 assert.deepEqual(f.network,['https://fixture.test/app/hechos.min.js']);
 assert.deepEqual(f.saved,[['https://fixture.test/app/hechos.min.js','downloaded']]);
});
test('active shell refuses an unknown module and a mismatched digest without cache poisoning',async()=>{
 const f=fixture();
 assert.equal((await f.request('hechos.min.js')).status,503);assert.equal(f.network.length,0);
 f.manifest({'./hechos.min.js':digest('certified bytes')});
 assert.equal((await f.request('hechos.min.js')).status,503);await new Promise(r=>setImmediate(r));
 assert.deepEqual(f.network,['https://fixture.test/app/hechos.min.js']);assert.deepEqual(f.saved,[]);
});
test('version discovery and API calls remain live',async()=>{
 const f=fixture();assert.equal(await f.request('version.json'),undefined);assert.equal(await f.request('/api/venta'),undefined);
});
