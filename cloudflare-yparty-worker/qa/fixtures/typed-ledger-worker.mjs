// TEST-ONLY Miniflare Worker. Do not deploy: synthetic authority and fixtures.
import {createTypedCommercialLedger} from '../../src/typed-commercial-ledger.mjs';
const LICENSE='F123-SYNT-LEDGER';
export class SyntheticCommands {
  constructor(ctx){
    this.storage=ctx.storage;
    this.inbox=createTypedCommercialLedger({
      sql:ctx.storage.sql,
      transactionSync:ctx.storage.transactionSync.bind(ctx.storage),
      authorize:async({ticket,license,scope})=>
        ticket==='synthetic-signed-ticket'&&license===LICENSE
          ? {ok:true,principal:{license,subject:'synthetic-owner',scopes:[scope]}}
          : {ok:false},
      // QA-only synthetic membership; no real customer roster or external service.
      authorizeCustomer:async({license,clienteId,principal})=>
        license===LICENSE&&clienteId==='client_1'&&principal?.subject==='synthetic-owner',
      authorizeReceivable:async({license,receivableId,principal})=>
        license===LICENSE&&receivableId==='debt_1'&&principal?.subject==='synthetic-owner',
      clock:()=>1730000000000
    });
  }
  async fetch(request){
    if(new URL(request.url).pathname==='/test-count'){
      const rows=Array.from(this.storage.sql.exec('SELECT COUNT(*) AS count FROM typed_commercial_ops'));
      return Response.json({count:rows[0]?.count||0});
    }
    // QA-only readback endpoint; absent from the real Worker entrypoint.
    if(new URL(request.url).pathname==='/test-payload'){
      // Test-only whitelist; never expose an unrestricted receipt reader.
      const opId=new URL(request.url).searchParams.get('op')||'synthetic-op-001';
      if(!['synthetic-op-001','customer-payment:8f79b07c-3db5-478f-ab69-59b0e483912b'].includes(opId))
        return Response.json({ok:false},{status:400});
      const rows=Array.from(this.storage.sql.exec(
        'SELECT payload_json FROM typed_commercial_payloads WHERE license = ? AND op_id = ?',
        LICENSE,opId));
      return Response.json({payload:rows[0]?.payload_json||null});
    }
    if(request.method!=='POST')return new Response('method',{status:405});
    try{
      const r=await this.inbox.submit(await request.json());
      return Response.json(r,{status:r.status});
    }catch(_){return Response.json({ok:false,reason:'synthetic-fixture-error'},{status:503});}
  }
}
export default {
  fetch(request,env){
    const id=env.COMMANDS.idFromName('synthetic-tenant');
    return env.COMMANDS.get(id).fetch(request);
  }
};
