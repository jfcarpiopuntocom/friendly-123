// Exact b93 relay plus real authority modules; local Workerd only, no production traffic.
import {before,after,test} from 'node:test';import assert from 'node:assert/strict';
import {AsyncLocalStorage} from 'node:async_hooks';
import fs from 'node:fs';import path from 'node:path';import os from 'node:os';
import {createRequire} from 'node:module';import {createServer} from 'node:http';import {once} from 'node:events';
import {build} from 'esbuild';import {Miniflare} from 'miniflare';import WebSocket from 'ws';import * as Y from 'yjs';import YProvider from 'y-partyserver/provider';
import authorityWorker,{RegistroLicencias} from '../../cloudflare-worker/worker.js';
import {pinAuthority} from '../../cloudflare-worker/pin-authority.mjs';
import {salaDeLicencia} from '../src/sala.js';
import {createOwnerTicketParams} from '../../src/ws-owner-ticket-params.mjs';
const nativeYjs=import.meta.resolve('yjs');
const clientBuild=await build({entryPoints:[new URL('../../src/authorized-yprovider.mjs',import.meta.url).pathname],nodePaths:[new URL('../node_modules',import.meta.url).pathname],bundle:true,format:'esm',platform:'node',write:false,plugins:[{name:'same-yjs-instance',setup(b){b.onResolve({filter:/^yjs$/},()=>({path:nativeYjs,external:true}));}}]});
const {default:AuthorizedYProvider}=await import('data:text/javascript;base64,'+Buffer.from(clientBuild.outputFiles[0].text).toString('base64'));
const license='F123-SYNT-TEAM',instance='synthetic-instance',secret='synthetic-private-sync-service-more-than-32bytes';
let mf,url,room,registry,env,db,bundle,available=true,holdCheckToken=null,holdEntered=null,releaseCheck=null,heldOnce=false;
const authorityTrace=new AsyncLocalStorage(),grants=new Map(),wireFrames=new Map(),revokedAt=new Map();let traceSeq=0;
function claimsOf(token){return JSON.parse(Buffer.from(token.split('.')[0],'base64url'));}
class AuditedSocket extends WebSocket{
 constructor(address,...rest){super(address,...rest);const token=new URL(address).searchParams.get('cap');let claims;try{claims=claimsOf(token);}catch(_){return;}
  this.on('message',(data,binary)=>{const frames=wireFrames.get(claims.jti)||[],decision=grants.get(claims.jti)?.[frames.length+1];
   frames.push({binary,kind:binary?new Uint8Array(data)[0]:'custom',grantSeq:decision?.seq??null,revokedSeq:revokedAt.get(claims.instance)??null});wireFrames.set(claims.jti,frames);
  });
 }
}
const persist=fs.mkdtempSync(path.join(os.tmpdir(),'f123-ws-qa-'));
async function startRelay(extraBindings={}){const bindings={SALA_PILOTO:room,WS_AUTHORITY_QA:'1',WS_SERVICE_KEY:secret,...extraBindings};if(bindings.WS_AUTHORITY_QA===undefined)delete bindings.WS_AUTHORITY_QA;mf=new Miniflare({modules:true,script:bundle,compatibilityDate:'2026-06-01',compatibilityFlags:['nodejs_compat'],durableObjects:{Tienda:{className:'Tienda',useSQLite:true}},durableObjectsPersist:path.join(persist,'do'),kvNamespaces:['LICENCIAS'],bindings,serviceBindings:{WS_AUTHORITY:async request=>{if(!available)return new Response('unavailable',{status:503});const raw=await request.text();if(holdCheckToken&&!heldOnce&&new URL(request.url).pathname==='/ws/check'&&JSON.parse(raw).token===holdCheckToken){heldOnce=true;holdEntered?.();await new Promise(r=>releaseCheck=r);}return authorityTrace.run({path:new URL(request.url).pathname},()=>authorityWorker.fetch(new Request(request.url,{method:request.method,headers:request.headers,body:raw}),env));}}});await(await mf.getKVNamespace('LICENCIAS')).put('inst:'+instance,JSON.stringify({licenseCode:license,instanceId:instance}));url=await mf.ready;}
function storage(){let records=new Map(),tail=Promise.resolve();return{get:async k=>structuredClone(records.get(k)),transaction:async f=>{let release;const prev=tail;tail=new Promise(r=>release=r);await prev;const next=new Map([...records].map(([k,v])=>[k,structuredClone(v)]));try{const r=await f({get:async k=>structuredClone(next.get(k)),put:async(k,v)=>next.set(k,structuredClone(v)),delete:async k=>next.delete(k),list:async({prefix,limit})=>new Map([...next].filter(([k])=>k.startsWith(prefix)).slice(0,limit))});const previous=records;records=next;const seq=++traceSeq;for(const [k,v] of next)if(k.startsWith('inst:')&&v.estado==='bloqueada'&&previous.get(k)?.estado!=='bloqueada')revokedAt.set(v.instanceId,seq);if(authorityTrace.getStore()?.path==='/ws/check'&&r?.ok&&r.principal?.jti){const entries=grants.get(r.principal.jti)||[];entries.push({seq});grants.set(r.principal.jti,entries);}return r;}finally{release();}}};}
async function api(route,body){return authorityWorker.fetch(new Request('https://authority.invalid'+route,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}),env);}
async function issue(channel='priv',scopes=['priv:read','priv:write'],ttlMs=30000,instanceId=instance){const r=await api('/ws/ticket',{credentials:{kind:'owner',licenseCode:license,instanceId,pin:'123'},room:room+'-'+channel,scopes,ttlMs});const data=await r.json();assert.equal(r.status,200,JSON.stringify(data));return data.token;}
async function raw(channel,token){return new Promise((resolve,reject)=>{let binary=0,done=false;const target=new URL('/parties/tienda/'+room+'-'+channel,url);target.protocol='ws:';target.search=new URLSearchParams({licencia:license,instancia:instance,...(token?{cap:token}:{})});const ws=new WebSocket(target);const finish=status=>{if(done)return;done=true;clearTimeout(timer);ws.terminate();resolve({status,binary});};const timer=setTimeout(()=>finish('open'),250);ws.on('message',(_,isBinary)=>{if(isBinary)binary++;});ws.on('close',code=>finish(code));ws.on('unexpected-response',(_req,res)=>finish(res.statusCode));ws.on('error',()=>{});});}
async function until(fn,label){const start=Date.now();while(!fn()){if(Date.now()-start>5000)throw Error('timeout '+label);await new Promise(r=>setTimeout(r,15));}}
async function durableBarrier(provider){
 let timer,handler;
 try{await new Promise((resolve,reject)=>{timer=setTimeout(()=>reject(Error('durable protocol barrier missing')),5000);handler=message=>{if(message.startsWith('estado-durable:'))resolve();};provider.on('custom-message',handler);provider.sendMessage('estado-durable');});}
 finally{clearTimeout(timer);if(handler)provider.off('custom-message',handler);}
}
async function connect(token,instanceId=instance){const doc=new Y.Doc();const p=new YProvider(url.host,room+'-priv',doc,{party:'tienda',params:{licencia:license,instancia:instanceId,cap:token},WebSocketPolyfill:AuditedSocket,disableBc:true});try{await until(()=>p.synced,'sync');}catch(e){p.destroy();doc.destroy();throw e;}return{doc,p,close(){p.destroy();doc.destroy();}};}
before(async()=>{room=await salaDeLicencia(license);db=storage();await db.transaction(tx=>tx.put('inst:'+instance,{licenseCode:license,instanceId:instance}));env={PIN_PEPPER:'synthetic-owner-secret-more-than-32bytes',TEAM_PIN_PEPPER:'synthetic-team-secret-separate-32bytes',TEAM_AUTHORITY_QA:'1',TEAM_AUTHORITY_LICENSE:license,WS_AUTHORITY_QA:'1',WS_SIGNING_KEY:'synthetic-ws-signing-secret-more-than-32bytes',WS_SERVICE_KEY:secret};const owner=pinAuthority(db,env.PIN_PEPPER);await owner.masterSet(license,'123',0,[instance]);await owner.masterActivate(license,'123',0,[instance]);registry=new RegistroLicencias({storage:db},env);env.REGISTROS={idFromName:()=>({}),get:()=>({fetch:(u,o)=>registry.fetch(new Request(u,o))})};const result=await build({entryPoints:[path.join(import.meta.dirname,'../src/index.js')],bundle:true,format:'esm',platform:'neutral',mainFields:['module','main'],conditions:['workerd','worker','browser'],external:['cloudflare:*'],write:false});bundle=result.outputFiles[0].text;await startRelay();});
after(async()=>{await mf?.dispose();fs.rmSync(persist,{recursive:true,force:true});});
test('copied identifiers without a ticket receive zero Yjs frames',{timeout:15000},async()=>{const r=await raw('cat');assert.equal(r.binary,0);assert.notEqual(r.status,'open');});
test('real Owner ticket opens private YServer, persists facts, and cannot replay',{timeout:15000},async()=>{const token=await issue(),a=await connect(token);try{a.doc.getMap('private').set('synthetic-value',41);const second=await issue(),b=await connect(second);try{await until(()=>b.doc.getMap('private').get('synthetic-value')===41,'private readback');}finally{b.close();}const replay=await raw('priv',token);assert.equal(replay.binary,0);assert.notEqual(replay.status,'open');}finally{a.close();}});
test('missing authority fails closed before any Yjs state',{timeout:15000},async()=>{const token=await issue();available=false;try{const result=await raw('priv',token);assert.equal(result.binary,0);assert.notEqual(result.status,'open');}finally{available=true;}});
test('raw operations and broad shared rooms remain closed in secure QA until their boundary exists',{timeout:15000},async()=>{for(const channel of ['cat','ops','fotos']){const token=await issue(channel,[channel==='ops'?'ops:sale':channel+':read']);const result=await raw(channel,token);assert.equal(result.binary,0);assert.notEqual(result.status,'open');}});

test('a read-only Owner credential cannot persist or broadcast a raw private edit',{timeout:15000},async()=>{
 const observer=await connect(await issue()),reader=await connect(await issue('priv',['priv:read']));
 try{reader.doc.getMap('private').set('forbidden-readonly-edit',99);const fresh=await connect(await issue());try{assert.equal(fresh.doc.getMap('private').has('forbidden-readonly-edit'),false);assert.equal(observer.doc.getMap('private').has('forbidden-readonly-edit'),false);}finally{fresh.close();}}finally{reader.close();observer.close();}
});
test('expired idle recipient gets no binary update when a valid Owner publishes',{timeout:15000},async()=>{
 const writer=await connect(await issue()),token=await issue('priv',['priv:read'],650),expiry=JSON.parse(Buffer.from(token.split('.')[0],'base64url')).exp;
 const idle=await connect(token),socket=idle.p.ws;let frames=0,closed;
 try{await new Promise(r=>setTimeout(r,Math.max(0,expiry-Date.now()+30)));socket.on('message',(_,binary)=>{if(binary)frames++;});socket.on('close',code=>{closed=code;});writer.doc.getMap('private').set('post-expiry',77);await until(()=>closed!==undefined,'expiry close');assert.equal(closed,1008);assert.equal(frames,0);assert.equal(idle.doc.getMap('private').has('post-expiry'),false);}finally{idle.close();writer.close();}
});
test('revoked idle recipient gets no next update; valid instance still syncs',{timeout:15000},async()=>{
 const other='synthetic-second-instance';await db.transaction(tx=>tx.put('inst:'+other,{licenseCode:license,instanceId:other}));
 const writer=await connect(await issue()),response=await api('/ws/ticket',{credentials:{kind:'owner',licenseCode:license,instanceId:other,pin:'123'},room:room+'-priv',scopes:['priv:read']});const token=(await response.json()).token;
 const idleDoc=new Y.Doc(),provider=new YProvider(url.host,room+'-priv',idleDoc,{party:'tienda',params:{licencia:license,instancia:other,cap:token},WebSocketPolyfill:AuditedSocket,disableBc:true});
 try{await until(()=>provider.synced,'second instance');await durableBarrier(provider);const socket=provider.ws;let frames=0,closed;socket.on('message',(_,binary)=>{if(binary)frames++;});socket.on('close',code=>{closed=code;});await db.transaction(tx=>tx.put('inst:'+other,{licenseCode:license,instanceId:other,estado:'bloqueada'}));writer.doc.getMap('private').set('post-revocation',88);await until(()=>closed!==undefined,'revocation close');assert.equal(closed,1008);assert.equal(frames,0);assert.equal(idleDoc.getMap('private').has('post-revocation'),false);}finally{provider.destroy();idleDoc.destroy();writer.close();}
});
test('private facts survive full Workerd restart in SQL and require a fresh real ticket',{timeout:20000},async()=>{
 const a=await connect(await issue());a.doc.getMap('private').set('cold-recovery',12345);const witness=await connect(await issue());await until(()=>witness.doc.getMap('private').get('cold-recovery')===12345,'before restart');a.close();witness.close();await mf.dispose();await startRelay();const cold=await connect(await issue());try{assert.equal(cold.doc.getMap('private').get('cold-recovery'),12345);assert.equal(cold.doc.getMap('private').has('forbidden-readonly-edit'),false);}finally{cold.close();}
});
test('revoked recipient gets no awareness frame when another socket closes',{timeout:15000},async()=>{
 const sender=await connect(await issue()),receiver=await connect(await issue());let timer;
 try{
  sender.p.awareness.setLocalStateField('syntheticMarker','synthetic-presence');
  await until(()=>[...receiver.p.awareness.getStates().values()].some(s=>s.syntheticMarker==='synthetic-presence'),'presence setup');
  await durableBarrier(receiver.p); // Drain pre-revocation sends before counting forbidden frames.
  let binary=0,closed;
  const observed=new Promise((resolve,reject)=>{timer=setTimeout(()=>reject(Error('no revocation outcome')),5000);receiver.p.ws.on('message',(_,isBinary)=>{if(isBinary){binary++;resolve();}});receiver.p.ws.once('close',code=>{closed=code;resolve();});});
  await db.transaction(tx=>tx.put('inst:'+instance,{licenseCode:license,instanceId:instance,estado:'bloqueada'}));
  sender.p.ws.terminate();await observed;
  if(binary)console.log('SYNTHETIC-FRAME-AUDIT',JSON.stringify([...wireFrames].map(([jti,frames])=>({jti,frames:frames.slice(-8)}))));assert.equal(binary,0,'revoked recipient must receive no lifecycle frame');assert.equal(closed,1008);
 }finally{clearTimeout(timer);sender.close();receiver.close();await db.transaction(tx=>tx.put('inst:'+instance,{licenseCode:license,instanceId:instance}));}
});

for(const flag of ['0',undefined])test('secure QA flag '+String(flag)+' never falls back to copied-identifier access',{timeout:20000},async()=>{
 await mf.dispose();await startRelay({WS_AUTHORITY_QA:flag});
 try{const result=await raw('cat');assert.equal(result.binary,0,'missing secure mode must not reopen the historical reader');assert.notEqual(result.status,'open');}finally{await mf.dispose();await startRelay();}
});

test('a valid admission waiting for authority is not revoked by another peer activity',{timeout:15000},async()=>{
 const writer=await connect(await issue()),token=await issue();holdCheckToken=token;heldOnce=false;
 const entered=new Promise(r=>holdEntered=r),doc=new Y.Doc();
 const joining=new YProvider(url.host,room+'-priv',doc,{party:'tienda',params:{licencia:license,instancia:instance,cap:token},WebSocketPolyfill:AuditedSocket,disableBc:true});
 try{await entered;const socket=joining.ws;writer.doc.getMap('private').set('during-admission',314);await durableBarrier(writer.p);assert.equal(joining.synced,false,'admission cannot expose state before authority returns');releaseCheck();await until(()=>joining.synced,'queued valid admission');assert.equal(doc.getMap('private').get('during-admission'),314);}
 finally{releaseCheck?.();holdCheckToken=null;holdEntered=null;releaseCheck=null;joining.destroy();doc.destroy();writer.close();}
});

test('authorized client renews through real issuer and resumes the same local document after denial',{timeout:15000},async()=>{
 const doc=new Y.Doc(),tickets=[];let attempts=0,denied=0,peer;
 doc.getMap('private').set('client-local-opId','synthetic-client-stable-opId');
 const params=createOwnerTicketParams({licenseCode:license,instanceId:instance,room:room+'-priv',getCredentials:()=>({kind:'owner',licenseCode:license,instanceId:instance,pin:'123'}),fetch:async(endpoint,options)=>{attempts++;assert.equal(endpoint,'https://friendly123-licencias.jfcarpio.workers.dev/ws/ticket');const response=await authorityWorker.fetch(new Request(endpoint,options),env),data=await response.clone().json();if(data.ok)tickets.push(data.token);return response;}});
 const provider=new AuthorizedYProvider(url.host,room+'-priv',doc,{party:'tienda',connect:false,disableBc:true,maxBackoffTime:20,WebSocketPolyfill:AuditedSocket,params});
 provider.on('authorization-error',()=>denied++);
 try{
  await provider.connect();await until(()=>provider.synced,'authorized client initial sync');await durableBarrier(provider);
  const original=provider.ws;original.close(1012,'synthetic restart');await until(()=>provider.synced&&provider.ws!==original,'renewed client sync');
  assert.equal(tickets.length,2);assert.notEqual(tickets[0],tickets[1],'one-use ticket cannot be reused across connections');
  env.WS_AUTHORITY_QA='0';provider.ws.close(1012,'synthetic authority outage');await until(()=>denied===1,'client denial');
  assert.equal(provider.shouldConnect,false);assert.equal(provider.ws,null);assert.equal(attempts,3);
  doc.getMap('private').set('client-pending-after-denial',{opId:'synthetic-client-stable-opId',value:271});
  assert.equal(doc.getMap('private').get('client-local-opId'),'synthetic-client-stable-opId');
  env.WS_AUTHORITY_QA='1';await provider.connect();await until(()=>provider.synced,'client explicit recovery');
  peer=await connect(await issue());await until(()=>peer.doc.getMap('private').has('client-pending-after-denial'),'offline edit reached peer');
  assert.deepEqual(peer.doc.getMap('private').get('client-pending-after-denial'),{opId:'synthetic-client-stable-opId',value:271});assert.equal(tickets.length,3);
 }finally{env.WS_AUTHORITY_QA='1';provider.destroy();provider.awareness.destroy();doc.destroy();peer?.close();}
});

test('confirmed client sessions renew twice after real capability expiry without exhausting the admission budget',{timeout:15000},async()=>{
 const doc=new Y.Doc(),tickets=[];let writer;
 const provider=new AuthorizedYProvider(url.host,room+'-priv',doc,{party:'tienda',connect:false,maxBackoffTime:20,WebSocketPolyfill:AuditedSocket,params:async()=>{const token=await issue('priv',['priv:read','priv:write'],400);tickets.push(token);return{licencia:license,instancia:instance,cap:token};}});
 try{await provider.connect();await until(()=>provider.synced,'short-lived client');writer=await connect(await issue());
  for(let n=1;n<=2;n++){
   const priorSocket=provider.ws,exp=claimsOf(tickets.at(-1)).exp;await until(()=>Date.now()>=exp,'actual capability expiry');writer.doc.getMap('private').set('expiry-renewal-marker',n);
   await until(()=>provider.synced&&provider.ws!==priorSocket&&doc.getMap('private').get('expiry-renewal-marker')===n,'fresh admission after expiry');
  }assert.equal(tickets.length,3);assert.equal(provider.shouldConnect,true);
 }finally{provider.destroy();provider.awareness.destroy();doc.destroy();writer?.close();}
});

for(const engineName of ['chromium','webkit'])test(engineName+' authorized browser preserves IndexedDB across denial, reload and real peer recovery',{timeout:45000},async()=>{
 // Independent scenarios must not spend one synthetic device's shared quota.
 // Keep the real issuer limit and the rate-limit contract test unchanged.
 const browserInstance='synthetic-browser-'+engineName,observerInstance='synthetic-observer-'+engineName;
 await db.transaction(async tx=>{for(const instanceId of [browserInstance,observerInstance])await tx.put('inst:'+instanceId,{licenseCode:license,instanceId});});
 const playwright=createRequire(new URL('../../package.json',import.meta.url))('playwright');
 const browserBuild=await build({stdin:{contents:`import Provider from ${JSON.stringify(new URL('../../src/authorized-yprovider.mjs',import.meta.url).pathname)};import {createOwnerTicketParams} from ${JSON.stringify(new URL('../../src/ws-owner-ticket-params.mjs',import.meta.url).pathname)};window.F123AuthorizedClient={Provider,createOwnerTicketParams};`,resolveDir:new URL('..',import.meta.url).pathname},nodePaths:[new URL('../node_modules',import.meta.url).pathname],bundle:true,format:'iife',platform:'browser',write:false,plugins:[{name:'existing-browser-yjs',setup(b){b.onResolve({filter:/^yjs$/},()=>({path:'yjs',namespace:'browser-yjs'}));b.onLoad({filter:/.*/,namespace:'browser-yjs'},()=>({contents:'export const {Doc,encodeStateVector,encodeStateAsUpdate,applyUpdate}=window.Y;'}));}}]});
 const yjsBytes=fs.readFileSync(new URL('../../docs/vendor/yjs-bundle.min.js',import.meta.url));
 const server=createServer(async(req,res)=>{try{
  if(req.url==='/issuer'){
   let body='';for await(const part of req){body+=part;if(body.length>4096){res.writeHead(413).end();return;}}
   const result=await authorityWorker.fetch(new Request('https://friendly123-licencias.jfcarpio.workers.dev/ws/ticket',{method:'POST',headers:{'content-type':'application/json'},body}),env);res.writeHead(result.status,{'content-type':'application/json','cache-control':'no-store'}).end(await result.text());
  }else if(req.url==='/yjs.js')res.writeHead(200,{'content-type':'text/javascript'}).end(yjsBytes);
  else if(req.url==='/client.js')res.writeHead(200,{'content-type':'text/javascript'}).end(browserBuild.outputFiles[0].text);
  else res.writeHead(200,{'content-type':'text/html'}).end('<!doctype html><title>Synthetic authorized browser fixture</title><script src="/yjs.js"></script><script src="/client.js"></script>');
 }catch(_){res.writeHead(500).end();}});
 server.listen(0,'127.0.0.1');await once(server,'listening');let browser,context,peer;
 const key='browser-recovery-'+engineName,fixtureUrl='http://127.0.0.1:'+server.address().port;
 try{
  browser=await playwright[engineName].launch({headless:true});context=await browser.newContext({serviceWorkers:'block'});
  await context.route('**/*',r=>['127.0.0.1','localhost'].includes(new URL(r.request().url()).hostname)?r.continue():r.abort());
  await context.routeWebSocket(/^wss?:\/\/(?!127\.0\.0\.1:|localhost:)/,s=>s.close());
  const page=await context.newPage();await page.goto(fixtureUrl);
  async function boot(){await page.evaluate(async({license,instance,room,host})=>{
   window.doc=new Y.Doc();window.idb=new IndexeddbPersistence('f123-yjs-'+room,doc);await idb.whenSynced;
   const params=F123AuthorizedClient.createOwnerTicketParams({licenseCode:license,instanceId:instance,room:room+'-priv',getCredentials:()=>({kind:'owner',licenseCode:license,instanceId:instance,pin:'123'}),fetch:(endpoint,options)=>{if(endpoint!=='https://friendly123-licencias.jfcarpio.workers.dev/ws/ticket')throw Error('unexpected issuer');return fetch('/issuer',options);}});
   window.denied=0;window.provider=new F123AuthorizedClient.Provider(host,room+'-priv',doc,{party:'tienda',connect:false,maxBackoffTime:20,params});provider.on('authorization-error',()=>denied++);
  },{license,instance:browserInstance,room,host:url.host});}
  await boot();await page.evaluate(async key=>{doc.getMap('private').set(key,{opId:'synthetic-stable-browser-op',value:419});await provider.connect();},key);await page.waitForFunction(()=>provider.synced);
  peer=await connect(await issue('priv',['priv:read','priv:write'],30000,observerInstance),observerInstance);await until(()=>peer.doc.getMap('private').has(key),'browser value reached real peer');assert.deepEqual(peer.doc.getMap('private').get(key),{opId:'synthetic-stable-browser-op',value:419});peer.close();peer=null;
  env.WS_AUTHORITY_QA='0';await page.evaluate(()=>provider.ws?.close(4001,'synthetic issuer outage'));await page.waitForFunction(()=>denied===1);assert.equal(await page.evaluate(()=>provider.shouldConnect),false);
  await page.evaluate(async key=>{doc.getMap('private').set(key,{opId:'synthetic-stable-browser-op',value:421,pending:true});await new Promise((resolve,reject)=>{const tx=idb.db.transaction('updates','readonly');tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});},key);
  await page.reload();await boot();assert.deepEqual(await page.evaluate(key=>doc.getMap('private').get(key),key),{opId:'synthetic-stable-browser-op',value:421,pending:true});
  assert.deepEqual(await page.evaluate(()=>[localStorage.length,sessionStorage.length]),[0,0],'new transport never persists PIN or capability into browser storage');
  env.WS_AUTHORITY_QA='1';await page.evaluate(()=>provider.connect());await page.waitForFunction(()=>provider.synced);
  peer=await connect(await issue('priv',['priv:read','priv:write'],30000,observerInstance),observerInstance);await until(()=>peer.doc.getMap('private').get(key)?.value===421,'reloaded offline value reached real peer');assert.deepEqual(peer.doc.getMap('private').get(key),{opId:'synthetic-stable-browser-op',value:421,pending:true});
 }finally{env.WS_AUTHORITY_QA='1';peer?.close();await context?.close();await browser?.close();await new Promise(r=>server.close(r));}
});
