#!/usr/bin/env node
// Read-only live gate. No PINs, storage, client data or app API actions.
const assert=require('node:assert/strict');
const PUBLIC='https://friendly123.com';
const OLD='https://jfcarpiopuntocom.github.io/friendly-123/';
async function get(url,method='GET'){
 return fetch(url,{method,redirect:'manual',cache:'no-store',signal:AbortSignal.timeout(12000)});
}
(async function(){
 const redirect=await get(PUBLIC+'/app');
 assert.equal(redirect.status,307,'/app must redirect temporarily, not permanently');
 assert.equal(redirect.headers.get('location'),OLD);
 assert.match(redirect.headers.get('cache-control')||'',/no-store/i);
 const responses=await Promise.all([
  get(PUBLIC+'/app/version.json'),get(PUBLIC+'/app/_release.json'),
  get(OLD+'release-proof.json'),get(PUBLIC+'/app/sw.js','HEAD'),get(PUBLIC+'/','HEAD')
 ]);
 const names=['version','official proof','legacy proof','SW','landing'];
 responses.forEach((r,i)=>assert.equal(r.status,200,names[i]+' should respond HTTP 200'));
 const version=await responses[0].json(),proof=await responses[1].json(),legacy=await responses[2].json();
 assert.equal(version.shell,proof.shell);
 assert.equal(proof.sha,proof.commit);
 assert.equal(proof.commit,legacy.commit);
 assert.equal(proof.ref,'estable');
 assert.equal(responses[3].headers.get('location'),null,'SW should never redirect');
 console.log('Confirmed live redirect and same release '+version.shell+' at '+proof.commit.slice(0,12));
 console.log('SW and landing operational. No business data touched.');
})().catch(e=>{console.error('LIVE GATE FAILED:',e.message);process.exitCode=1;});
