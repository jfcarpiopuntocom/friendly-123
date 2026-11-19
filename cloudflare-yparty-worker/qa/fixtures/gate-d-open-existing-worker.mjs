// TEST-ONLY adapter for Gate D. The real Tienda (y-partyserver) and router run
// unchanged; this subclass calls the dormant open-existing hook where the
// future wiring goes (src/index.js Tienda.onStart, before `await super.onStart()`).
// The synthetic source arrives as a test binding; never part of a deployed Worker.
import worker,{Tienda as RealTienda} from '../../src/index.js';
import {getServerByName} from 'partyserver';
import {openExistingStore,failbackUpdate} from '../../src/open-existing-store.mjs';

export class Tienda extends RealTienda {
  // This historical fixture specifically tests the helper independently,
  // including the rejected-import fallback. The REAL production-hook
  // contract has its own Workerd test with no subclass override.
  async abrirHistorialCongeladoSiAplica() {}
  async onStart() {
    const sources=this.env.GATE_D_TEST_SOURCE?JSON.parse(this.env.GATE_D_TEST_SOURCE):{};
    const s=sources[this.name.slice(-3)];
    this.gateD=s?await openExistingStore({env:this.env,storage:this.ctx.storage,
      source:{...s,frames:s.frames.map(f=>Uint8Array.from(f))}}):null;
    return super.onStart();
  }
  async onRequest(req) {
    if(req.headers.get('x-f123-synthetic-gate-d')!=='1')return super.onRequest(req);
    if(req.headers.get('x-f123-synthetic-tamper-cert')==='1'){
      const row=this.ctx.storage.sql.exec('SELECT sha256 FROM f123_frozen_imports WHERE id=1').toArray()[0];
      if(!row)return new Response('missing proof',{status:409});
      this.ctx.storage.sql.exec('UPDATE f123_frozen_imports SET sha256 = ? WHERE id=1','0'.repeat(64));
      return Response.json({tampered:true});
    }
    if(req.method==='GET')return Response.json({gateD:this.gateD,
      blocks:this.ctx.storage.sql.exec('SELECT COUNT(*) AS n FROM documento_bloques').one().n});
    try{
      const r=await failbackUpdate({storage:this.ctx.storage,channel:this.name.slice(-3),
        legacyStateVector:new Uint8Array(await req.arrayBuffer())});
      return new Response(r.update,{headers:{'x-state-sha256':r.sha256}});
    }catch(e){return new Response(String(e?.message||e),{status:409});}
  }
}
export default {
  async fetch(req,env) {
    if(req.headers.get('x-f123-synthetic-gate-d')==='1')
      return (await getServerByName(env.Tienda,new URL(req.url).pathname.split('/').pop())).fetch(req);
    return worker.fetch(req,env);
  }
};
