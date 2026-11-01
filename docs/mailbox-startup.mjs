// P0 experimental authenticated continuation for the EXISTING Yjs notebook.
// No automatic migration. Production remains unchanged unless a locally
// explicit diagnostic flag is set AND the central Owner PIN was verified.
import {browserMailboxStore,createMailboxYjs} from './mailbox-bridge.mjs';
const LAB='f123_mailbox_lab_20261031';
let running=null;
function signal(status,code){
  try{window.dispatchEvent(new CustomEvent('oc-mailbox-state',{detail:{status,code:code||null}}))}catch(_){}
}
const active=()=>!document.hidden&&(!window.OCTabSession||window.OCTabSession.canSync());
function identity(){
  const own=JSON.parse(localStorage.getItem('f123_owned')||'null')||{};
  const lic=String(own.licenseCode||'').trim().toUpperCase();
  const t=window.OCTienda&&window.OCTienda.licenciaActual&&
    String(window.OCTienda.licenciaActual()||'').trim().toUpperCase();
  if(!/^F123-[A-Z0-9*~$=-]{8,34}$/.test(lic)||lic!==t||!own.instanceId)
    throw Error('notebook-identity-not-recovered');
  let device=localStorage.getItem('f123_mailbox_device_v1');
  if(!/^[A-Za-z0-9_-]{12,120}$/.test(device||'')){
    device='mailbox_'+crypto.randomUUID().replace(/-/g,'');
    localStorage.setItem('f123_mailbox_device_v1',device);
    if(localStorage.getItem('f123_mailbox_device_v1')!==device)
      throw Error('device-identity-not-durable');
  }
  return {licenseCode:lic,deviceId:device};
}
function current(){
  const y=window.OCYjs;
  if(!y||y.estado!=='activo'||!y.doc||!y.opsDoc||!y.fotosDoc||
     !y.clave||!y.roomId||!/^[a-f0-9]{40}$/.test(y.roomId))
    throw Error('notebook-yjs-unavailable');
  if(!y.idb||!y.opsIdb||!y.fotosIdb)
    throw Error('notebook-journal-unavailable');
  return y;
}
async function ready(y){
  const waiters=[y.idb,y.opsIdb,y.fotosIdb].map(x=>{
    if(!x.whenSynced||typeof x.whenSynced.then!=='function')
      throw Error('notebook-journal-unavailable');
    return x.whenSynced;
  });
  // Never bootstrap a partial notebook merely because a wall clock expired.
  await Promise.race([
    Promise.all(waiters),
    new Promise((_,reject)=>setTimeout(()=>reject(Error('notebook-journal-loading')),8000))
  ]);
}
export async function ownerMailboxLogin(pin){
  if(localStorage.getItem(LAB)!=='1')return {enabled:false};
  if(!active())return {enabled:true,status:'paused'};
  if(running){running.stop();running=null}
  let client=null,stopped=false,timer=null,backoff=1600;
  const cleaners=[];
  try{
    const owner=identity(),y=current();
    await ready(y);
    if(window.OCTienda.licenciaActual().trim().toUpperCase()!==owner.licenseCode)
      throw Error('notebook-changed-during-login');
    // PIN stays in this stack frame for ONE Owner session request. No local
    // persistence, no log, no telemetry and no employee-token promotion.
    client=createMailboxYjs({...owner,roomId:y.roomId,key:y.clave,Y:window.Y,
      docs:{catalogo:y.doc,ops:y.opsDoc,fotos:y.fotosDoc},
      store:browserMailboxStore(y.roomId)});
    const session=await client.login(pin);
    const remote=await client.pull();
    if(!remote.complete)throw Error('causal-history-incomplete');
    // Decryption alone is not an application receipt. A received catalogue
    // must also be accepted by the EXISTING store and durable PIN/stock
    // guard before claiming readiness or seeding it back to other browsers.
    if(remote.cursor>0){
      if(!y._store||typeof y._store.aplicar!=='function'||
         typeof y.confirmarCatalogoDurable!=='function')
        throw Error('business-durability-proof-unavailable');
      y._store.aplicar();
      if(await y.confirmarCatalogoDurable()!==true)
        throw Error('business-durability-unconfirmed');
    }
    // Until the forensic comparison of PC and iPhone proves business history,
    // this canary must never push a stale stock epoch back to the mailbox.
    // Server must explicitly allow writes; even a modified browser flag cannot
    // bypass its Owner-scoped write gate.
    if(session.canWrite!==true){
      client.stop();
      signal('read-only','forensic-reconciliation-required');
      return {enabled:true,status:'read-only'};
    }
    // Pull first, then publish the fully hydrated local Yjs state. This
    // NEVER writes an inventory adjustment or selects stock by timestamp.
    await client.seed();
    await client.flush();
    signal('verified');
    function schedule(){
      if(stopped||!active()||timer)return;
      timer=setTimeout(async()=>{
        timer=null;
        if(stopped||!active())return;
        try{
          await client.flush();
          backoff=1600;signal('verified');
        }catch(_){
          signal('pending','send-retry');
          backoff=Math.min(120000,backoff*2);
          if(!stopped&&active())timer=setTimeout(()=>{timer=null;schedule()},backoff);
        }
      },backoff);
    }
    // Any update to a Y.Doc is durably queued by createMailboxYjs. This
    // merely schedules ONE bounded drain after local write activity.
    for(const doc of [y.doc,y.opsDoc,y.fotosDoc]){
      const watcher=(_,origin)=>{if(origin!=='red'&&origin!=='bc')schedule()};
      doc.on('update',watcher);
      cleaners.push(()=>doc.off('update',watcher));
    }
    const reconnected=()=>{
      if(stopped||!active())return;
      client.pull().then(result=>{
        if(result.complete)schedule();
        else signal('pending','causal-history-incomplete');
      }).catch(()=>signal('pending','recovery-needed'));
    };
    const loggedOut=()=>{stop()};
    window.addEventListener('online',reconnected);
    document.addEventListener('visibilitychange',reconnected);
    window.addEventListener('oc-logout',loggedOut,{once:true});
    cleaners.push(()=>window.removeEventListener('online',reconnected));
    cleaners.push(()=>document.removeEventListener('visibilitychange',reconnected));
    cleaners.push(()=>window.removeEventListener('oc-logout',loggedOut));
    function stop(){
      stopped=true;clearTimeout(timer);timer=null;
      cleaners.forEach(fn=>{try{fn()}catch(_){}});
      client.stop();
      if(running&&running.stop===stop)running=null;
      signal('stopped');
    }
    running={stop,client,roomId:y.roomId,licenseCode:owner.licenseCode};
    // No token, PIN or ciphertext is exposed through this diagnostic.
    window.OCMailboxP0={status:()=>client.state(),stop};
    return {enabled:true,status:'verified'};
  }catch(e){
    if(client)client.stop();
    signal('pending',String(e&&e.message||'mailbox-not-ready').replace(/[^a-z0-9-]/gi,'').slice(0,80));
    // Existing relay and offline notebook are left untouched. Never unlock
    // a customer based on a partially recovered mailbox.
    return {enabled:true,status:'pending'};
  }
}
