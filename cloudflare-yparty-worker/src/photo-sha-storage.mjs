// Server-side photo bytes outside Yjs. Existing Durable Object SQLite only.
// SHA references ({sha,bytes,tipo}) are the only data permitted in the Yjs
// document once its browser photo adapter is migrated. No R2 or new service.
export const PHOTO_BLOCK_BYTES = 512*1024;
export const PHOTO_MAX_BYTES = 6*1024*1024;
const SHA=/^[a-f0-9]{64}$/;
const MIME=new Set(['image/jpeg','image/png','image/webp','image/gif']);
const fail=(status,reason)=>Object.assign(new Error(reason),{status,reason});
function hex(bytes){return Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('');}
async function digest(bytes){return hex(await crypto.subtle.digest('SHA-256',bytes));}
function copy(bytes){return bytes instanceof Uint8Array?bytes:new Uint8Array(bytes);}

export async function boundedPhotoBody(request) {
 const length=request.headers.get('content-length');
 if(length!==null&&(!/^\d+$/.test(length)||Number(length)>PHOTO_MAX_BYTES||Number(length)===0))throw fail(413,'photo-size-invalid');
 if(!request.body||typeof request.body.getReader!=='function')throw fail(400,'photo-body-required');
 const reader=request.body.getReader(),chunks=[];let total=0;
 try {
   for(;;){
     const {done,value}=await reader.read();if(done)break;
     const chunk=copy(value);total+=chunk.byteLength;
     if(total>PHOTO_MAX_BYTES)throw fail(413,'photo-too-large');
     chunks.push(chunk);
   }
 }catch(error){try{await reader.cancel();}catch(_){}throw error;}
 if(!total||length!==null&&Number(length)!==total)throw fail(400,'photo-length-mismatch');
 const bytes=new Uint8Array(total);let offset=0;
 for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
 return bytes;
}

export function photoShaStore(storage) {
 const sql=storage?.sql,transaction=storage?.transactionSync?.bind(storage);
 if(!sql||typeof sql.exec!=='function'||typeof transaction!=='function')throw new TypeError('Durable Object SQL is required');
 function tables(){
   sql.exec('CREATE TABLE IF NOT EXISTS photo_sha_meta (sha TEXT PRIMARY KEY, bytes INTEGER NOT NULL, tipo TEXT NOT NULL, bloques INTEGER NOT NULL)');
   sql.exec('CREATE TABLE IF NOT EXISTS photo_sha_blocks (sha TEXT NOT NULL, n INTEGER NOT NULL, contenido BLOB NOT NULL, PRIMARY KEY (sha,n))');
 }
 function readSync(sha){
   const row=sql.exec('SELECT bytes,tipo,bloques FROM photo_sha_meta WHERE sha = ?',sha).toArray()[0];
   if(!row)return null;
   if(!Number.isSafeInteger(row.bytes)||row.bytes<1||row.bytes>PHOTO_MAX_BYTES||
      !MIME.has(row.tipo)||row.bloques!==Math.ceil(row.bytes/PHOTO_BLOCK_BYTES))throw fail(503,'photo-metadata-corrupt');
   const all=new Uint8Array(row.bytes);let n=0,at=0;
   for(const block of sql.exec('SELECT n,contenido FROM photo_sha_blocks WHERE sha = ? ORDER BY n',sha)){
     const part=copy(block.contenido),expected=Math.min(PHOTO_BLOCK_BYTES,row.bytes-at);
     if(block.n!==n||part.byteLength!==expected||part.byteLength===0)throw fail(503,'photo-block-corrupt');
     all.set(part,at);at+=part.byteLength;n++;
   }
   if(at!==row.bytes||n!==row.bloques)throw fail(503,'photo-block-missing');
   return {bytes:all,tipo:row.tipo};
 }
 return Object.freeze({
   async put({sha,tipo,bytes}={}){
     if(typeof sha!=='string'||!SHA.test(sha))throw fail(400,'photo-sha-invalid');
     if(!MIME.has(tipo))throw fail(415,'photo-type-unsupported');
     bytes=copy(bytes);
     if(bytes.byteLength<1||bytes.byteLength>PHOTO_MAX_BYTES)throw fail(413,'photo-size-invalid');
     if(await digest(bytes)!==sha)throw fail(422,'photo-sha-mismatch');
     let inserted=false;
     transaction(()=>{
       tables();
       const existing=readSync(sha);
       if(existing){
         if(existing.tipo!==tipo||existing.bytes.length!==bytes.length)throw fail(409,'photo-metadata-conflict');
         // Detect a corrupted historical row rather than ACKing a damaged SHA.
         for(let i=0;i<bytes.length;i++)if(existing.bytes[i]!==bytes[i])throw fail(503,'photo-existing-data-corrupt');
         return;
       }
       const blocks=Math.ceil(bytes.length/PHOTO_BLOCK_BYTES);
       sql.exec('INSERT INTO photo_sha_meta(sha,bytes,tipo,bloques) VALUES (?,?,?,?)',sha,bytes.length,tipo,blocks);
       for(let n=0;n<blocks;n++){
         sql.exec('INSERT INTO photo_sha_blocks(sha,n,contenido) VALUES (?,?,?)',
           sha,n,bytes.subarray(n*PHOTO_BLOCK_BYTES,Math.min((n+1)*PHOTO_BLOCK_BYTES,bytes.length)));
       }
       inserted=true;
     });
     // Never return a confirmed upload until the storage output gate is durable.
     await storage.sync();
     return{sha,bytes:bytes.length,tipo,created:inserted};
   },
   async get(sha){
     if(typeof sha!=='string'||!SHA.test(sha))throw fail(400,'photo-sha-invalid');
     tables();
     const result=readSync(sha);
     if(!result)return null;
     if(await digest(result.bytes)!==sha)throw fail(503,'photo-sha-corrupt');
     return result;
   }
 });
}
