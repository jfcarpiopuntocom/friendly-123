const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(process.env.SW_SOURCE||path.join(__dirname,'../docs/sw.js'),'utf8');
function fixture(){
 const handlers={},network=[],saved=[],local=new Map();
 const scope='https://fixture.test/app/';
 const c={self:{location:{origin:'https://fixture.test',href:scope+'sw.js'},registration:{scope},clients:{claim(){},matchAll:async()=>[]},skipWaiting(){},addEventListener:(k,fn)=>handlers[k]=fn},
  URL,Request,Response,console,TextEncoder,crypto:require('node:crypto').webcrypto,
  caches:{open:async()=>({match:async req=>local.get(typeof req==='string'?new URL(req,scope).href:req.url),put:async(req,res)=>saved.push([req.url,await res.text()])}),match:async req=>local.get(typeof req==='string'?new URL(req,scope).href:req.url)},
  fetch:async req=>{network.push(req.url);return new Response('downloaded')} };
 vm.createContext(c);vm.runInContext(source,c);
 return {handlers,network,saved,local,async request(file){let result;handlers.fetch({request:new Request(new URL(file,scope)),respondWith:p=>result=p});return result?result:undefined}};
}
test('active shell serves its local module without a network request; missing module downloads and remains cached',async()=>{
 const f=fixture();f.local.set('https://fixture.test/app/sync-yjs.js',new Response('local-current-version'));
 assert.equal(await (await f.request('sync-yjs.js')).text(),'local-current-version');assert.equal(f.network.length,0);
 assert.equal(await (await f.request('hechos.js')).text(),'downloaded');await new Promise(r=>setImmediate(r));
 assert.deepEqual(f.saved,[['https://fixture.test/app/hechos.js','downloaded']]);
});
test('version discovery and API calls remain live',async()=>{
 const f=fixture();assert.equal(await f.request('version.json'),undefined);assert.equal(await f.request('/api/venta'),undefined);
});
