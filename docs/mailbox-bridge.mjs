// friendly-123 P0 — browser-side durable encrypted Yjs transport (experimental).
// Same three existing Y.Docs: catalogo, ops, fotos. NO second stock engine.
// Disabled unless an authenticated Owner explicitly starts it. The Worker
// stores only ciphertext; no PIN, license+PIN pair or business data in localStorage.
const ENDPOINT='https://friendly123-licencias.jfcarpio.workers.dev';
const CHANNELS=new Set(['catalogo','ops','fotos']);
const MAX_CHUNK=24576;
const textEncoder=new TextEncoder(),textDecoder=new TextDecoder();
function b64(bytes){
  let out='';
  for(let i=0;i<bytes.length;i+=8192)
    out+=String.fromCharCode(...bytes.subarray(i,i+8192));
  return btoa(out);
}
function unb64(value){
  if(typeof value!=='string'||value.length>200000||!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value))
    throw Error('invalid encrypted frame');
  return Uint8Array.from(atob(value),x=>x.charCodeAt(0));
}
const request=database=>new Promise((resolve,reject)=>{
  database.onsuccess=()=>resolve(database.result);
  database.onerror=()=>reject(database.error||Error('IndexedDB unavailable'));
});
function transaction(db,mode,stores,operation){
  return new Promise((resolve,reject)=>{
    const tx=db.transaction(stores,mode);
    let result;
    tx.oncomplete=()=>resolve(result);
    tx.onerror=()=>reject(tx.error||Error('mailbox journal write failed'));
    tx.onabort=()=>reject(tx.error||Error('mailbox journal transaction aborted'));
    try{result=operation(tx)}catch(err){tx.abort();reject(err)}
  });
}
export function browserMailboxStore(roomId){
  if(!/^[a-f0-9]{40}$/.test(roomId))throw Error('room identity required');
  if(typeof indexedDB==='undefined')throw Error('IndexedDB required');
  let open;
  const db=()=>{
    if(open)return open;
    open=new Promise((resolve,reject)=>{
      const r=indexedDB.open('f123-mailbox-journal-v1-'+roomId,1);
      r.onupgradeneeded=()=>{
        if(!r.result.objectStoreNames.contains('outbox'))r.result.createObjectStore('outbox',{keyPath:'eventId'});
        if(!r.result.objectStoreNames.contains('inbox'))r.result.createObjectStore('inbox',{keyPath:'sequence'});
        if(!r.result.objectStoreNames.contains('meta'))r.result.createObjectStore('meta');
      };
      r.onsuccess=()=>resolve(r.result);
      r.onerror=()=>reject(r.error||Error('mailbox journal open failed'));
      r.onblocked=()=>reject(Error('mailbox journal blocked'));
    });
    return open;
  };
  return {
    enqueue:async frame=>transaction(await db(),'readwrite',['outbox'],tx=>{tx.objectStore('outbox').put(frame)}),
    pending:async()=>request((await db()).transaction('outbox','readonly').objectStore('outbox').getAll()),
    sent:async id=>transaction(await db(),'readwrite',['outbox'],tx=>{tx.objectStore('outbox').delete(id)}),
    inbox:async()=>request((await db()).transaction('inbox','readonly').objectStore('inbox').getAll()),
    cursor:async()=>Number((await request((await db()).transaction('meta','readonly').objectStore('meta').get('cursor')))||0),
    // Encrypted frame and cursor are committed in ONE transaction. If Yjs
    // replay crashes later, the ciphertext remains available for rehydration.
    received:async(frame,cursor)=>transaction(await db(),'readwrite',['inbox','meta'],tx=>{
      tx.objectStore('inbox').put(frame);
      tx.objectStore('meta').put(cursor,'cursor');
    })
  };
}
export function createMailboxYjs({licenseCode,roomId,deviceId,key,Y,docs,store,fetchFn=fetch,
  cryptoApi=crypto,base=ENDPOINT}){
  if(!/^F123-[A-Z0-9*~$=-]{8,34}$/.test(licenseCode)||!/^[a-f0-9]{40}$/.test(roomId)||
     !/^[A-Za-z0-9_-]{12,120}$/.test(deviceId)||!store||!Y||!Y.applyUpdate||
     !docs||!Object.keys(docs).every(c=>CHANNELS.has(c))||Object.keys(docs).length!==3||
     !key||base!==ENDPOINT)
    throw Error('mailbox identity, crypto or channel mismatch');
  let token=null,expires=0,closed=false,queue=Promise.resolve(),busy=false;
  let processed=0,remoteComplete=false,replayed=false;
  const staged=new Map();
  const apiHeaders=()=>({'Authorization':'Bearer '+token});
  const authenticated=()=>token&&Date.now()+3000<expires;
  async function call(method,path,body){
    if(!authenticated())throw Error('mailbox session expired; Owner PIN required');
    const resp=await fetchFn(base+path,{method,cache:'no-store',credentials:'omit',redirect:'error',
      referrerPolicy:'no-referrer',headers:{...apiHeaders(),...(body?{'Content-Type':'application/json'}:{})},
      ...(body?{body:JSON.stringify(body)}:{})});
    if(!resp.ok)throw Error('mailbox request failed: '+resp.status);
    return resp.json();
  }
  async function login(pin){
    if(closed)throw Error('mailbox stopped');
    if(!/^[0-9]{3}$/.test(pin))throw Error('invalid PIN');
    const resp=await fetchFn(base+'/mailbox/session',{method:'POST',cache:'no-store',credentials:'omit',
      redirect:'error',referrerPolicy:'no-referrer',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({licenseCode,pin,deviceId})});
    if(!resp.ok)throw Error('Owner session unavailable: '+resp.status);
    const data=await resp.json();
    if(data.ok!==true||data.role!=='owner'||typeof data.token!=='string'||
       !Number.isSafeInteger(data.revision)||data.revision<1||
       !Number.isSafeInteger(data.expiresAt)||data.expiresAt<=Date.now())
      throw Error('Owner session not confirmed');
    token=data.token;expires=data.expiresAt;
    return {role:'owner',revision:data.revision};
  }
  function acceptFrame(frame){
    if(!frame||!CHANNELS.has(frame.channel)||frame.roomId!==roomId||
       typeof frame.group!=='string'||!/^[a-f0-9]{64}$/.test(frame.group)||
       !Number.isInteger(frame.part)||!Number.isInteger(frame.total)||
       frame.part<0||frame.total<1||frame.total>2048||frame.part>=frame.total)
      throw Error('cross-room or invalid Yjs frame');
    const bytes=unb64(frame.payload);
    if(bytes.length>MAX_CHUNK)throw Error('oversize Yjs chunk');
    let group=staged.get(frame.group);
    if(!group){group={channel:frame.channel,total:frame.total,parts:new Map()};staged.set(frame.group,group)}
    if(group.channel!==frame.channel||group.total!==frame.total)throw Error('conflicting Yjs group');
    const old=group.parts.get(frame.part);
    if(old&&b64(old)!==frame.payload)throw Error('conflicting Yjs fragment');
    group.parts.set(frame.part,bytes);
    if(group.parts.size!==group.total)return false;
    const result=new Uint8Array([...group.parts.values()].reduce((sum,v)=>sum+v.length,0));
    let pos=0;
    for(let i=0;i<group.total;i++){
      const chunk=group.parts.get(i);if(!chunk)throw Error('missing Yjs chunk');
      result.set(chunk,pos);pos+=chunk.length;
    }
    Y.applyUpdate(docs[group.channel],result,'red');
    staged.delete(frame.group);
    processed++;
    return true;
  }
  async function decode(envelope){
    const iv=unb64(envelope.nonce),cipher=unb64(envelope.ciphertext);
    if(iv.length!==12||cipher.length<16)throw Error('invalid ciphertext');
    const clear=await cryptoApi.subtle.decrypt({name:'AES-GCM',iv},key,cipher);
    return JSON.parse(textDecoder.decode(clear));
  }
  async function replay(){
    if(replayed)return;
    const inbox=await store.inbox();
    for(const item of inbox.sort((a,b)=>a.sequence-b.sequence)){
      if(closed)return;
      acceptFrame(await decode(item));
    }
    replayed=true;
  }
  async function pull(){
    if(!authenticated())throw Error('Owner session required');
    // Replaying local ciphertext is mandatory before consuming new remote
    // cursors; failure leaves all originals untouched.
    await replay();
    let cursor=await store.cursor();
    for(let page=0;page<200;page++){
      if(closed)return {complete:false,reason:'closed'};
      const result=await call('GET','/mailbox/events?after='+cursor+'&limit=50');
      if(result.ok!==true||!Array.isArray(result.events)||!Number.isSafeInteger(result.cursor)||
         result.cursor<cursor)throw Error('bad remote mailbox page');
      for(const item of result.events){
        if(!Number.isSafeInteger(item.sequence)||item.sequence<=cursor||
           item.sequence!==cursor+1)throw Error('mailbox gap');
        const frame=await decode(item); // fail before durable cursor advance
        if(frame.roomId!==roomId||!CHANNELS.has(frame.channel))throw Error('cross-room ciphertext');
        await store.received(item,item.sequence); // ciphertext + cursor atomic
        acceptFrame(frame);
        cursor=item.sequence;
      }
      if(!result.hasMore){
        if(result.latest!==cursor)throw Error('unconfirmed mailbox tail');
        remoteComplete=staged.size===0&&Object.values(docs).every(doc=>!(
          doc.store&&(doc.store.pendingStructs||doc.store.pendingDs)));
        return {complete:remoteComplete,cursor,updates:processed,
          reason:remoteComplete?'':'causal-fragments-pending'};
      }
      if(!result.events.length)throw Error('empty mailbox page with more=true');
    }
    return {complete:false,cursor,reason:'pagination-budget-exhausted'};
  }
  async function queueUpdate(channel,bytes){
    if(closed)return;
    if(!CHANNELS.has(channel))throw Error('unknown channel');
    const data=bytes instanceof Uint8Array?bytes:new Uint8Array(bytes);
    const hashInput=new Uint8Array(textEncoder.encode(channel).length+1+data.length);
    hashInput.set(textEncoder.encode(channel));hashInput[textEncoder.encode(channel).length]=0;
    hashInput.set(data,textEncoder.encode(channel).length+1);
    const hash=new Uint8Array(await cryptoApi.subtle.digest('SHA-256',hashInput));
    const group=Array.from(hash,x=>x.toString(16).padStart(2,'0')).join('');
    const total=Math.max(1,Math.ceil(data.byteLength/MAX_CHUNK));
    if(total>2048)throw Error('Yjs update too large');
    for(let i=0;i<total;i++){
      const frame={roomId,channel,group,part:i,total,
        payload:b64(data.subarray(i*MAX_CHUNK,(i+1)*MAX_CHUNK))};
      const iv=cryptoApi.getRandomValues(new Uint8Array(12));
      const cipher=await cryptoApi.subtle.encrypt({name:'AES-GCM',iv},key,
        textEncoder.encode(JSON.stringify(frame)));
      const entry={eventId:'mail-'+cryptoApi.randomUUID(),
        nonce:b64(iv),ciphertext:b64(new Uint8Array(cipher))};
      // Append to the local disk BEFORE any network operation.
      await store.enqueue(entry);
    }
  }
  function record(channel,update,origin){
    if(origin==='red'||origin==='bc'||closed)return;
    queue=queue.then(()=>queueUpdate(channel,update));
    // Propagate durable write failure; never claim an ACK for RAM-only updates.
    queue=queue.catch(err=>{lastError=String(err.message||err);throw err});
    queue.catch(()=>{});
  }
  let lastError=null;
  const subscriptions=[];
  function subscribe(){
    for(const [channel,doc] of Object.entries(docs)){
      const fn=(update,origin)=>record(channel,update,origin);
      doc.on('update',fn);subscriptions.push([doc,fn]);
    }
  }
  async function flush(){
    if(busy)return {ok:false,reason:'busy'};
    if(!authenticated())throw Error('Owner session required');
    busy=true;
    try{
      await queue; // all local Yjs writes must have a durable outgoing copy
      const pending=await store.pending();
      let sent=0;
      for(const item of pending){
        const ack=await call('POST','/mailbox/events',item);
        if(ack.ok!==true||!Number.isSafeInteger(ack.sequence))throw Error('unconfirmed ciphertext');
        await store.sent(item.eventId);sent++;
      }
      return {ok:true,sent};
    }finally{busy=false}
  }
  async function seed(){
    // Explicit bootstrap after all three local IndexedDB docs finished
    // hydration. Never submit a guessed stock count or an uncommitted sale.
    for(const [channel,doc] of Object.entries(docs)){
      if(doc.store&&(doc.store.pendingStructs||doc.store.pendingDs))
        throw Error('incomplete causal history');
      await queueUpdate(channel,Y.encodeStateAsUpdate(doc));
    }
  }
  function stop(){
    closed=true;token=null;expires=0;
    for(const [doc,fn] of subscriptions)doc.off('update',fn);
  }
  subscribe();
  return {login,pull,flush,seed,stop,replay,state:()=>({
    authenticated:!!authenticated(),remoteComplete,processed,
    pendingGroups:staged.size,lastError
  })};
}
