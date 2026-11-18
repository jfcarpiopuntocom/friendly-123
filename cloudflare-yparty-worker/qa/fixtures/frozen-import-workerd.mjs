// ISOLATED SYNTHETIC MINIFLARE FIXTURE — never imported by real app or Worker.
// Tests the real Cloudflare DO SQL implementation against the dormant adapter.
import {
  prepareFrozenImport,installFrozenImport,readFrozenImport
} from '../../src/certified-frozen-import.mjs';

export class FrozenRoom {
  constructor(ctx){this.ctx=ctx;}
  async fetch(request){
    const route=new URL(request.url).pathname.split('/').pop();
    try{
      if(route==='seed'&&request.method==='POST'){
        const supplied=await request.json();
        const proof=await prepareFrozenImport({...supplied,
          frames:(supplied.frames||[]).map(bytes=>Uint8Array.from(bytes))});
        const result=await installFrozenImport({storage:this.ctx.storage,proof});
        return Response.json(result,{status:200,headers:{'cache-control':'no-store'}});
      }
      if(route==='read'&&request.method==='GET'){
        const result=await readFrozenImport({storage:this.ctx.storage});
        return new Response(result.bytes,{status:200,headers:{
          'content-type':'application/octet-stream','cache-control':'no-store',
          'x-frozen-sha256':result.receipt.sha256}});
      }
      return new Response('not found',{status:404});
    }catch(err){
      // Fixture returns generic errors only: no user data or secrets.
      return new Response('synthetic import rejected: '+String(err?.message||'failure'),{status:409});
    }
  }
}
export default {
  async fetch(request,env){
    if(request.headers.get('x-fixture-only')!=='synthetic')return new Response('forbidden',{status:403});
    const room=new URL(request.url).pathname.split('/').filter(Boolean)[0];
    if(!/^room-[ab]$/.test(room||''))return new Response('not found',{status:404});
    const stub=env.FrozenRoom.get(env.FrozenRoom.idFromName(room));
    return stub.fetch(request);
  }
};
