// C189 · Real Workerd CORS preflights for the two JFC-approved HTTPS browser origins.
// No customer traffic, credentials, or changes to the business database.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {build} from 'esbuild';
import {Miniflare} from 'miniflare';

const LEGACY='https://friendly-123.jfcarpio.workers.dev';
const OFFICIAL='https://jfcarpiopuntocom.github.io';
const FORBIDDEN='https://attacker.example';
const ROOM='a'.repeat(32);

test('C189: three 2.0 HTTP channels permit only approved GitHub Pages and existing Workers origins',{timeout:30000},async()=>{
 const entry=path.join(import.meta.dirname,'../src/index.js');
 const built=await build({entryPoints:[entry],bundle:true,format:'esm',platform:'neutral',
  conditions:['workerd','worker','browser'],mainFields:['module','main'],
  external:['cloudflare:*'],write:false});
 const mf=new Miniflare({modules:true,script:built.outputFiles[0].text,
  compatibilityDate:'2026-06-01',compatibilityFlags:['nodejs_compat'],
  durableObjects:{Tienda:{className:'Tienda',useSQLite:true}},
  bindings:{SALA_PILOTO:ROOM,WS_AUTHORITY_QA:'1',WS_SEPARATE_ROOMS_QA:'1',
   WS_OPEN_EXISTING_QA:'1',WS_TYPED_COMMANDS_QA:'1',WS_PHOTO_BLOBS_QA:'1',
   WS_CATALOG_ORIGIN_QA:LEGACY,WS_TYPED_ORIGIN_QA:LEGACY,WS_PHOTO_ORIGIN_QA:LEGACY,
   WS_SERVICE_KEY:'synthetic-service-key-only'},
  serviceBindings:{WS_AUTHORITY:async()=>new Response('denied',{status:403})}});
 try{
  const base=await mf.ready;
  const targets=[
   {path:'/parties/tienda/'+ROOM+'-cat?frozen-proof=1',method:'GET'},
   {path:'/parties/tienda/'+ROOM+'-ops',method:'POST'},
   {path:'/parties/tienda/'+ROOM+'-fotos',method:'GET'},
   {path:'/parties/tienda/'+ROOM+'-fotos',method:'PUT'}
  ];
  for(const target of targets){
   const send=(origin,method=target.method)=>fetch(new URL(target.path,base),{
    method:'OPTIONS',headers:{origin,
     'access-control-request-method':method,
     'access-control-request-headers':'authorization,x-f123-license,x-f123-instance,content-type'
    }});
   for(const origin of [LEGACY,OFFICIAL]){
    const response=await send(origin);
    assert.equal(response.status,204,target.path+' '+origin+' must preflight');
    assert.equal(response.headers.get('access-control-allow-origin'),origin,
     'exact allowlisted origin must be echoed, never wildcard');
    assert.equal(response.headers.get('vary'),'Origin');
   }
   for(const origin of [FORBIDDEN,'http://jfcarpiopuntocom.github.io','https://jfcarpiopuntocom.github.io.evil.example']){
    const response=await send(origin);
    assert.equal(response.status,403,target.path+' '+origin+' must be rejected');
    assert.equal(response.headers.get('access-control-allow-origin'),null);
   }
  }
 }finally{await mf.dispose();}
});
