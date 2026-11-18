// QA-ONLY fixture. The /seed route is NEVER present in actual Tienda Worker.
// Exercises the same server-only production executor + typed-ledger on real Workerd SQLite.
import {prepareBusinessBaseline,installBusinessBaseline,createBusinessSqlExecutor} from '../../src/authoritative-business-sql.mjs';
import {createTypedCommercialLedger} from '../../src/typed-commercial-ledger.mjs';
export class CommercialFixture {
  constructor(ctx){
    this.ctx=ctx;
    this.sql=ctx.storage.sql;
  }
  async fetch(req){
    const path=new URL(req.url).pathname;
    if(path==='/inject-yjs-history'&&req.method==='POST'){
      // Synthetic persisted Yjs op fragment: this route exists ONLY in QA.
      this.sql.exec('CREATE TABLE IF NOT EXISTS diario (n INTEGER PRIMARY KEY AUTOINCREMENT, cambio BLOB)');
      this.sql.exec('INSERT INTO diario (cambio) VALUES (?)',new Uint8Array([1,2,3]));
      return Response.json({ok:true});
    }
    if(path==='/seed'&&req.method==='POST'){
      try{
        const input=await req.json();
        const proof=await prepareBusinessBaseline(input);
        const receipt=installBusinessBaseline({storage:this.ctx.storage,proof});
        return Response.json({ok:true,...receipt},{status:200});
      }catch(e){return Response.json({ok:false,reason:e.message},{status:409});}
    }
    if(path==='/stats'&&req.method==='GET'){
      const rows={};
      for(const [key,query] of [
        ['baseline','SELECT frozen_head,sha256,count,cash_cents FROM f123_business_baseline'],
        ['stock','SELECT product_id,quantity,unit_price_cents FROM f123_business_stock ORDER BY product_id'],
        ['receivables','SELECT receivable_id,balance_cents FROM f123_business_receivables ORDER BY receivable_id'],
        ['effects','SELECT op_id,product_id,quantity_delta,cash_delta_cents FROM f123_business_effects ORDER BY op_id'],
        ['receipts','SELECT op_id,receipt_json FROM typed_commercial_ops ORDER BY op_id']]){
        try{rows[key]=this.sql.exec(query).toArray();}catch(_){rows[key]=[];}
      }
      return Response.json(rows);
    }
    if(!['/submit','/queue'].includes(path)||req.method!=='POST')return new Response('not found',{status:404});
    const payload=await req.json();
    const executor=createBusinessSqlExecutor({sql:this.sql});
    const ledger=createTypedCommercialLedger({
      sql:this.sql,transactionSync:this.ctx.storage.transactionSync.bind(this.ctx.storage),
      clock:()=>1730000000000,
      authorize:async({ticket,license,scope})=>{
        if(ticket==='synthetic-revoked-ticket'||license!=='F123-SYNT-BUSINESS'||!['ops:sale','ops:payment','ops:adjust'].includes(scope))
          return {ok:false};
        const owner=ticket==='synthetic-owner-ticket';
        const team=ticket==='synthetic-team-ticket',admin=ticket==='synthetic-admin-ticket';
        return owner||team||admin
          ? {ok:true,principal:{license,role:owner?'dueno':admin?'admin':'empleado',
              subject:owner?'owner-account':admin?'admin_12345':'team_12345',scopes:[scope]}}
          : {ok:false};
      },
      // Trusted pre-check: the receivable must exist in THIS license's certified store.
      authorizeReceivable:async({license,receivableId})=>{
        try{return !!this.sql.exec('SELECT 1 AS ok FROM f123_business_receivables WHERE license = ? AND receivable_id = ?',
          license,receivableId).toArray()[0];}catch(_){return false;}
      },
      ...(path==='/submit'?{applyBusiness:({sql,command,principal})=>{
        const result=executor({sql,command,principal});
        if(command.opId==='synthetic-rollback-after-stock')throw new Error('synthetic failure before receipt');
        return result;
      }}:{})
    });
    const result=await ledger.submit(payload);
    return Response.json(result,{status:result.ok&&result.receipt?.stage==='stored-for-application'?202:result.status});
  }
}
export default {fetch(request,env){
  return env.BUSINESS.get(env.BUSINESS.idFromName('synthetic-business')).fetch(request);
}};
