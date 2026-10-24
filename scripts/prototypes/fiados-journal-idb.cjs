'use strict';
// P0 research, NOT loaded by the public application. NO personal/customer data
// leaves the browser; absolutely no auto-cleanup of localStorage, photos or ledgers.
// Future integration requires Safari/WebKit proof and a distinct release approval.
function copy(v){return JSON.parse(JSON.stringify(v));}
function fail(code){const e=new Error(code);e.code=code;throw e;}
function validIntent(v){
 if(!v||typeof v!=='object'||typeof v.opId!=='string'||!v.opId.trim()||v.opId.length>160)fail('INVALID_INTENT');
 if(!Number.isSafeInteger(Math.round(Number(v.monto)*100))||Number(v.monto)<=0)fail('INVALID_AMOUNT');
 if(v.paymentOpId!==undefined&&(!String(v.paymentOpId)||String(v.paymentOpId).length>160))fail('INVALID_PAYMENT_REFERENCE');
 if(v.partes!==undefined&&!Array.isArray(v.partes))fail('INVALID_PARTS');
 return copy(v);
}
function sameIdentity(a,b){
 return !!a&&!!b&&String(a.opId)===String(b.opId)&&
   Number(a.monto)===Number(b.monto)&&String(a.motivo||'')===String(b.motivo||'')&&
   String(a.paymentOpId||'')===String(b.paymentOpId||'')&&
   JSON.stringify(a.partes||[])===JSON.stringify(b.partes||[]);
}
function createJournal({driver,localStorage,room,verifiedLegacyRoom=false}){
 if(!room||typeof room!=='string')fail('ROOM_REQUIRED');
 if(!driver||typeof driver.get!=='function'||typeof driver.cas!=='function')fail('DURABLE_DRIVER_REQUIRED');
 const scoped=k=>{
   if(typeof k!=='string'||!/^f123_customer_(payment|allocation)_intent_v1:/.test(k))fail('INVALID_KEY');
   return JSON.stringify([room,k]);
 };
 function legacy(k){
   if(!localStorage)return null;
   let raw;
   try{raw=localStorage.getItem(k);}catch(_){fail('LEGACY_UNREADABLE');}
   if(raw==null)return null;
   let parsed;
   try{parsed=validIntent(JSON.parse(raw));}catch(_){fail('LEGACY_INVALID_REVIEW_REQUIRED');}
   return parsed;
 }
 async function read(k){
   const local=legacy(k),current=await driver.get(scoped(k));
   if(current&&(!current.intent||!Number.isSafeInteger(current.rev)||current.rev<1))fail('JOURNAL_CORRUPT');
   if(current&&local&&!sameIdentity(current.intent,local))fail('DIVERGENT_INTENTS_REVIEW_REQUIRED');
   // Old localStorage keys have no license-room proof: never adopt an intent
   // across two stores sharing a browser origin without external verification.
   if(local&&!current&&!verifiedLegacyRoom)fail('LEGACY_ROOM_UNVERIFIED');
   return current?copy(current):local?{rev:0,state:'legacy',intent:local}:null;
 }
 // CAS is atomic within one IDB transaction, not a JS read-modify-write loop.
 async function begin(k,proposed){
   let intent=validIntent(proposed),old=await read(k);
   if(old&&old.state==='completed')fail('PAYMENT_ALREADY_COMPLETED');
   if(old&&!sameIdentity(old.intent,intent))fail('PENDING_PAYMENT_REVIEW_REQUIRED');
   if(old&&old.rev>0)return old;
   if(old)intent=copy(old.intent); // adopt original opId instead of generating a new one
   let candidate={rev:1,state:'pending',intent};
   const written=await driver.cas(scoped(k),0,candidate);
   if(!written){
     const concurrent=await read(k);
     if(concurrent&&concurrent.state!=='completed'&&sameIdentity(concurrent.intent,intent))return concurrent;
     fail('CONCURRENT_PAYMENT_REVIEW_REQUIRED');
   }
   const verify=await read(k);
   if(!verify||verify.rev!==1||verify.state!=='pending'||!sameIdentity(verify.intent,intent))fail('DURABLE_READBACK_FAILED');
   return verify;
 }
 async function receipt(k,opId,receiptId){
   if(!receiptId||typeof receiptId!=='string')fail('INVALID_RECEIPT');
   const old=await read(k);
   if(!old||old.rev===0||String(old.intent.opId)!==String(opId)||old.state==='completed')fail('RECEIPT_NOT_LINKED');
   if(old.intent.abonoId){
     if(old.intent.abonoId===receiptId)return old;
     fail('DIFFERENT_RECEIPT_REVIEW_REQUIRED');
   }
   const next=copy(old);next.rev++;next.intent.abonoId=receiptId;next.state='receipt-confirmed';
   if(!await driver.cas(scoped(k),old.rev,next))fail('CONCURRENT_PAYMENT_REVIEW_REQUIRED');
   const stored=await read(k);
   if(!stored||stored.intent.abonoId!==receiptId||stored.rev!==next.rev)fail('DURABLE_READBACK_FAILED');
   return stored;
 }
 async function complete(k,opId){
   const old=await read(k);
   if(!old||old.rev===0||String(old.intent.opId)!==String(opId))fail('COMPLETION_NOT_LINKED');
   if(old.state==='completed')return old;
   const next={rev:old.rev+1,state:'completed',intent:copy(old.intent)};
   if(!await driver.cas(scoped(k),old.rev,next))fail('CONCURRENT_PAYMENT_REVIEW_REQUIRED');
   const stored=await read(k);
   if(!stored||stored.state!=='completed')fail('DURABLE_READBACK_FAILED');
   // Durable tombstone prevents a stale legacy LS key resurrecting a paid intent.
   // We deliberately do not delete any historical storage or financial facts.
   return stored;
 }
 return {read,begin,receipt,complete};
}
// IndexedDB adapter: each cas is in ONE readwrite transaction, acknowledging only
// on transaction complete. IndexedDB names are prefixed by aislamiento.js at runtime.
function createIDBDriver(indexedDB){
 if(!indexedDB||typeof indexedDB.open!=='function')fail('IDB_UNAVAILABLE');
 let openPromise=null;
 function open(){
   if(openPromise)return openPromise;
   openPromise=new Promise((resolve,reject)=>{
     const q=indexedDB.open('f123_fiados_intent_journal',1);
     q.onupgradeneeded=()=>{if(!q.result.objectStoreNames.contains('intents'))q.result.createObjectStore('intents');};
     q.onsuccess=()=>resolve(q.result);
     q.onerror=()=>reject(q.error||new Error('IDB_OPEN_ERROR'));
     q.onblocked=()=>reject(new Error('IDB_BLOCKED'));
   }).catch(e=>{openPromise=null;throw e;});
   return openPromise;
 }
 async function get(key){
   const db=await open();
   return new Promise((resolve,reject)=>{
     const tx=db.transaction('intents','readonly');
     const req=tx.objectStore('intents').get(key);
     let answer=null;
     req.onsuccess=()=>{answer=req.result===undefined?null:copy(req.result);};
     tx.oncomplete=()=>resolve(answer);
     tx.onerror=()=>reject(tx.error||new Error('IDB_READ_ERROR'));
     tx.onabort=()=>reject(tx.error||new Error('IDB_READ_ABORTED'));
   });
 }
 async function cas(key,expectedRev,next){
   const db=await open();
   return new Promise((resolve,reject)=>{
     const tx=db.transaction('intents','readwrite'),st=tx.objectStore('intents');
     const r=st.get(key);let matched=false;
     r.onsuccess=()=>{
       const current=r.result||null;
       const rev=current?current.rev:0;
       if(rev!==expectedRev)return;
       matched=true;
       st.put(copy(next),key);
     };
     tx.oncomplete=()=>resolve(matched);
     tx.onerror=()=>reject(tx.error||new Error('IDB_WRITE_ERROR'));
     tx.onabort=()=>reject(tx.error||new Error('IDB_WRITE_ABORTED'));
   });
 }
 return {get,cas};
}
module.exports={createJournal,createIDBDriver,sameIdentity};
