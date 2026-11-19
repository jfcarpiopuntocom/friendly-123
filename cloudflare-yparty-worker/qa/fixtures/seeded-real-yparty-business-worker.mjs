// TEST-ONLY adapter. Actual Tienda.onRequest, source router and Workerd SQL
// run unchanged; the subclass injects an INTERNAL synthetic frozen snapshot.
// This file and its seed hook are NEVER part of deployed Worker entrypoint.
import worker,{Tienda as RealTienda} from '../../src/index.js';
import {prepareBusinessBaseline,installBusinessBaseline} from '../../src/authoritative-business-sql.mjs';
export class Tienda extends RealTienda {
  // Synthetic-only test boundary: -cat uses the REAL certified Gate D/C11
  // import, while -ops here exercises its independent preseeded *business*
  // SQL ledger with WS_TEST_ONLY_INTERNAL_SEED. Frozen -ops history import
  // is covered by separate C14/Gate D tests, not this failback fixture.
  async onStart() {
    if (this.env.WS_TEST_ONLY_INTERNAL_SEED === '1' &&
        this.env.WS_OPEN_EXISTING_QA === '1' &&
        this.name === this.env.SALA_PILOTO + '-ops') {
      this.env = {...this.env, WS_OPEN_EXISTING_QA: '0'};
    }
    return super.onStart();
  }
  async onRequest(req) {
    if(this.env.WS_TEST_ONLY_INTERNAL_SEED==='1'&&this.name===this.env.SALA_PILOTO+'-ops'){
      const baseline={license:'F123-SYNT-BUSINESS',frozenHead:'synthetic-head-001',
        products:[{productId:'sku_1',quantity:5,unitPriceCents:1500}],openingCashCents:500,
        receivables:[{receivableId:'fiado_1',balanceCents:3000}]};
      const sha=[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(baseline))))]
        .map(n=>n.toString(16).padStart(2,'0')).join('');
      const proof=await prepareBusinessBaseline({...baseline,sourceFrozenVerified:true,expectedSha256:sha});
      installBusinessBaseline({storage:this.ctx.storage,proof});
    }
    const inspect=req.headers.get('x-f123-synthetic-inspect');
    if(inspect==='1'||inspect==='2'){
      const sql=this.ctx.storage.sql;
      return Response.json({
        stock:sql.exec('SELECT quantity FROM f123_business_stock WHERE license = ? AND product_id = ?',
          'F123-SYNT-BUSINESS','sku_1').toArray()[0]?.quantity,
        cash:sql.exec('SELECT cash_cents FROM f123_business_baseline WHERE license = ?',
          'F123-SYNT-BUSINESS').toArray()[0]?.cash_cents,
        effects:sql.exec('SELECT COUNT(*) AS n FROM f123_business_effects').one()?.n,
        receipts:sql.exec('SELECT COUNT(*) AS n FROM typed_commercial_ops').toArray()[0]?.n||0,
        // '2' adds the synthetic fiado balance; '1' keeps the older shape.
        ...(inspect==='2'?{debt:sql.exec('SELECT balance_cents FROM f123_business_receivables WHERE license = ? AND receivable_id = ?',
          'F123-SYNT-BUSINESS','fiado_1').toArray()[0]?.balance_cents}:{})
      });
    }
    return super.onRequest(req);
  }
}
export default worker;
