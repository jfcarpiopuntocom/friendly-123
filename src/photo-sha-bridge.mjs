import {createOwnerTicketParams} from './ws-owner-ticket-params.mjs';

const SHA=/^[a-f0-9]{64}$/;
const MIME=new Set(['image/jpeg','image/png','image/webp','image/gif']);
const MAX=6*1024*1024;
const HOST=/^[a-z0-9-]+\.jfcarpio\.workers\.dev$/;
const deny=()=>new Error('Photo SHA bridge unavailable');
const hashBytes=async bytes=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))]
  .map(x=>x.toString(16).padStart(2,'0')).join('');
const bytesFromDataUrl=dataUrl=>{
 const m=/^data:(image\/(?:jpeg|png|webp|gif));base64,([A-Za-z0-9+/]+={0,2})$/.exec(dataUrl||'');
 if(!m||!MIME.has(m[1])||m[2].length>Math.ceil(MAX/3)*4+4)throw deny();
 let binary;
 try { binary=atob(m[2]); } catch (_) { throw deny(); }
 if(binary.length<1||binary.length>MAX)throw deny();
 const bytes=new Uint8Array(binary.length);
 for(let i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i);
 return{tipo:m[1],bytes};
};
const toDataUrl=(mime,bytes)=>{
 const parts=[];
 for(let at=0;at<bytes.length;at+=32768)parts.push(String.fromCharCode(...bytes.subarray(at,at+32768)));
 return 'data:'+mime+';base64,'+btoa(parts.join(''));
};

// HTTP-only photo transport. Never pass this ticket function to a YProvider.
export function createPhotoShaBridge({host,licenseCode,instanceId,room,getCredentials,fetch:send=globalThis.fetch.bind(globalThis)}={}){
 if(!HOST.test(host||'')||!/^[a-f0-9]{32}$/.test(room||'')||
    typeof getCredentials!=='function'||typeof send!=='function')throw deny();
 const path='https://'+host+'/parties/tienda/'+room+'-fotos';
 const fresh=kind=>createOwnerTicketParams({licenseCode,instanceId,room:room+'-fotos',
    photoScope:kind,getCredentials,fetch:send});
 async function request(kind,sha,bytes,tipo){
   const params=await fresh(kind)();
   // The issued credential is in an HTTP header only. Do not log or cache it.
   const headers={
     'authorization':'Bearer '+params.cap,
     'x-f123-license':licenseCode,'x-f123-instance':instanceId,
     ...(kind==='write'?{'content-type':tipo}:{})
   };
   const response=await send(path+'?sha='+sha,{
     method:kind==='write'?'PUT':'GET',mode:'cors',cache:'no-store',
     credentials:'omit',redirect:'error',referrerPolicy:'no-referrer',
     headers,...(kind==='write'?{body:bytes}:{})
   });
   if(!response?.ok)throw deny();
   return response;
 }
 return Object.freeze({
   async put(sha,dataUrl){
     if(!SHA.test(sha||''))throw deny();
     const {bytes,tipo}=bytesFromDataUrl(dataUrl);
     if(await hashBytes(bytes)!==sha)throw deny();
     const response=await request('write',sha,bytes,tipo);
     if(![200,201].includes(response.status))throw deny();
     const receipt=await response.json();
     if(receipt?.sha!==sha||receipt.bytes!==bytes.length||receipt.tipo!==tipo)throw deny();
     return {sha,bytes:bytes.length,tipo};
   },
   async get(sha){
     if(!SHA.test(sha||''))throw deny();
     const response=await request('read',sha);
     const tipo=response.headers.get('content-type');
     const declared=response.headers.get('content-length');
     if(!MIME.has(tipo)||declared!==null&&(!/^\d+$/.test(declared)||Number(declared)>MAX))throw deny();
     const bytes=new Uint8Array(await response.arrayBuffer());
     if(!bytes.length||bytes.length>MAX||declared!==null&&Number(declared)!==bytes.length||
       await hashBytes(bytes)!==sha)throw deny();
     return toDataUrl(tipo,bytes);
   }
 });
}
