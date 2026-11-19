// P0 Belén shelf-camera recovery: durable, immutable photo POINTER intents.
// No image bytes, PIN, client names or plaintext licenses ever live here.
// Caller supplies the SHA-256 namespace of OCTienda.licenciaActual().
const DB_NAME='f123_shelf_photo_intents_v1',STORE='intents';
const HASH=/^[a-f0-9]{64}$/;
function text(value,label,max=160){
 if(typeof value!=='string'||!value.length||value.length>max||value.trim()!==value||/[\u0000-\u001f\u007f]/.test(value))throw new TypeError('Invalid '+label);
 return value;
}
function validateIntent(raw){
 if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new TypeError('Invalid photo pointer intent');
 const opId=text(raw.opId,'opId');
 const photoHash=raw.photoHash;
 if(!HASH.test(photoHash||''))throw new TypeError('Invalid photo hash');
 if(!Object.prototype.hasOwnProperty.call(raw,'expectedFotoHash')||!Object.prototype.hasOwnProperty.call(raw,'expectedFotoRev'))throw new TypeError('Missing photo preimage');
 const expectedFotoHash=raw.expectedFotoHash;
 if(expectedFotoHash!==null&&!HASH.test(expectedFotoHash||''))throw new TypeError('Invalid expected photo hash');
 let expectedFotoRev=null;
 if(raw.expectedFotoRev!==null){
   const v=raw.expectedFotoRev;
   if(!v||typeof v!=='object'||Array.isArray(v)||!Number.isSafeInteger(v.c)||v.c<0)throw new TypeError('Invalid expected photo revision');
   expectedFotoRev={c:v.c,d:text(v.d,'device revision',160)};
 }
 return {opId,photoHash,expectedFotoHash,expectedFotoRev};
}
function clone(x){return x===undefined?null:JSON.parse(JSON.stringify(x));}
export function createShelfPhotoIntentStore({indexedDB,namespace}={}){
 if(!indexedDB||typeof indexedDB.open!=='function')throw new TypeError('IndexedDB is required for durable photo intents');
 if(!HASH.test(namespace||''))throw new TypeError('SHA-256 business namespace required');
 function key(shelfId){return JSON.stringify([namespace,text(shelfId,'shelf id')]);}
 function open(){
  return new Promise((resolve,reject)=>{
   let req,settled=false;
   const done=(err,db)=>{if(settled){if(db)db.close();return;}settled=true;clearTimeout(timer);if(err)reject(err);else resolve(db);};
   const timer=setTimeout(()=>done(new Error('Photo intent IndexedDB open timed out')),8000);
   try{req=indexedDB.open(DB_NAME,1);}catch(err){done(err);return;}
   req.onupgradeneeded=()=>{const db=req.result;
     if(!db.objectStoreNames.contains(STORE))db.createObjectStore(STORE,{keyPath:'key'});
   };
   req.onsuccess=()=>done(null,req.result);
   req.onerror=()=>done(req.error||new Error('Photo intent persistence unavailable'));
   req.onblocked=()=>done(new Error('Photo intent IndexedDB blocked'));
  });
 }
 async function transact(mode,run){
  const db=await open();
  try{return await new Promise((resolve,reject)=>{
   let tx,out=null,error=null;
   try{tx=db.transaction(STORE,mode);}catch(err){reject(err);return;}
   tx.oncomplete=()=>resolve(clone(out));
   tx.onabort=()=>reject(error||tx.error||new Error('Photo intent transaction aborted'));
   tx.onerror=()=>{}; // transactional onabort is the only rejection authority
   const fail=err=>{error=err;try{tx.abort();}catch(e){reject(err||e);}};
   try{run(tx.objectStore(STORE),v=>{out=v},fail);}catch(err){fail(err);}
  });}finally{db.close();}
 }
 const api={
  async get(shelfId){const k=key(shelfId);return transact('readonly',(store,done,fail)=>{
   const q=store.get(k);q.onsuccess=()=>done(q.result?q.result.value:null);q.onerror=()=>fail(q.error||new Error('Photo intent read failed'));
  });},
  async putIfAbsent(shelfId,raw){const k=key(shelfId),value=validateIntent(raw);
   return transact('readwrite',(store,done,fail)=>{
    const q=store.get(k);q.onerror=()=>fail(q.error||new Error('Photo intent read failed'));
    q.onsuccess=()=>{
      if(q.result){
        if(JSON.stringify(q.result.value)!==JSON.stringify(value)){fail(new Error('Photo intent conflict: original opId or photo changed'));return;}
        done({created:false,value:q.result.value});return;
      }
      const put=store.add({key:k,namespace,shelfId,value});
      put.onsuccess=()=>done({created:true,value});
      put.onerror=()=>fail(put.error||new Error('Photo intent write failed'));
    };
   });
  },
  async removeIfOp(shelfId,expectedOpId){const k=key(shelfId);text(expectedOpId,'expected opId');
   return transact('readwrite',(store,done,fail)=>{
    const q=store.get(k);q.onerror=()=>fail(q.error||new Error('Photo intent read failed'));
    q.onsuccess=()=>{
      if(!q.result){done(false);return;}
      if(q.result.value.opId!==expectedOpId){fail(new Error('Photo intent conflict: original opId differs'));return;}
      const del=store.delete(k);del.onsuccess=()=>done(true);del.onerror=()=>fail(del.error||new Error('Photo intent delete failed'));
    };
   });
  },
  async list(){return transact('readonly',(store,done,fail)=>{
   const q=store.getAll();q.onsuccess=()=>done((q.result||[]).filter(x=>x.namespace===namespace).map(x=>({shelfId:x.shelfId,value:x.value})));
   q.onerror=()=>fail(q.error||new Error('Photo intent list failed'));
  });}
 };
 return Object.freeze(api);
}
