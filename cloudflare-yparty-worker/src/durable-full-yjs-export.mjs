// P0 server-only full YParty SQL -> Yjs binary back-export (no Firebase transport).
// This module has no HTTP routes, role shortcuts or side effects. Invoke ONLY from
// an already authorised trusted server read barrier for the correct license/room.
// Follows the exact base + journal storage format of Tienda.onLoad() in index.js.
import * as Y from 'yjs';

const BLOCK=512*1024;
function refuse(reason){throw new Error('complete Yjs export refused: '+reason);}
function bytes(value){
  let result;
  if(value instanceof Uint8Array)result=value;
  else if(value instanceof ArrayBuffer)result=new Uint8Array(value);
  else if(ArrayBuffer.isView(value))result=new Uint8Array(value.buffer,value.byteOffset,value.byteLength);
  else refuse('unreadable SQL BLOB');
  return new Uint8Array(result); // clone inside the atomic read barrier
}
function need(cond,reason){if(!cond)refuse(reason);}
function rowNumber(v,label){
  const n=Number(v);
  need(Number.isSafeInteger(n)&&n>=0,label+' not a safe integer');
  return n;
}
function joinParts(rows,partKey,label){
  need(rows.length>0,label+' empty');
  const chunks=[];let total=0;
  for(let i=0;i<rows.length;i++){
    need(rowNumber(rows[i][partKey],label+' part')===i,label+' missing or out-of-order block');
    const b=bytes(rows[i].contenido);
    need(b.byteLength>0&&b.byteLength<=BLOCK,label+' corrupt chunk length');
    need(i===rows.length-1||b.byteLength===BLOCK,label+' truncated nonterminal chunk');
    total+=b.byteLength;
    need(Number.isSafeInteger(total),label+' impossible byte count');
    chunks.push(b);
  }
  const joined=new Uint8Array(total);let offset=0;
  for(const chunk of chunks){joined.set(chunk,offset);offset+=chunk.byteLength;}
  return joined;
}
function snapshotInsideBarrier(storage){
  const sql=storage.sql;
  const tables=new Set(sql.exec("SELECT name FROM sqlite_master WHERE type='table'").toArray().map(x=>x.name));
  const select=(name,stmt)=>tables.has(name)?sql.exec(stmt).toArray():[];
  // The YParty Worker may be on the first journal-only write or have an old
  // single-row snapshot; never choose a winner if both snapshot forms exist.
  const blocks=select('documento_bloques','SELECT n,contenido FROM documento_bloques ORDER BY n')
    .map(x=>({n:x.n,contenido:bytes(x.contenido)}));
  const legacy=select('documento','SELECT id,contenido FROM documento ORDER BY id')
    .map(x=>({id:x.id,contenido:bytes(x.contenido)}));
  const journal=select('diario','SELECT n,cambio FROM diario ORDER BY n')
    .map(x=>({n:x.n,cambio:bytes(x.cambio)}));
  const parts=select('diario_bloques','SELECT n,parte,contenido FROM diario_bloques ORDER BY n,parte')
    .map(x=>({n:x.n,parte:x.parte,contenido:bytes(x.contenido)}));
  return {blocks,legacy,journal,parts};
}
async function hexSha256(value){
  const hash=await crypto.subtle.digest('SHA-256',value);
  return Array.from(new Uint8Array(hash),b=>b.toString(16).padStart(2,'0')).join('');
}
function framesFrom(snapshot){
  const {blocks,legacy,journal,parts}=snapshot;
  need(!(blocks.length&&legacy.length),'conflicting legacy and blocked snapshots');
  need(legacy.length<=1&&(!legacy.length||rowNumber(legacy[0].id,'legacy id')===1),'conflicting legacy snapshot rows');
  const frames=[],journalParts=new Map(),liveJournal=new Map();
  if(blocks.length)frames.push(joinParts(blocks,'n','snapshot'));
  else if(legacy.length){
    need(legacy[0].contenido.byteLength>0,'empty legacy snapshot');
    frames.push(legacy[0].contenido);
  }
  for(const row of journal){
    const id=rowNumber(row.n,'journal id');
    need(id>0&&!liveJournal.has(id),'duplicate journal id');
    liveJournal.set(id,row);
  }
  for(const row of parts){
    const id=rowNumber(row.n,'journal chunk owner');
    const part=rowNumber(row.parte,'journal chunk part');
    const owner=liveJournal.get(id);
    need(owner,'orphan journal chunk');
    need(owner.cambio.byteLength===0,'ambiguous inline journal plus chunks');
    const list=journalParts.get(id)||[];
    list.push({parte:part,contenido:row.contenido});
    journalParts.set(id,list);
  }
  for(const [id,row] of liveJournal){
    if(row.cambio.byteLength>0){
      need(row.cambio.byteLength<=BLOCK,'oversized inline journal frame');
      need(!journalParts.has(id),'orphan chunks for inline journal');
      frames.push(row.cambio);
    }else{
      const list=journalParts.get(id)||[];
      need(list.length>0,'missing journal chunks');
      frames.push(joinParts(list,'parte','journal '+id));
    }
  }
  need(frames.length>0,'no snapshot nor journal');
  return {frames,journalCount:journal.length,snapshotKind:blocks.length?'blocks':legacy.length?'legacy':'none'};
}

export async function exportCompleteYpartyYjs({storage,channel}={}){
  need(storage?.sql&&typeof storage.sql.exec==='function'&&
       typeof storage.transactionSync==='function','trusted SQL transaction required');
  need(channel==='ops'||channel==='cat','explicit ops/cat channel required');
  // Crucial: snapshot and all journal rows copied within the same SQL transaction,
  // so concurrent onSave compaction cannot mix an old base with a new journal.
  const consistent=storage.transactionSync(()=>snapshotInsideBarrier(storage));
  const {frames,journalCount,snapshotKind}=framesFrom(consistent);
  const doc=new Y.Doc();
  try{
    for(const frame of frames)Y.applyUpdate(doc,frame,'complete-sql-export');
    // A syntactically valid update may have unresolved causal ancestors.
    // Never conceal missing sales by clearing Yjs pending structures/deletes.
    need(!doc.store.pendingStructs&&!doc.store.pendingDs,'pending Yjs ancestors or deletes');
    const state=Y.encodeStateAsUpdate(doc);
    const vector=Y.encodeStateVector(doc);
    const [sha256,vectorSha256]=await Promise.all([hexSha256(state),hexSha256(vector)]);
    const eventCount=channel==='ops'?doc.getMap('eventos').size:null;
    return Object.freeze({
      bytes:new Uint8Array(state),sha256,vectorSha256,eventCount,
      journalCount,snapshotKind,frameCount:frames.length
    });
  }finally{doc.destroy();}
}
