// Product C12: inspect actual browser-facing source with Yjs and synthetic C11 proof.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as Y from 'yjs';
import {openCertifiedReadOnlyPublicCatalog} from '../../src/port2-readonly-catalog-session.mjs';
import {createOwnerTicketParams} from '../../src/ws-owner-ticket-params.mjs';

const room='a'.repeat(32)+'-cat',license='F123-SYNTH-READONLY',instance='synthetic-c12-browser';
const head='certified-frozen-c12',sha='f'.repeat(64);
function fixture({badProof=false,mutateRemote=false,privateRemote=false,hidden=false}={}){
 const local=new Y.Doc(),requests=[],providers=[],tokens=[];
 local.getMap('productos').set('book-1',{id:'book-1',nombre:'Book',precio:12,stockActual:2});
 local.getMap('ubicaciones').set('shelf-1',{id:'shelf-1',nombre:'Shelf',activa:true});
 local.getMap('_meta').set('pin','NEVER_TO_WORKER');
 local.getMap('ventas').set('sale-1',{importe:999999});
 let pin='123';
 const getCredentials=()=>({kind:'owner',licenseCode:license,instanceId:instance,pin});
 let issued=0;
 const send=async(url,opts)=>{
  requests.push({url,opts});
  if(url.endsWith('/ws/ticket')){
   const body=JSON.parse(opts.body);
   assert.deepEqual(body.scopes,['cat:read'],'C12 must NEVER ask for cat:write');
   assert.equal(body.room,room);
   return {ok:true,json:async()=>({ok:true,token:'fresh'+(++issued)+'.signed',expiresAt:Date.now()+30000})};
  }
  assert.equal(url,'https://friendly123-yparty-port2-canary-qa.jfcarpio.workers.dev/parties/tienda/'+room+'?frozen-proof=1');
  assert.equal(opts.method,'GET');
  assert.equal(opts.headers.authorization,'Bearer fresh1.signed');
  assert.equal(opts.headers['x-f123-license'],license);
  assert.equal(opts.headers['x-f123-instance'],instance);
  assert.equal(JSON.stringify(opts).includes('NEVER_TO_WORKER'),false);
  return {ok:true,json:async()=>({ok:true,room,channel:'cat',
   frozenHead:badProof?'wrong-head':head,stateSha256:sha,vectorSha256:sha})};
 };
 function createProvider({doc,room:providedRoom,params,readOnly}){
  assert.equal(providedRoom,room);
  assert.equal(readOnly,true);
  assert.notEqual(doc,local);
  assert.equal(doc.share.size,0,'READ-ONLY session must start with an EMPTY Y.Doc');
  const events=new Map();
  const obj={doc,events,closed:false,
   on(name,fn){if(!events.has(name))events.set(name,new Set());events.get(name).add(fn)},
   off(name,fn){events.get(name)?.delete(fn)},
   async connect(){
    const next=await params();tokens.push(next.cap);
    doc.getMap('productos').set('book-1',{id:'book-1',nombre:'Book',precio:mutateRemote?99:12,stockActual:2});
    doc.getMap('ubicaciones').set('shelf-1',{id:'shelf-1',nombre:'Shelf',activa:true});
    if(privateRemote)doc.getMap('_meta').set('pin','REMOTE_PRIVATE');
    for(const fn of events.get('synced')||[])fn(true);
   },
   destroy(){this.closed=true}
  };
  providers.push(obj);return obj;
 }
 return{local,requests,providers,tokens,send,createProvider,getCredentials,
  setPin:p=>{pin=p},isVisible:()=>!hidden,
  input(){return {privateDoc:local,Y,room,licenseCode:license,instanceId:instance,
   expectedFrozenHead:head,getCredentials,createProvider,fetch:send,
   isVisible:()=>!hidden,timeoutMs:1500};},
  close(){local.destroy()}
 };
}
test('C12 proof then fresh cat:read WS; EMPTY provider doc; no raw Sync3 Yjs; parity from remote',{timeout:5000},async()=>{
 const f=fixture();
 try{
  const session=await openCertifiedReadOnlyPublicCatalog(f.input());
  assert.equal(session.readOnly,true);assert.equal(session.frozenHead,head);
  assert.equal(f.requests.length,3,'one ticket, one proof GET and a DIFFERENT WS ticket');
  assert.deepEqual(f.tokens,['fresh2.signed']);
  assert.equal(f.providers.length,1);
  assert.equal(f.providers[0].doc.share.has('_meta'),false);
  assert.equal(f.providers[0].doc.share.has('ventas'),false);
  assert.equal(session.display().productos['book-1'].stockActual,2);
  session.close();session.close();
  assert.equal(f.providers[0].closed,true);
  assert.equal(session.display(),null);
  assert.equal(f.local.getMap('_meta').get('pin'),'NEVER_TO_WORKER');
 }finally{f.close();}
});
test('C12 invalid server HEAD never opens a socket or re-authors the frozen catalog',async()=>{
 const f=fixture({badProof:true});
 try{
  await assert.rejects(openCertifiedReadOnlyPublicCatalog(f.input()),/certified read-only catalog unavailable/);
  assert.equal(f.providers.length,0);
  assert.equal(f.requests.length,2);
 }finally{f.close();}
});
test('C12 even malicious private-root Yjs on server is not displayed; session torn down',async()=>{
 const f=fixture({privateRemote:true});
 try{
  await assert.rejects(openCertifiedReadOnlyPublicCatalog(f.input()));
  assert.equal(f.providers[0]?.closed,true);
  assert.equal(f.local.getMap('_meta').get('pin'),'NEVER_TO_WORKER');
 }finally{f.close();}
});
test('C12 parity mismatch never authorizes catalog switch or writes a delta',async()=>{
 const f=fixture({mutateRemote:true});
 try{
  await assert.rejects(openCertifiedReadOnlyPublicCatalog(f.input()));
  assert.equal(f.providers[0]?.closed,true);
 }finally{f.close();}
});
test('C12 suspended browser, invalid local doc, and wrong room fail BEFORE any token request',async()=>{
 for(const opt of [{hidden:true},{},{},{}]){
  const f=fixture(opt);
  try{
   const input=f.input();
   if(opt.hidden){}else if(f.requests.length===0){input.room='b'.repeat(32)+'-ops'}
   await assert.rejects(openCertifiedReadOnlyPublicCatalog(input));
   assert.equal(f.requests.length,0);
  }finally{f.close();}
 }
});
test('C12 cat read-only issuer scope cannot be requested for -ops or -priv',()=>{
 for(const suffix of ['-ops','-priv']){
  assert.throws(()=>createOwnerTicketParams({licenseCode:license,instanceId:instance,
   room:room.slice(0,32)+suffix,catalogReadOnly:true,
   getCredentials:()=>({kind:'owner',licenseCode:license,instanceId:instance,pin:'123'}),fetch:async()=>{}}));
 }
});
