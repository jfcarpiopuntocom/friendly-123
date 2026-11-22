// C11 · browser-facing frozen catalog HEAD; authoritative SQL/Workerd only.
// Used after REAL Gate D cold import/reopen. Never returns catalog rows,
// customer data, PIN, raw Yjs history or a commercial ACK.
import {askAuthority,secureMode} from './ws-authority-client.js';
import {sufijoSalaPiloto} from './salas-piloto.mjs';
import {assertPublicCatalogTransportDoc} from './catalog-safe-projection.mjs';
const HEAD=/^[A-Za-z0-9_.:-]{3,128}$/;
const SHA=/^[a-f0-9]{64}$/;
const noStore={'cache-control':'no-store','x-content-type-options':'nosniff'};
const fail=(status)=>new Response(status===403?'Acceso no autorizado':'Catalog proof unavailable',
 {status,headers:noStore});

export async function readSignedFrozenCatalogProof({request,env,storage,doc,room,verified}={}){
 if(!secureMode(env)||env.WS_SEPARATE_ROOMS_QA!=='1'||
    env.WS_OPEN_EXISTING_QA!=='1'||
    sufijoSalaPiloto(env,room)!=='-cat')return fail(503);
 if(request?.method!=='GET')return fail(405);
 const auth=request.headers.get('authorization')||'';
 const token=auth.startsWith('Bearer ')?auth.slice(7):'';
 const access={
  token,
  licenseCode:String(request.headers.get('x-f123-license')||'').trim().toUpperCase(),
  instanceId:request.headers.get('x-f123-instance')||'',
  room,requiredScope:'cat:read'
 };
 // The central authority consumes this one-use proof ticket BEFORE any SQL
 // inspection. Bare license+instance, Team and replayed tickets never pass.
 const signed=await askAuthority(env,'consume',access);
 if(!signed)return fail(403);
 try{
  if(verified!==true||!storage?.sql||!doc||doc.isDestroyed)throw Error('not verified');
  // YServer hydrates remote root names as Yjs AbstractType placeholders.
  // Materialize ONLY these two known-public map types after SQL certification,
  // then reject every unexpected root/field with C9's exact allowlist.
  if(!doc.share?.has('productos')||!doc.share.has('ubicaciones'))
    throw Error('missing public roots');
  doc.getMap('productos');
  doc.getMap('ubicaciones');
  assertPublicCatalogTransportDoc({doc,room});
  const sql=storage.sql;
  const exists=sql.exec("SELECT 1 FROM sqlite_master WHERE type='table' AND name='f123_frozen_imports'").toArray().length;
  if(!exists)throw Error('missing certificate');
  const row=sql.exec('SELECT channel,frozen_head,sha256,vector_sha256 FROM f123_frozen_imports WHERE id=1').toArray()[0];
  if(row?.channel!=='cat'||!HEAD.test(row.frozen_head||'')||
     !SHA.test(row.sha256||'')||!SHA.test(row.vector_sha256||''))throw Error('invalid certificate');
  // Gate D validated SQL snapshot+journal onStart, including cold reopen.
  // Historical SHA is the frozen baseline, not a live economic state claim.
  return Response.json({ok:true,room,channel:'cat',frozenHead:row.frozen_head,
   stateSha256:row.sha256,vectorSha256:row.vector_sha256},
   {status:200,headers:noStore});
 }catch(_){return fail(503);}
}
