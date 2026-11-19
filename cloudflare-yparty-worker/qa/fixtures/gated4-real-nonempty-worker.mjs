// QA-only subclass seeds a nonempty journal BEFORE REAL Tienda.onStart.
// All merge, persistence, history proof and cold-reopen code is inherited.
import worker,{Tienda as RealTienda} from '../../src/index.js';
import {getServerByName} from 'partyserver';
import {exportCompleteYpartyYjs} from '../../src/durable-full-yjs-export.mjs';
import * as Y from 'yjs';

export class Tienda extends RealTienda {
 async onStart() {
  if(this.name.endsWith('-ops')){
   const sql=this.ctx.storage.sql;
   sql.exec('CREATE TABLE IF NOT EXISTS diario (n INTEGER PRIMARY KEY AUTOINCREMENT,cambio BLOB)');
   const existing=Number(sql.exec('SELECT COUNT(*) AS n FROM diario').one().n);
   const certified=sql.exec("SELECT name FROM sqlite_master WHERE name='f123_frozen_unions'").toArray().length>0;
   if(!existing&&!certified){
    const local=new Y.Doc();local.clientID=303;
    for(let i=0;i<10;i++){
     const id='local-'+String(i).padStart(3,'0');
     local.getMap('eventos').set(id,{kind:'sale.record',opId:id,amountCents:1000+i});
    }
    sql.exec('INSERT INTO diario (cambio) VALUES (?)',Y.encodeStateAsUpdate(local));
    local.destroy();
   }
  }
  return super.onStart();
 }
 async onRequest(req){
  if(req.headers.get('x-f123-gated4-fixture')!=='1')return super.onRequest(req);
  try{
   const sql=this.ctx.storage.sql;
   const data=await exportCompleteYpartyYjs({storage:this.ctx.storage,channel:'ops'});
   const doc=new Y.Doc();Y.applyUpdate(doc,data.bytes);
   const events=doc.getMap('eventos');
   const hasUnion=sql.exec("SELECT name FROM sqlite_master WHERE name='f123_frozen_unions'").toArray().length>0;
   const certRow=hasUnion?sql.exec('SELECT pitr_bookmark FROM f123_frozen_unions WHERE id=1').toArray()[0]:null;
   const response={
    opened:this.gateD?.opened===true,already:this.gateD?.already===true,
    count:events.size,amountCents:[...events.values()].reduce((n,x)=>n+x.amountCents,0),
    localCount:[...events.keys()].filter(k=>k.startsWith('local-')).length,
    historicCount:[...events.keys()].filter(k=>k.startsWith('historical-')).length,
    pending:!!(doc.store.pendingStructs||doc.store.pendingDs),
    journal:sql.exec('SELECT COUNT(*) AS n FROM diario').one().n,
    unionProof:sql.exec("SELECT name FROM sqlite_master WHERE name='f123_frozen_unions'").toArray().length>0,
    cert:sql.exec("SELECT name FROM sqlite_master WHERE name='f123_frozen_imports'").toArray().length>0,
    pitrBookmark:certRow?.pitr_bookmark??null,
    pitrAvailable:typeof certRow?.pitr_bookmark==='string',
    pitrApiSupported:typeof this.ctx.storage.getCurrentBookmark==='function'
   };
   doc.destroy();
   return Response.json(response);
  }catch(e){return new Response(String(e?.message||e),{status:409});}
 }
}
export default {
 async fetch(req,env){
  if(req.headers.get('x-f123-gated4-fixture')==='1'){
   const room=new URL(req.url).pathname.split('/').pop();
   return (await getServerByName(env.Tienda,room)).fetch(req);
  }
  return worker.fetch(req,env);
 }
};
