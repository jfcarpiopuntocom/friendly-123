// Synthetic-only QA subclass around REAL Tienda; NEVER import this from production.
import worker,{Tienda as RealTienda} from '../../src/index.js';
import {getServerByName} from 'partyserver';
import {exportCompleteYpartyYjs} from '../../src/durable-full-yjs-export.mjs';
import * as Y from 'yjs';
export class Tienda extends RealTienda{
 async onStart(){
  // Observe a real base-class fail-closed rejection without letting the
  // synthetic QA diagnostics disappear behind the DO's failed startup.
  try{return await super.onStart()}
  catch(error){this.c14StartupError=String(error?.message||error);}
 }
 async onRequest(request){
  if(request.headers.get('x-f123-c14-fixture')!=='synthetic-only'){
   if(this.c14StartupError)return new Response('Gate D refused uncertified history',{status:503});
   return super.onRequest(request);
  }
  if(!this.name.endsWith('-ops'))return new Response('wrong room',{status:403});
  const sql=this.ctx.storage.sql,action=request.headers.get('x-f123-c14-action')||'inspect';
  try{
   const certTable=sql.exec("SELECT name FROM sqlite_master WHERE name='f123_frozen_imports'").toArray().length>0;
   const baselineTable=sql.exec("SELECT name FROM sqlite_master WHERE name='f123_frozen_import_event_baseline'").toArray().length>0;
   if(action==='inspect'){
    if(!certTable)return Response.json({opened:false,already:false,
     failback:this.c14StartupError||'flag-off',count:0,values:{},
     cert:false,baseline:baselineTable,baselineCount:null,journal:0,pending:false});
    const full=await exportCompleteYpartyYjs({storage:this.ctx.storage,channel:'ops'});
    const d=new Y.Doc();Y.applyUpdate(d,full.bytes);
    const events=d.getMap('eventos');
    const response={opened:this.gateD?.opened===true,already:this.gateD?.already===true,
     failback:this.c14StartupError??this.gateD?.failback??null,count:events.size,values:events.toJSON(),
     cert:certTable,baseline:baselineTable,
     baselineCount:baselineTable?Number(sql.exec('SELECT COUNT(*) AS n FROM f123_frozen_import_event_baseline').one().n):null,
     journal:sql.exec('SELECT COUNT(*) AS n FROM diario').one().n,
     pending:!!(d.store.pendingStructs||d.store.pendingDs)};
    d.destroy();return Response.json(response);
   }
   if(action==='append' || action==='tamper'){
    const full=await exportCompleteYpartyYjs({storage:this.ctx.storage,channel:'ops'});
    const d=new Y.Doc();Y.applyUpdate(d,full.bytes);
    const updates=[];d.on('update',bytes=>updates.push(bytes));
    if(action==='tamper')
      d.getMap('eventos').set('historical-001',{opId:'historical-001',kind:'sale.record',amountCents:777777});
    else
      d.getMap('eventos').set('after-cut-001',{opId:'after-cut-001',kind:'sale.record',amountCents:1100});
    if(updates.length!==1)throw new Error('fixture produced unexpected updates');
    sql.exec('INSERT INTO diario(cambio) VALUES (?)',updates[0]);d.destroy();
    return Response.json({ok:true});
   }
   if(action==='drop-baseline'){
    if(!baselineTable)return new Response('baseline not installed',{status:409});
    sql.exec('DELETE FROM f123_frozen_import_event_baseline WHERE opid=?','historical-001');
    return Response.json({ok:true});
   }
   if(action==='damage-baseline'){
    if(!baselineTable)return new Response('baseline not installed',{status:409});
    sql.exec('UPDATE f123_frozen_import_event_baseline SET payload=? WHERE opid=?','{"amountCents":0}','historical-001');
    return Response.json({ok:true});
   }
   return new Response('unsupported synthetic action',{status:400});
  }catch(e){return new Response('synthetic error: '+String(e?.message||e),{status:409})}
 }
}
export default{
 async fetch(req,env){
  if(req.headers.get('x-f123-c14-fixture')==='synthetic-only'){
   const room=new URL(req.url).pathname.split('/').pop();
   return (await getServerByName(env.Tienda,room)).fetch(req);
  }
  return worker.fetch(req,env);
 }
};
