// QA ONLY: isolated Miniflare/Workerd Durable Object. This is NOT the app Worker.
import {prepareFrozenImport,installFrozenImport} from '../../src/certified-frozen-import.mjs';
import {exportCompleteYpartyYjs} from '../../src/durable-full-yjs-export.mjs';
const BLOCK=512*1024;
export class FullExportRoom{
 constructor(ctx){this.ctx=ctx;}
 async fetch(req){
  const path=new URL(req.url).pathname.split('/').pop();
  const sql=this.ctx.storage.sql;
  try{
   if(path==='seed'&&req.method==='POST'){
    const body=await req.json();
    const proof=await prepareFrozenImport({...body,frames:body.frames.map(u=>Uint8Array.from(u))});
    const res=await installFrozenImport({storage:this.ctx.storage,proof});
    return Response.json(res);
   }
   if(path==='legacy'&&req.method==='POST'){
    const {frame}=await req.json();
    this.ctx.storage.transactionSync(()=>{
      sql.exec('CREATE TABLE IF NOT EXISTS documento (id INTEGER PRIMARY KEY,contenido BLOB)');
      sql.exec('CREATE TABLE IF NOT EXISTS documento_bloques (n INTEGER PRIMARY KEY,contenido BLOB NOT NULL)');
      sql.exec('CREATE TABLE IF NOT EXISTS diario (n INTEGER PRIMARY KEY AUTOINCREMENT,cambio BLOB)');
      sql.exec('CREATE TABLE IF NOT EXISTS diario_bloques (n INTEGER NOT NULL,parte INTEGER NOT NULL,contenido BLOB NOT NULL,PRIMARY KEY(n,parte))');
      sql.exec('INSERT INTO documento (id,contenido) VALUES (1,?)',Uint8Array.from(frame));
    });
    return Response.json({ok:true});
   }
   if(path==='append'&&req.method==='POST'){
    const {frames}=await req.json();
    if(!Array.isArray(frames)||!frames.length)throw Error('frames required');
    this.ctx.storage.transactionSync(()=>{
      for(const item of frames){
        const update=Uint8Array.from(item);
        if(update.byteLength<=BLOCK)sql.exec('INSERT INTO diario (cambio) VALUES (?)',update);
        else{
          const {n}=sql.exec("INSERT INTO diario (cambio) VALUES (X'') RETURNING n").one();
          for(let p=0,off=0;off<update.byteLength;p++,off+=BLOCK)
            sql.exec('INSERT INTO diario_bloques (n,parte,contenido) VALUES (?,?,?)',
              n,p,update.subarray(off,off+BLOCK));
        }
      }
    });
    return Response.json({ok:true,count:frames.length});
   }
   if(path==='inspect'){
    const count=table=>sql.exec('SELECT COUNT(*) AS n FROM '+table).one().n;
    return Response.json({journalRows:count('diario'),journalBlocks:count('diario_bloques'),
      snapshotBlocks:count('documento_bloques')});
   }
   if(path==='break'&&req.method==='POST'){
    const {mode}=await req.json();
    if(mode==='remove-middle-chunk'){
      const row=sql.exec('SELECT n,parte FROM diario_bloques WHERE parte=1 LIMIT 1').toArray()[0];
      if(!row)throw Error('no middle journal chunk');
      sql.exec('DELETE FROM diario_bloques WHERE n=? AND parte=?',row.n,row.parte);
    }else if(mode==='orphan-journal-block'){
      sql.exec('INSERT INTO diario_bloques (n,parte,contenido) VALUES (999999,0,?)',new Uint8Array([1,2,3]));
    }else throw Error('unsupported synthetic fault');
    return Response.json({ok:true});
   }
   if(path==='export'&&req.method==='GET'){
    const {bytes,sha256,vectorSha256,eventCount}=await exportCompleteYpartyYjs({storage:this.ctx.storage,channel:'ops'});
    return new Response(bytes,{status:200,headers:{
     'content-type':'application/octet-stream','x-state-sha256':sha256,
     'x-vector-sha256':vectorSha256,'x-event-count':String(eventCount),
     'cache-control':'no-store'}});
   }
   return new Response('not found',{status:404});
  }catch(error){return new Response('synthetic export rejected: '+String(error?.message||'unknown'),{status:409});}
 }
}
export default {
 async fetch(req,env){
  if(req.headers.get('x-fixture-only')!=='synthetic')return new Response('forbidden',{status:403});
  const room=new URL(req.url).pathname.split('/').filter(Boolean)[0];
  if(!/^room-[ab]$/.test(room||''))return new Response('not found',{status:404});
  return env.FullExportRoom.get(env.FullExportRoom.idFromName(room)).fetch(req);
 }
};
