// Gate D, SERVER-ONLY and dormant (flag WS_OPEN_EXISTING_QA, OFF by default).
// The YParty DO opens an existing shop's current Yjs history as-is (same state,
// SHA-anchored, zero pending parents) and keeps going forward. Any refusal leaves
// SQL untouched and the shop stays on the current Firebase path (failback).
// Future wiring: src/index.js Tienda.onStart, right before `await super.onStart();`.
import * as Y from 'yjs';
import {prepareFrozenImport,installFrozenImport} from './certified-frozen-import.mjs';
import {exportCompleteYpartyYjs} from './durable-full-yjs-export.mjs';

export async function openExistingStore({env,storage,source}={}) {
  if(env?.WS_OPEN_EXISTING_QA!=='1')return {opened:false,failback:'flag-off'};
  try {
    const sql=storage.sql;
    // Already opened: never re-import (the journal holds forward ops since then).
    // A certificate ROW is not a durable Yjs readback. Validate the whole
    // current snapshot+journal before acknowledging a cold reopen.
    const certifiedTable=sql.exec("SELECT 1 FROM sqlite_master WHERE type='table' AND name='f123_frozen_imports'").toArray().length>0;
    const prior=certifiedTable?sql.exec('SELECT channel,frozen_head,sha256,vector_sha256,event_count FROM f123_frozen_imports WHERE id=1').toArray()[0]:null;
    if(prior){
      if(!['cat','ops'].includes(prior.channel)||!/^[a-f0-9]{64}$/.test(prior.sha256||'')||
         !/^[a-f0-9]{64}$/.test(prior.vector_sha256||'')||
         !/^[A-Za-z0-9_.:-]{3,128}$/.test(prior.frozen_head||''))
        throw new Error('corrupt frozen import certificate');
      // The independently supplied frozen source remains authoritative for
      // its original HEAD. Forward ops may change live Yjs SHA legitimately.
      if(source&&(source.channel!==prior.channel||source.frozenHead!==prior.frozen_head||
         source.expectedStateSha256!==prior.sha256||
         source.expectedVectorSha256!==prior.vector_sha256||
         (prior.channel==='ops'&&source.expectedOpIds!==Number(prior.event_count))))
        throw new Error('frozen import certificate mismatch with independent source');
      const now=await exportCompleteYpartyYjs({storage,channel:prior.channel});
      if(prior.channel==='ops'&&(!Number.isSafeInteger(Number(prior.event_count))||
         now.eventCount<Number(prior.event_count)))
        throw new Error('frozen ops have disappeared after reopen');
      return {opened:true,already:true,verifiedSha256:now.sha256};
    }
    const {receipt}=await installFrozenImport({storage,proof:await prepareFrozenImport(source)});
    return {opened:true,already:false,receipt};
  } catch(e) {return {opened:false,failback:String(e?.message||e)};}
}

// Failback: only what the current path lacks (diff by its state vector), so
// applying it once or twice never duplicates history.
export async function failbackUpdate({storage,channel,legacyStateVector}={}) {
  const full=await exportCompleteYpartyYjs({storage,channel});
  const doc=new Y.Doc();
  try {
    Y.applyUpdate(doc,full.bytes);
    return {update:Y.encodeStateAsUpdate(doc,legacyStateVector),sha256:full.sha256,eventCount:full.eventCount};
  } finally {doc.destroy();}
}
