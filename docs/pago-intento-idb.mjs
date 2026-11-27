// P0 idiomARTE · Belén Safari credit payment intent journal (QA-only source).
// Atomic IndexedDB receipt references, NOT a payment executor or ACK authority.
// Caller supplies SHA-256 namespace for the active business; never a raw PIN.
const DB_NAME='f123_payment_intents_v1';
const STORE='intents';
function ensureText(value,label,max=160) {
  if(typeof value!=='string'||!value.length||value.length>max||
     value.trim()!==value||/[\u0000-\u001f\u007f]/.test(value))
    throw new TypeError('Invalid '+label);
  return value;
}
function safeValue(value){
  if(!value||typeof value!=='object'||Array.isArray(value))
    throw new TypeError('Invalid payment intent');
  ensureText(value.opId,'opId');
  const encoded=JSON.stringify(value);
  if(!encoded||new TextEncoder().encode(encoded).byteLength>128*1024)
    throw new TypeError('Invalid payment intent size');
  const clone=JSON.parse(encoded);
  if(clone.opId!==value.opId) throw new TypeError('Invalid opId');
  return clone;
}
function clone(value){return value==null?null:JSON.parse(JSON.stringify(value));}
export function createPaymentIntentStore({indexedDB,namespace}={}){
  if(!indexedDB||typeof indexedDB.open!=='function')
    throw new TypeError('IndexedDB is required for durable intents');
  if(!/^[a-f0-9]{64}$/.test(namespace||''))
    throw new TypeError('SHA-256 business namespace required');
  function key({kind,clientId}){
    if(!['payment','allocation'].includes(kind))throw new TypeError('Invalid intent kind');
    return JSON.stringify([namespace,ensureText(clientId,'clientId') ,kind]);
  }
  function open(){
    return new Promise((resolve,reject)=>{
      let req;
      try{req=indexedDB.open(DB_NAME,1);}catch(error){reject(error);return;}
      req.onupgradeneeded=()=>{
        if(!req.result.objectStoreNames.contains(STORE))
          req.result.createObjectStore(STORE,{keyPath:'key'});
      };
      req.onsuccess=()=>resolve(req.result);
      req.onerror=()=>reject(req.error||new Error('Payment intent persistence unavailable'));
      req.onblocked=()=>reject(new Error('Payment intent IndexedDB blocked'));
    });
  }
  async function transact(mode,run){
    const db=await open();
    try{
      return await new Promise((resolve,reject)=>{
        let tx,output=null,failure=null;
        try{tx=db.transaction(STORE,mode);}catch(error){reject(error);return;}
        tx.oncomplete=()=>resolve(clone(output));
        tx.onabort=()=>reject(failure||tx.error||new Error('Payment intent transaction aborted'));
        tx.onerror=()=>{}; // abort is canonical failure signal; never return false success
        try{
          const store=tx.objectStore(STORE);
          run(store,result=>{output=result},err=>{
            failure=err;
            try{tx.abort();}catch(error){reject(error);}
          });
        }catch(error){
          failure=error;try{tx.abort();}catch(_){reject(error);}
        }
      });
    }finally{db.close();}
  }
  // A separate generation record preserves the existing intent schema so old
  // readers can still see a missing intent after an acknowledged payment.
  function generationKey(k){return k+':generation';}
  function generationOf(row){
    if(!row)return 0;
    if(!Number.isSafeInteger(row.generation)||row.generation<0)
      throw new Error('Invalid payment intent generation');
    return row.generation;
  }
  const api={
    async observe(params){
      const k=key(params);
      return transact('readonly',(store,result,fail)=>{
        const req=store.get(k);
        req.onsuccess=()=>{
          const gen=store.get(generationKey(k));
          gen.onsuccess=()=>{
            try{result({value:req.result?req.result.value:null,generation:generationOf(gen.result)});}
            catch(error){fail(error);}
          };
          gen.onerror=()=>fail(gen.error||new Error('Payment generation read failed'));
        };
        req.onerror=()=>fail(req.error||new Error('Payment intent read failed'));
      });
    },
    async get(params){
      const k=key(params);
      return transact('readonly',(store,result,fail)=>{
        const req=store.get(k);
        req.onsuccess=()=>result(req.result?req.result.value:null);
        req.onerror=()=>fail(req.error||new Error('Payment intent read failed'));
      });
    },
    async putIfAbsent(params){
      const k=key(params),value=safeValue(params.value);
      return transact('readwrite',(store,result,fail)=>{
        const req=store.get(k);
        req.onsuccess=()=>{
          const existing=req.result;
          if(existing){
            if(existing.value.opId!==value.opId||
                JSON.stringify(existing.value)!==JSON.stringify(value)){
              fail(new Error('Payment intent conflict: original opId must be resumed'));return;
            }
            result({created:false,value:existing.value});return;
          }
          const gen=store.get(generationKey(k));
          gen.onsuccess=()=>{
            try{
              if(params.expectedGeneration!==undefined&&generationOf(gen.result)!==params.expectedGeneration){
                fail(new Error('Payment intent conflict: earlier intent was already confirmed; review original receipt'));return;
              }
              const put=store.add({key:k,value});
              put.onsuccess=()=>result({created:true,value});
              put.onerror=()=>fail(put.error||new Error('Payment intent write failed'));
            }catch(error){fail(error);}
          };
          gen.onerror=()=>fail(gen.error||new Error('Payment generation read failed'));
        };
        req.onerror=()=>fail(req.error||new Error('Payment intent read failed'));
      });
    },
    async replaceIfOp(params){
      const k=key(params),value=safeValue(params.value);
      ensureText(params.expectedOpId,'expected opId');
      if(value.opId!==params.expectedOpId)
        throw new Error('Payment intent conflict: wrong original opId');
      return transact('readwrite',(store,result,fail)=>{
        const req=store.get(k);
        req.onsuccess=()=>{
          if(!req.result){result({updated:false,value:null});return;}
          if(req.result.value.opId!==params.expectedOpId){
            fail(new Error('Payment intent conflict: original opId differs'));return;
          }
          // A receipt is monotonic: a stale tab must not erase or change a
          // business-confirmed abonoId, nor silently mutate its allocation.
          const previous=req.result.value;
          const invariant=(x)=>JSON.stringify(Object.fromEntries(
            Object.entries(x).filter(([k])=>k!=='abonoId')));
          if(invariant(previous)!==invariant(value) ||
             (previous.abonoId && previous.abonoId!==value.abonoId)){
            fail(new Error('Payment intent conflict: receipt or allocation changed'));return;
          }
          const put=store.put({key:k,value});
          put.onsuccess=()=>result({updated:true,value});
          put.onerror=()=>fail(put.error||new Error('Payment intent update failed'));
        };
        req.onerror=()=>fail(req.error||new Error('Payment intent read failed'));
      });
    },
    async removeIfOp(params){
      const k=key(params);
      ensureText(params.expectedOpId,'expected opId');
      return transact('readwrite',(store,result,fail)=>{
        const req=store.get(k);
        req.onsuccess=()=>{
          if(!req.result){result(false);return;}
          if(req.result.value.opId!==params.expectedOpId){
            fail(new Error('Payment intent conflict: cannot delete newer opId'));return;
          }
          const gen=store.get(generationKey(k));
          gen.onsuccess=()=>{
            try{
              const generation=generationOf(gen.result)+1;
              if(!Number.isSafeInteger(generation))throw new Error('Payment generation overflow');
              const mark=store.put({key:generationKey(k),generation});
              mark.onsuccess=()=>{
                const del=store.delete(k);
                del.onsuccess=()=>result(true);
                del.onerror=()=>fail(del.error||new Error('Payment intent delete failed'));
              };
              mark.onerror=()=>fail(mark.error||new Error('Payment generation write failed'));
            }catch(error){fail(error);}
          };
          gen.onerror=()=>fail(gen.error||new Error('Payment generation read failed'));
        };
        req.onerror=()=>fail(req.error||new Error('Payment intent read failed'));
      });
    }
  };
  return Object.freeze(api);
}
