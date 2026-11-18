// Isolated Workerd/SQLite QA fixture only, NEVER deploy.
// The effect adapter is deliberately synthetic. Real product inventory,
// cash and customer ledgers are NOT wired by this fixture.
import {createTypedCommercialLedger} from '../../src/typed-commercial-ledger.mjs';
const LICENSE='F123-SYNT-BUSINESS';

export class SyntheticBusiness {
  constructor(ctx){
    this.storage=ctx.storage;
    const sql=ctx.storage.sql;
    this.inbox=createTypedCommercialLedger({
      sql,transactionSync:ctx.storage.transactionSync.bind(ctx.storage),
      clock:()=>1730000000000,
      authorize:async({ticket,license,scope})=>ticket==='synthetic-signed-ticket'&&license===LICENSE&&scope==='ops:sale'
        ? {ok:true,principal:{license,subject:'owner-account',scopes:[scope]}} : {ok:false},
      applyBusiness:({sql,command,principal})=>{
        if(principal.subject!=='owner-account')throw Error('actor not trusted');
        // This entire synthetic balance mutation MUST be inside the same
        // SQLite transaction as opId and its durable commercial receipt.
        sql.exec('CREATE TABLE IF NOT EXISTS synthetic_stock (sku TEXT PRIMARY KEY, quantity INTEGER NOT NULL)');
        sql.exec('CREATE TABLE IF NOT EXISTS synthetic_cash (id INTEGER PRIMARY KEY CHECK(id = 1), cents INTEGER NOT NULL)');
        sql.exec('INSERT OR IGNORE INTO synthetic_stock (sku,quantity) VALUES (?,?)',command.productId,10);
        sql.exec('INSERT OR IGNORE INTO synthetic_cash (id,cents) VALUES (1,0)');
        if(command.kind!=='sale.record')throw Error('unsupported synthetic kind');
        const old=sql.exec('SELECT quantity FROM synthetic_stock WHERE sku = ?',command.productId).one();
        if(old.quantity<command.quantity)throw Error('not enough stock in synthetic fixture');
        sql.exec('UPDATE synthetic_stock SET quantity = quantity - ? WHERE sku = ?',command.quantity,command.productId);
        if(command.opId==='synthetic-op-fail')sql.exec('INSERT INTO nonexistent_business_table VALUES (1)');
        if(command.opId==='synthetic-op-async')return Promise.resolve({applied:true});
        if(command.opId==='synthetic-op-refused')return {applied:false};
        sql.exec('UPDATE synthetic_cash SET cents = cents + ? WHERE id = 1',command.amountCents);
        return {applied:true};
      }
    });
    // A deterministic QA-only switch: accept an op while the executor is not
    // attached, then replay it via the normal attached executor after restart.
    this.inboxQueue=createTypedCommercialLedger({
      sql,transactionSync:ctx.storage.transactionSync.bind(ctx.storage),
      clock:()=>1730000000000,
      authorize:async({ticket,license,scope})=>ticket==='synthetic-signed-ticket'&&license===LICENSE&&scope==='ops:sale'
        ? {ok:true,principal:{license,subject:'owner-account',scopes:[scope]}} : {ok:false}
    });
  }
  async fetch(request){
    const url=new URL(request.url);
    if(url.pathname==='/inspect'){
      const sql=this.storage.sql;
      let stock=null,cash=null;
      // A queued operation precedes creation of business tables. The
      // synthetic inspector must not assume money/stock exist yet.
      try{stock=sql.exec('SELECT quantity FROM synthetic_stock WHERE sku = ?', 'sku-1').toArray()[0]?.quantity ?? null;}catch(_){}
      try{cash=sql.exec('SELECT cents FROM synthetic_cash WHERE id = 1').toArray()[0]?.cents ?? null;}catch(_){};
      const ops=sql.exec('SELECT COUNT(*) AS n FROM typed_commercial_ops').toArray()[0]?.n ?? 0;
      const payloads=sql.exec('SELECT COUNT(*) AS n FROM typed_commercial_payloads').toArray()[0]?.n ?? 0;
      return Response.json({stock,cash,ops,payloads});
    }
    if(!['/submit','/queue'].includes(url.pathname)||request.method!=='POST')return new Response('not found',{status:404});
    const result=await (url.pathname==='/queue'?this.inboxQueue:this.inbox).submit(await request.json());
    return Response.json(result,{status:result.status});
  }
}
export default {fetch(request,env){
  return env.BUSINESS.get(env.BUSINESS.idFromName('synthetic-business')).fetch(request);
}};
