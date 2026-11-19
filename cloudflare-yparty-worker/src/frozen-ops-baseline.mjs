// C14 · imported -ops immutable business baseline, anchored to Gate D frozen
// SHA in the SAME SQLite transaction. Shared with occupied-room union policy:
// original opIds AND their payloads must survive every cold reopen unchanged.
import * as Y from 'yjs';
import {Sha256Sync} from './sha256-sync.mjs';

const MAX_EVENTS=25000,MAX_EVENT=256*1024,MAX_TOTAL=16*1024*1024,MAX_DEPTH=16;
const SHA=/^[0-9a-f]{64}$/;
function refuse(message){throw new Error('frozen ops baseline refused: '+message);}
function canonical(value,depth=0){
 if(depth>MAX_DEPTH)refuse('event nested too deeply');
 if(value===null||typeof value==='string'||typeof value==='boolean')return JSON.stringify(value);
 if(typeof value==='number'){
  if(!Number.isSafeInteger(value))refuse('unsafe economic amount');
  return JSON.stringify(value);
 }
 if(Array.isArray(value))return '['+value.map(v=>canonical(v,depth+1)).join(',')+']';
 if(value&&typeof value==='object'&&Object.getPrototypeOf(value)===Object.prototype){
  return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k],depth+1)).join(',')+'}';
 }
 refuse('unsupported economic payload type');
}
function digest(rows){
 const h=new Sha256Sync();
 for(const [opid,payload] of rows){
  h.update(opid);h.update('\0');h.update(payload);h.update('\n');
 }
 return h.hex();
}
function capture(doc){
 if(!doc||doc.store.pendingStructs||doc.store.pendingDs)refuse('pending history');
 const roots=[...doc.share.keys()];
 if(roots.some(k=>k!=='eventos'))refuse('private or mixed roots');
 if(!doc.share.has('eventos'))refuse('missing event map');
 const events=doc.getMap('eventos');
 if(events.size>MAX_EVENTS)refuse('too many events');
 const entries=[];let used=0;
 for(const [id,event] of events){
  if(typeof id!=='string'||id.length<1||id.length>160)refuse('invalid opId');
  const payload=canonical(event);
  used+=id.length+payload.length;
  if(payload.length>MAX_EVENT||used>MAX_TOTAL)refuse('event payload budget exceeded');
  entries.push([id,payload]);
 }
 entries.sort(([a],[b])=>a<b?-1:a>b?1:0);
 return Object.freeze({rows:entries,digest:digest(entries),count:entries.length});
}
export function prepareImportedOpsBaseline(doc){return capture(doc);}
export function installImportedOpsBaseline(sql,baseline){
 if(!baseline||!Array.isArray(baseline.rows)||!SHA.test(baseline.digest||'')||
    !Number.isSafeInteger(baseline.count)||baseline.rows.length!==baseline.count)
  refuse('uncertified baseline');
 sql.exec('CREATE TABLE IF NOT EXISTS f123_frozen_import_event_baseline (opid TEXT PRIMARY KEY, payload TEXT NOT NULL)');
 sql.exec('CREATE TABLE IF NOT EXISTS f123_frozen_import_baseline_cert (id INTEGER PRIMARY KEY CHECK(id=1), event_count INTEGER NOT NULL, events_sha256 TEXT NOT NULL)');
 const n=Number(sql.exec('SELECT COUNT(*) AS n FROM f123_frozen_import_event_baseline').one().n);
 if(n!==0||sql.exec('SELECT id FROM f123_frozen_import_baseline_cert WHERE id=1').toArray().length)
  refuse('baseline already installed');
 for(const [opid,payload] of baseline.rows)
  sql.exec('INSERT INTO f123_frozen_import_event_baseline(opid,payload) VALUES (?,?)',opid,payload);
 sql.exec('INSERT INTO f123_frozen_import_baseline_cert(id,event_count,events_sha256) VALUES (1,?,?)',
  baseline.count,baseline.digest);
}
export function verifyImportedOpsBaseline({storage,bytes,expectedCount}={}){
 if(!storage?.sql?.exec||!(bytes instanceof Uint8Array)||
    !Number.isSafeInteger(expectedCount)||expectedCount<0)refuse('invalid readback');
 const sql=storage.sql, names=new Set(sql.exec("SELECT name FROM sqlite_master WHERE type='table'").toArray().map(r=>r.name));
 if(!names.has('f123_frozen_import_event_baseline')||
    !names.has('f123_frozen_import_baseline_cert'))refuse('missing immutable baseline');
 const cert=sql.exec('SELECT event_count,events_sha256 FROM f123_frozen_import_baseline_cert WHERE id=1').toArray()[0];
 if(!cert||cert.event_count!==expectedCount||!SHA.test(cert.events_sha256||''))
  refuse('invalid baseline certificate');
 const rows=sql.exec('SELECT opid,payload FROM f123_frozen_import_event_baseline ORDER BY opid').toArray();
 if(rows.length!==expectedCount)refuse('missing historical opId');
 // SQL BINARY UTF-8 order need not match JS UTF-16 order for exotic opIds;
 // use the same canonical comparison as the original frozen Yjs capture.
 const stored=rows.map(r=>[r.opid,r.payload]).sort(([a],[b])=>a<b?-1:a>b?1:0);
 if(digest(stored)!==cert.events_sha256)refuse('historical event baseline digest mismatch');
 const doc=new Y.Doc();
 try {
  Y.applyUpdate(doc,bytes);
  if(doc.store.pendingStructs||doc.store.pendingDs)refuse('pending historical parents');
  if([...doc.share.keys()].some(root=>root!=='eventos'))refuse('unexpected economic root');
  const events=doc.getMap('eventos');
  if(events.size<expectedCount)refuse('historical event loss');
  // Only the original frozen facts belong to this certificate. New, valid
  // post-cut opIds must not trip the initial 25k-entry capture budget months
  // later; the typed ledger performs their own business validation.
  for(const [opid,payload] of stored){
   if(!events.has(opid)||canonical(events.get(opid))!==payload)
    refuse('historical opId/payload mismatch');
  }
  return Object.freeze({verified:true,originalEvents:expectedCount,currentEvents:events.size,
   baselineDigest:cert.events_sha256});
 }finally{doc.destroy();}
}
