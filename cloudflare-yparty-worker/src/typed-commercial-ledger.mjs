// Durable-object-only typed commercial INBOX with OPTIONAL synchronous SQL executor.
// Without a trusted adapter it remains an inbox, NOT a sale executor.
// With applyBusiness, the same DO transaction contains opId, payload,
// business effects and receipt; external/Yjs effects are NOT SQL-atomic.
// No WebSocket bridge, public endpoint or PWA is changed by this module.
const KINDS=Object.freeze({
  'sale.record':{scope:'ops:sale',detail:'productId',quantity:true},
  // Physical count ("fijar en N"): quantity is the counted total, never money.
  'stock.adjust':{scope:'ops:adjust',detail:'productId',quantity:true,count:true},
  'expense.record':{scope:'ops:expense',detail:'categoryId',quantity:false},
  'credit.payment.record':{scope:'ops:payment',detail:'receivableId',quantity:false,receivablePayment:true},
  // A customer payment is not a receivable nor a payment allocation.
  // Existing receivable receipts keep their original canonical bytes.
  'credit.customer.payment.record':{scope:'ops:payment',detail:'clienteId',quantity:false,customerPayment:true}
});
const LICENSE=/^F123-[A-Z0-9*~$=-]{8,34}$/;
const ID=/^[A-Za-z0-9_-]{1,64}$/;
const OP_ID=/^[A-Za-z0-9_-]{8,96}$/;
// The browser already commits customer-payment:<uuid>. Never re-key a paid op.
// This syntax is accepted ONLY for the explicit customer-payment contract.
const CUSTOMER_PAYMENT_OP_ID=/^customer-payment:[A-Za-z0-9_-]{8,79}$/;
const MAX_AMOUNT=10_000_000_000;
function validate(command){
  if(!command||typeof command!=='object'||Array.isArray(command))return null;
  const contract=KINDS[command.kind];
  if(!contract || !LICENSE.test(command.license||'') ||
     !(contract.customerPayment
       ? CUSTOMER_PAYMENT_OP_ID.test(command.opId||'')
       : OP_ID.test(command.opId||'')))
    return null;
  const required=['opId','license','kind',contract.detail,'amountCents',...(contract.quantity?['quantity']:[])];
  // Unknown keys are denied rather than accidentally storing PINs, contacts or
  // client-asserted roles. Only a typed, finite, nonnegative amount is accepted.
  if(Object.keys(command).length!==required.length ||
     !Object.keys(command).every(k=>required.includes(k)) ||
     !ID.test(command[contract.detail]||'') ||
     !Number.isSafeInteger(command.amountCents) ||
     command.amountCents<0 || command.amountCents>MAX_AMOUNT ||
     (contract.customerPayment && command.amountCents===0) ||
     (contract.count && command.amountCents!==0) ||
     (contract.quantity && (!Number.isSafeInteger(command.quantity)||
       command.quantity<(contract.count?0:1)||command.quantity>(contract.count?1000000:10000))))
    return null;
  // Canonical order means identical operations hash to identical bytes regardless
  // of caller's JSON property ordering.
  return {
    contract,
    record:{
      license:command.license,opId:command.opId,kind:command.kind,
      [contract.detail]:command[contract.detail],
      ...(contract.quantity?{quantity:command.quantity}:{}),
      amountCents:command.amountCents
    }
  };
}
function fail(status,reason){return {ok:false,status,reason};}
function sha256Hex(buffer){
  return Array.from(new Uint8Array(buffer),x=>x.toString(16).padStart(2,'0')).join('');
}
export function createTypedCommercialLedger({sql,transactionSync,authorize,authorizeCustomer,authorizeReceivable,applyBusiness=null,clock=Date.now}={}){
  if(!sql||typeof sql.exec!=='function'||typeof transactionSync!=='function'||
     typeof authorize!=='function'||typeof clock!=='function'||
     (applyBusiness!==null&&typeof applyBusiness!=='function'))
    throw new TypeError('trusted server-only SQL storage and authorization are required');
  return Object.freeze({
    async submit({ticket,command}={}){
      const validated=validate(command);
      if(!validated)return fail(400,'invalid-command');
      if(typeof ticket!=='string'||ticket.length<8||ticket.length>4096)return fail(403,'not-authorized');
      // Always ask trusted server authority even for duplicate opIds, so a
      // revoked actor cannot read an old receipt with a stale capability.
      let auth;
      try{
        auth=await authorize({ticket,license:validated.record.license,scope:validated.contract.scope});
      }catch(_){return fail(503,'authority-unavailable');}
      const principal=auth?.principal;
      if(auth?.ok!==true||!principal||
         principal.license!==validated.record.license||
         typeof principal.subject!=='string'||!principal.subject||
         !Array.isArray(principal.scopes)||!principal.scopes.includes(validated.contract.scope))
        return fail(403,'not-authorized');
      // 2026-11-16: a payment scope cannot prove ownership of a customer OR
      // legacy receivable. Recheck trusted resource authority before every SQL.
      if(validated.contract.customerPayment || validated.contract.receivablePayment){
        const customer=validated.contract.customerPayment;
        const check=customer?authorizeCustomer:authorizeReceivable;
        const resource=customer?'customer':'receivable';
        if(typeof check!=='function')return fail(503,resource+'-authority-unavailable');
        let member;
        try{
          member=await check({
            license:validated.record.license,
            [validated.contract.detail]:validated.record[validated.contract.detail],
            principal
          });
        }catch(_){return fail(503,resource+'-authority-unavailable');}
        if(member!==true)return fail(403,resource+'-not-authorized');
      }
      let digest,now;
      try{
        const bytes=new TextEncoder().encode(JSON.stringify(validated.record));
        digest=sha256Hex(await crypto.subtle.digest('SHA-256',bytes));
        now=clock();
        if(!Number.isSafeInteger(now)||now<0)throw new Error('clock invalid');
      }catch(_){return fail(503,'processing-unavailable');}
      try{
        // SQLite DO transaction synchronously guards read+insert+receipt on the
        // same storage instance. Atomicity of final stock/cash must be separately
        // established when a typed business executor is wired.
        return transactionSync(()=>{
          sql.exec('CREATE TABLE IF NOT EXISTS typed_commercial_ops (license TEXT NOT NULL, op_id TEXT NOT NULL, payload_hash TEXT NOT NULL, receipt_json TEXT NOT NULL, PRIMARY KEY (license, op_id))');
          // Keep the canonical command bytes in the same DO transaction as the
          // inbox receipt. A digest alone cannot be replayed after a crash.
          // Separate table preserves compatibility with existing receipt rows;
          // historical hash-only rows remain non-executable until recovered.
          sql.exec('CREATE TABLE IF NOT EXISTS typed_commercial_payloads (license TEXT NOT NULL, op_id TEXT NOT NULL, payload_json TEXT NOT NULL, PRIMARY KEY (license, op_id))');
          // In the same DO SQL transaction, a queued op may later become
          // executable. No promise/external effects may escape this boundary.
          const commitBusiness=()=>{
            const result=applyBusiness({sql,command:validated.record,principal});
            if(!result||typeof result.then==='function'||result.applied!==true)
              throw new Error('business-application-not-confirmed');
          };
          const existing=Array.from(sql.exec(
            'SELECT payload_hash, receipt_json FROM typed_commercial_ops WHERE license = ? AND op_id = ?',
            validated.record.license,validated.record.opId))[0];
          if(existing){
            if(existing.payload_hash!==digest)return fail(409,'operation-conflict');
            // Hash-only legacy rows (or a damaged companion row) cannot be
            // replayed safely. Never represent them as recoverable inbox ACKs.
            const saved=Array.from(sql.exec(
              'SELECT payload_json FROM typed_commercial_payloads WHERE license = ? AND op_id = ?',
              validated.record.license,validated.record.opId))[0];
            if(!saved || saved.payload_json!==JSON.stringify(validated.record))
              return fail(409,'operation-recovery-required');
            const receipt=JSON.parse(existing.receipt_json);
            if(!['stored-for-application','business-committed'].includes(receipt.stage)||
               receipt.opId!==validated.record.opId||
               receipt.license!==validated.record.license||receipt.kind!==validated.record.kind)
              throw new Error('receipt corrupt');
            // Preserve queued durable intents across activation/restarts.
            // Only an actual synchronous SQL effect upgrades the old receipt.
            // Updating its status atomically with the stock/cash effects
            // guarantees no double application on subsequent opId retries.
            if(receipt.stage==='stored-for-application'&&applyBusiness!==null){
              commitBusiness();
              const upgraded=Object.freeze({...receipt,stage:'business-committed'});
              sql.exec('UPDATE typed_commercial_ops SET receipt_json = ? WHERE license = ? AND op_id = ?',
                JSON.stringify(upgraded),validated.record.license,validated.record.opId);
              return {ok:true,status:200,duplicate:true,receipt:upgraded};
            }
            return {ok:true,status:200,duplicate:true,receipt};
          }
          // This callback must only mutate SQL on THIS Durable Object.
          // An asynchronous adapter, a failed effect or an external write
          // cannot provide the atomic proof required for a commercial ACK.
          // Throwing here rolls back any balance changes inside transactionSync.
          let stage='stored-for-application';
          if(applyBusiness!==null){
            commitBusiness();
            stage='business-committed';
          }
          const receipt=Object.freeze({
            stage,
            license:validated.record.license,opId:validated.record.opId,
            kind:validated.record.kind,
            receiptId:digest.slice(0,24),acceptedAt:now
          });
          sql.exec('INSERT INTO typed_commercial_ops (license, op_id, payload_hash, receipt_json) VALUES (?, ?, ?, ?)',
            validated.record.license,validated.record.opId,digest,JSON.stringify(receipt));
          // No duplicate writer: both rows commit or roll back together.
          sql.exec('INSERT INTO typed_commercial_payloads (license, op_id, payload_json) VALUES (?, ?, ?)',
            validated.record.license,validated.record.opId,JSON.stringify(validated.record));
          return {ok:true,status:200,duplicate:false,receipt};
        });
      }catch(_){return fail(503,'storage-unavailable');}
    }
  });
}
