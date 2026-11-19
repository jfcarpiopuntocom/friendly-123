// C16b-S · durable browser IndexedDB adapter for C16a commercial same-DO outbox.
// Uses native IndexedDB transaction semantics (oncomplete is the ACK), and the
// existing reviewed C15 typed-command allowlist. NEVER stores PIN or bearer.
import {validateTypedCommercialCommand} from './port2-typed-ops-client.mjs';

const DEFAULT_DB='f123-port2-typed-ops-v1';
const TABLE='ops';
const LICENSE=/^F123-[A-Z0-9*~$=-]{8,34}$/;
const INSTANCE=/^[A-Za-z0-9_-]{6,120}$/;
const OPID=/^(?:customer-payment:)?[A-Za-z0-9_-]{8,96}$/;
const STATES=new Set(['prepared','pending','paused-auth-required','paused-retry-exhausted','quarantined']);
function unavailable(){return new Error('durable commercial outbox unavailable');}
function json(value){return JSON.stringify(value);}
function cleanEntry(raw,license){
 if(!raw||typeof raw!=='object'||Array.isArray(raw)||
    !OPID.test(raw.opId||'')||raw.sameDoLocked!==true||
    !STATES.has(raw.state)||!Number.isSafeInteger(raw.attempts)||raw.attempts<0||raw.attempts>10||
    !Number.isSafeInteger(raw.createdAt)||!Number.isSafeInteger(raw.updatedAt)||
    Object.keys(raw).sort().join(',')!=='attempts,command,createdAt,opId,sameDoLocked,state,updatedAt')
  throw unavailable();
 const proof=validateTypedCommercialCommand(raw.command);
 if(!proof.ok||proof.canonical.license!==license||proof.canonical.opId!==raw.opId)
  throw unavailable();
 return {
  opId:raw.opId,command:{...proof.canonical},sameDoLocked:true,
  attempts:raw.attempts,state:raw.state,createdAt:raw.createdAt,updatedAt:raw.updatedAt
 };
}
export function createDurableTypedOpsStore({
 licenseCode,instanceId,indexedDB:idb=globalThis.indexedDB,
 keyRange=globalThis.IDBKeyRange,dbName=DEFAULT_DB,openTimeoutMs=2500
}={}){
 if(!LICENSE.test(licenseCode||'')||!INSTANCE.test(instanceId||'')||
    typeof idb?.open!=='function'||typeof keyRange?.only!=='function'||
    typeof dbName!=='string'||!/^[A-Za-z0-9_-]{8,120}$/.test(dbName)||
    !Number.isSafeInteger(openTimeoutMs)||openTimeoutMs<100||openTimeoutMs>10000)
  throw unavailable();
 // Scope is a DB index; no PIN, customer details or token ever enters DB name.
 const scope=licenseCode+'|'+instanceId;
 let dbPromise=null,closed=false;
 function getDB(){
  if(closed)return Promise.reject(unavailable());
  if(dbPromise)return dbPromise;
  dbPromise=new Promise((resolve,reject)=>{
   let finished=false,request,timer;
   function settle(error,db){
    if(finished){try{db?.close()}catch(_){ }return;}
    finished=true;clearTimeout(timer);
    error?reject(unavailable()):resolve(db);
   }
   try{request=idb.open(dbName,1)}catch(_){settle(true);return;}
   timer=setTimeout(()=>{settle(true);dbPromise=null;},openTimeoutMs);
   request.onblocked=()=>{settle(true);dbPromise=null;};
   request.onerror=()=>{settle(true);dbPromise=null;};
   request.onupgradeneeded=()=>{
    try{
     const db=request.result;
     if(!db.objectStoreNames.contains(TABLE)){
      const store=db.createObjectStore(TABLE,{keyPath:'key'});
      store.createIndex('scope','scope',{unique:false});
     }else if(!request.transaction.objectStore(TABLE).indexNames.contains('scope')){
      request.transaction.objectStore(TABLE).createIndex('scope','scope',{unique:false});
     }
    }catch(_){try{request.transaction?.abort()}catch(__){}}
   };
   request.onsuccess=()=>{
    const db=request.result;
    if(finished||closed){try{db.close()}catch(_){}return;}
    db.onversionchange=()=>{db.close();dbPromise=null;};
    db.onclose=()=>{dbPromise=null;};
    settle(false,db);
   };
  }).catch(e=>{dbPromise=null;throw e;});
  return dbPromise;
 }
 async function transact(mode,run){
  const db=await getDB();
  if(closed)throw unavailable();
  return new Promise((resolve,reject)=>{
   let tx,done=false,value,error=null;
   const finish=(err,result)=>{
    if(done)return;done=true;
    err?reject(unavailable()):resolve(result);
   };
   try{
    tx=db.transaction(TABLE,mode);
    tx.oncomplete=()=>finish(false,value);
    tx.onabort=()=>finish(true);
    tx.onerror=()=>finish(true);
    const setValue=v=>{value=v};
    const setError=()=>{error=true;try{tx.abort()}catch(_){}};
    run(tx.objectStore(TABLE),setValue,setError);
   }catch(_){try{tx?.abort()}catch(__){}finish(true)}
  });
 }
 async function loadAll(){
  return transact('readonly',(store,result,abort)=>{
   const req=store.index('scope').getAll(keyRange.only(scope));
   req.onsuccess=()=>{
    try{
     const rows=req.result;
     if(!Array.isArray(rows))return abort();
     const normalized=rows.map(r=>{
      if(r.scope!==scope||r.key!==scope+'|'+r.entry?.opId)throw unavailable();
      return cleanEntry(r.entry,licenseCode);
     });
     normalized.sort((a,b)=>a.createdAt-b.createdAt||a.opId.localeCompare(b.opId));
     result(normalized);
    }catch(_){abort();}
   };
   req.onerror=abort;
  });
 }
 async function save(entry){
  const next=cleanEntry(entry,licenseCode),key=scope+'|'+next.opId;
  return transact('readwrite',(store,done,abort)=>{
   const req=store.get(key);
   req.onsuccess=()=>{
    try{
     const old=req.result;
     if(old){
      if(old.scope!==scope||old.key!==key)return abort();
      const before=cleanEntry(old.entry,licenseCode);
      // Changing the command for a durable opId is a permanent business
      // conflict, even if both requests have the same price or quantity.
      if(json(before.command)!==json(next.command))return abort();
      if(next.attempts<before.attempts)return abort();
     }
     store.put({key,scope,entry:next});
     done(true);
    }catch(_){abort();}
   };
   req.onerror=abort;
  });
 }
 async function remove(opId){
  if(!OPID.test(opId||''))throw unavailable();
  return transact('readwrite',(store,done)=>{
   store.delete(scope+'|'+opId);
   done(true);
  });
 }
 async function close(){
  closed=true;
  if(!dbPromise)return;
  try{(await dbPromise).close()}catch(_){}
  dbPromise=null;
 }
 return Object.freeze({loadAll,save,remove,close});
}
