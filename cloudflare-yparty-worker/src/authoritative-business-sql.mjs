// Server-only SQL economic state anchored to an independently verified frozen source.
// Used by the same YParty -ops DO that stores typed_commercial_ops and its ACK.
// No HTTP baseline endpoint. Without a certified baseline, business commits FAIL.
const LICENSE=/^F123-[0-9A-Z*~$=-]{8,34}$/;
const IDENT=/^[A-Za-z0-9_-]{1,64}$/;
const HEAD=/^[A-Za-z0-9_.:-]{3,128}$/;
const SHA=/^[a-f0-9]{64}$/;
const MAX=Number.MAX_SAFE_INTEGER;
const prepared=new WeakMap();
function fail(message){throw new Error(message);}
function int(n){return Number.isSafeInteger(n)&&n>=0;}
function validStorage(storage){
  if(!storage?.sql || typeof storage.sql.exec!=='function' ||
     typeof storage.transactionSync!=='function')fail('trusted DO SQL required');
}
async function hash(text){
  const data=new TextEncoder().encode(text);
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256',data))]
    .map(byte=>byte.toString(16).padStart(2,'0')).join('');
}
function normalize({license,frozenHead,products,openingCashCents,receivables}){
  if(!LICENSE.test(license||'')||!HEAD.test(frozenHead||'')||
     !Array.isArray(products)||!products.length||products.length>100000||
     !int(openingCashCents))fail('invalid independently anchored business baseline');
  const seen=new Set();
  const ordered=products.map(p=>{
    if(!p||!IDENT.test(p.productId||'')||!int(p.quantity)||
       !Number.isSafeInteger(p.unitPriceCents)||p.unitPriceCents<=0 ||
       p.unitPriceCents>10000000000||seen.has(p.productId))
      fail('invalid or duplicate catalog item');
    seen.add(p.productId);
    return {productId:p.productId,quantity:p.quantity,unitPriceCents:p.unitPriceCents};
  }).sort((a,b)=>a.productId<b.productId?-1:a.productId>b.productId?1:0);
  // Optional open fiados; omitted when absent so older certificates keep their hash.
  if(receivables===undefined)return {license,frozenHead,products:ordered,openingCashCents};
  const ids=new Set();
  if(!Array.isArray(receivables)||receivables.length>100000)fail('invalid receivables');
  const open=receivables.map(r=>{
    if(!r||!IDENT.test(r.receivableId||'')||!int(r.balanceCents)||ids.has(r.receivableId))
      fail('invalid or duplicate receivable');
    ids.add(r.receivableId);
    return {receivableId:r.receivableId,balanceCents:r.balanceCents};
  }).sort((a,b)=>a.receivableId<b.receivableId?-1:a.receivableId>b.receivableId?1:0);
  return {license,frozenHead,products:ordered,openingCashCents,receivables:open};
}
// The expected hash must be measured by a separate trusted Firebase freeze
// observer; computing it from user input and calling this function is NOT proof.
export async function prepareBusinessBaseline({expectedSha256,sourceFrozenVerified,...state}={}){
  if(sourceFrozenVerified!==true||!SHA.test(expectedSha256||''))
    fail('independent Firebase freeze certificate required');
  const canonical=normalize(state);
  const actual=await hash(JSON.stringify(canonical));
  if(actual!==expectedSha256)fail('business baseline checksum mismatch');
  const proof=Object.freeze({
    license:canonical.license,frozenHead:canonical.frozenHead,
    sha256:actual,products:canonical.products.length
  });
  prepared.set(proof,canonical);
  return proof;
}
function createTables(sql){
  sql.exec('CREATE TABLE IF NOT EXISTS f123_business_baseline (license TEXT PRIMARY KEY, frozen_head TEXT NOT NULL, sha256 TEXT NOT NULL, count INTEGER NOT NULL, cash_cents INTEGER NOT NULL)');
  sql.exec('CREATE TABLE IF NOT EXISTS f123_business_stock (license TEXT NOT NULL, product_id TEXT NOT NULL, quantity INTEGER NOT NULL, unit_price_cents INTEGER NOT NULL, PRIMARY KEY(license,product_id))');
  sql.exec('CREATE TABLE IF NOT EXISTS f123_business_receivables (license TEXT NOT NULL, receivable_id TEXT NOT NULL, balance_cents INTEGER NOT NULL, PRIMARY KEY(license,receivable_id))');
  sql.exec('CREATE TABLE IF NOT EXISTS f123_business_effects (license TEXT NOT NULL, op_id TEXT NOT NULL, product_id TEXT NOT NULL, quantity_delta INTEGER NOT NULL, cash_delta_cents INTEGER NOT NULL, PRIMARY KEY(license,op_id))');
}
function hasRows(sql,table){
  const exists=sql.exec('SELECT name FROM sqlite_master WHERE type = ? AND name = ?','table',table).toArray();
  return !!exists.length && Number(sql.exec('SELECT COUNT(*) AS n FROM '+table).one()?.n||0)>0;
}
export function installBusinessBaseline({storage,proof}={}){
  validStorage(storage);
  const state=prepared.get(proof);
  if(!state)fail('unprepared or forged business certificate');
  return storage.transactionSync(()=>{
    const sql=storage.sql;
    createTables(sql);
    const old=sql.exec('SELECT frozen_head,sha256,count,cash_cents FROM f123_business_baseline WHERE license = ?',state.license).toArray()[0];
    if(old){
      if(old.frozen_head!==proof.frozenHead||old.sha256!==proof.sha256||
         Number(old.count)!==proof.products||!int(Number(old.cash_cents)))
        fail('conflicting business baseline');
      const rows=sql.exec('SELECT product_id,quantity,unit_price_cents FROM f123_business_stock WHERE license = ? ORDER BY product_id',state.license).toArray();
      // Never compare current stock against opening stock after sales. Verify
      // immutable certificate, product keys/prices and absence of tampering.
      if(rows.length!==state.products.length ||
         rows.some((row,i)=>row.product_id!==state.products[i].productId||
           Number(row.unit_price_cents)!==state.products[i].unitPriceCents||
           !int(Number(row.quantity))))
        fail('business baseline integrity error');
      return {already:true,sha256:proof.sha256};
    }
    // Import must precede receipt issuance. Pending old inbox cannot be
    // silently replayed onto a baseline with an unknown causal cut.
    // A Yjs ops history in this SAME -ops DO is not automatically represented
    // in the economic baseline. Seeding over a prior op journal would risk
    // counting an older sale twice after reconnect. Defer to the certified
    // Firebase/DO reconciliation gate instead of silently inventing a cutover.
    if(['typed_commercial_ops','f123_business_effects','f123_business_stock','f123_business_receivables',
        'f123_business_baseline','documento','documento_bloques','diario',
        'diario_bloques','f123_frozen_imports'].some(table=>hasRows(sql,table)))
      fail('Yjs history or nonempty economic store requires controlled migration');
    sql.exec('INSERT INTO f123_business_baseline (license,frozen_head,sha256,count,cash_cents) VALUES (?,?,?,?,?)',
      state.license,state.frozenHead,proof.sha256,state.products.length,state.openingCashCents);
    for(const p of state.products)
      sql.exec('INSERT INTO f123_business_stock (license,product_id,quantity,unit_price_cents) VALUES (?,?,?,?)',
        state.license,p.productId,p.quantity,p.unitPriceCents);
    for(const r of state.receivables||[])
      sql.exec('INSERT INTO f123_business_receivables (license,receivable_id,balance_cents) VALUES (?,?,?)',
        state.license,r.receivableId,r.balanceCents);
    return {already:false,sha256:proof.sha256};
  });
}
// Owner or Admin (JFC 2026-11-18). Employee may collect (payment) but never adjust.
function ownerOrAdmin(p){
  return (p.role==='dueno'&&p.subject==='owner-account')||
    (p.role==='admin'&&/^[A-Za-z0-9_-]{5,120}$/.test(p.subject||''));
}
// Physical count: sets certified stock to the counted total and
// records the delta as an opId effect in the same transaction. No cash change.
function applyCount({sql,txSql,command,principal}){
  if(txSql!==sql||!LICENSE.test(command.license||'')||!IDENT.test(command.productId||'')||
     !int(command.quantity)||command.amountCents!==0||
     !principal||principal.license!==command.license||
     !ownerOrAdmin(principal)||
     !Array.isArray(principal.scopes)||!principal.scopes.includes('ops:adjust'))
    fail('unsupported command or principal');
  if(!sql.exec('SELECT 1 AS ok FROM f123_business_baseline WHERE license = ?',command.license).toArray()[0])
    fail('business baseline not certified');
  const item=sql.exec('SELECT quantity FROM f123_business_stock WHERE license = ? AND product_id = ?',
    command.license,command.productId).toArray()[0];
  if(!item||!int(Number(item.quantity)))fail('product not in certified stock');
  sql.exec('UPDATE f123_business_stock SET quantity = ? WHERE license = ? AND product_id = ?',
    command.quantity,command.license,command.productId);
  sql.exec('INSERT INTO f123_business_effects (license,op_id,product_id,quantity_delta,cash_delta_cents) VALUES (?,?,?,?,?)',
    command.license,command.opId,command.productId,command.quantity-Number(item.quantity),0);
  return {applied:true};
}
// Cobro / abono a fiado: 1..balance cents, reduces the receivable and adds cash
// in the same transaction. Effect row reuses product_id for the receivable id.
// Owner, Admin and employee may collect (JFC 2026-11-18).
function applyPayment({sql,txSql,command,principal}){
  if(txSql!==sql||!LICENSE.test(command.license||'')||!IDENT.test(command.receivableId||'')||
     !int(command.amountCents)||command.amountCents<1||
     !principal||principal.license!==command.license||
     !(ownerOrAdmin(principal)||(principal.role==='empleado'&&/^[A-Za-z0-9_-]{5,120}$/.test(principal.subject||'')))||
     !Array.isArray(principal.scopes)||!principal.scopes.includes('ops:payment'))
    fail('unsupported command or principal');
  const baseline=sql.exec('SELECT cash_cents FROM f123_business_baseline WHERE license = ?',command.license).toArray()[0];
  if(!baseline)fail('business baseline not certified');
  const debt=sql.exec('SELECT balance_cents FROM f123_business_receivables WHERE license = ? AND receivable_id = ?',
    command.license,command.receivableId).toArray()[0];
  if(!debt||!int(Number(debt.balance_cents))||Number(debt.balance_cents)<command.amountCents)
    fail('receivable missing or payment exceeds balance');
  const nextCash=BigInt(baseline.cash_cents)+BigInt(command.amountCents);
  if(nextCash>BigInt(MAX))fail('cash overflow');
  sql.exec('UPDATE f123_business_receivables SET balance_cents = balance_cents - ? WHERE license = ? AND receivable_id = ?',
    command.amountCents,command.license,command.receivableId);
  sql.exec('UPDATE f123_business_baseline SET cash_cents = ? WHERE license = ?',Number(nextCash),command.license);
  sql.exec('INSERT INTO f123_business_effects (license,op_id,product_id,quantity_delta,cash_delta_cents) VALUES (?,?,?,?,?)',
    command.license,command.opId,command.receivableId,0,command.amountCents);
  return {applied:true};
}
// Synchronous callback called INSIDE typed-commercial-ledger transactionSync.
// It may not make HTTP calls, await, or use external Yjs/other-DO state.
export function createBusinessSqlExecutor({sql}={}){
  if(typeof sql?.exec!=='function')fail('trusted DO SQL required');
  return function applyBusiness({sql:txSql,command,principal}={}){
    if(command?.kind==='stock.adjust')return applyCount({sql,txSql,command,principal});
    if(command?.kind==='credit.payment.record')return applyPayment({sql,txSql,command,principal});
    if(txSql!==sql||!command||command.kind!=='sale.record'||
       !LICENSE.test(command.license||'')||!IDENT.test(command.productId||'')||
       !int(command.quantity)||command.quantity<1||!int(command.amountCents)||
       !principal||principal.license!==command.license||
       !Array.isArray(principal.scopes)||!principal.scopes.includes('ops:sale')||
       !((principal.role==='dueno'&&principal.subject==='owner-account')||
         ((principal.role==='empleado'||principal.role==='admin')&&
          /^[A-Za-z0-9_-]{5,120}$/.test(principal.subject||''))))
      fail('unsupported command or principal');
    const baseline=sql.exec('SELECT cash_cents FROM f123_business_baseline WHERE license = ?',command.license).toArray()[0];
    if(!baseline)fail('business baseline not certified');
    const item=sql.exec('SELECT quantity,unit_price_cents FROM f123_business_stock WHERE license = ? AND product_id = ?',
      command.license,command.productId).toArray()[0];
    if(!item||!int(Number(item.quantity))||!int(Number(item.unit_price_cents))||
       Number(item.unit_price_cents)<1||Number(item.quantity)<command.quantity)
      fail('product not in certified stock or insufficient stock');
    const expected=BigInt(item.unit_price_cents)*BigInt(command.quantity);
    const nextCash=BigInt(baseline.cash_cents)+BigInt(command.amountCents);
    if(expected!==BigInt(command.amountCents)||nextCash>BigInt(MAX)||nextCash<0n)
      fail('price mismatch or cash overflow');
    sql.exec('UPDATE f123_business_stock SET quantity = quantity - ? WHERE license = ? AND product_id = ? AND quantity >= ?',
      command.quantity,command.license,command.productId,command.quantity);
    const actual=sql.exec('SELECT quantity FROM f123_business_stock WHERE license = ? AND product_id = ?',
      command.license,command.productId).one();
    if(!actual||Number(actual.quantity)!==Number(item.quantity)-command.quantity)
      fail('stock update not committed');
    sql.exec('UPDATE f123_business_baseline SET cash_cents = ? WHERE license = ?',Number(nextCash),command.license);
    sql.exec('INSERT INTO f123_business_effects (license,op_id,product_id,quantity_delta,cash_delta_cents) VALUES (?,?,?,?,?)',
      command.license,command.opId,command.productId,-command.quantity,command.amountCents);
    return {applied:true};
  };
}
