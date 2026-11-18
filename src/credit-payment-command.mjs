// friendly-123 assembled v783: project a previously persisted customer payment
// into a typed, *unsubmitted* commercial inbox command. No network, no
// local write, no role assertion, no ACK and no automatic allocation.
const LICENSE=/^F123-[A-Z0-9*~$=-]{8,34}$/;
const OP_ID=/^customer-payment:[A-Za-z0-9_-]{8,79}$/;
const ID=/^[A-Za-z0-9_-]{1,64}$/;
const MAX_AMOUNT_CENTS=10_000_000_000;

/**
 * Build an immutable inbox command from fresh local ledger readback.
 *
 * readPersistedFacts must read AMG.Hechos.todos() (not a pending UI payment).
 * The server must separately authenticate the license, human and role before
 * accepting any future submission. A stored inbox receipt is not money applied.
 */
export async function creditPaymentCommandFromDurableFact({license,opId,readPersistedFacts}={}){
  if(typeof license!=='string'||!LICENSE.test(license)||
     typeof opId!=='string'||!OP_ID.test(opId)||
     typeof readPersistedFacts!=='function'){
    throw new TypeError('invalid customer-payment readback request');
  }
  // Do not accept the caller's proposed amount or customer; always read the
  // durable, previously committed fact again. Do not cache the selection.
  const facts=await readPersistedFacts();
  if(!Array.isArray(facts))throw new Error('payment facts unavailable');
  const matches=facts.filter(fact=>{
    const data=fact?.datos?.payload||fact?.datos;
    return data && typeof data==='object' && data.opId===opId;
  });
  // A matching cargo, two independent receipts with the same opId, and a
  // missing fact all require manual recovery; NEVER invent a payment.
  if(matches.length!==1)throw new Error('payment fact missing or ambiguous');
  const fact=matches[0];
  const data=fact?.datos?.payload||fact?.datos;
  if(fact.tipo!=='cartera_abono'||!ID.test(data.clienteId||''))
    throw new Error('payment fact type or customer invalid');
  if(data.moneyEngine!==undefined && data.moneyEngine!=='dinero-2.0.2-half-up')
    throw new Error('unsupported payment rounding rule');
  const amount=data.monto;
  // Stored cents—not montoSolicitado, currently-loaded Dinero.js, or a
  // browser float submitted by the caller—are the only amount to project.
  if(typeof amount!=='number'||!Number.isFinite(amount))throw new Error('invalid saved payment amount');
  const amountCents=Math.round(amount*100);
  if(!Number.isSafeInteger(amountCents)||amountCents<1||
     amountCents>MAX_AMOUNT_CENTS||amountCents/100!==amount)
    throw new Error('saved payment is not an exact positive cent amount');
  // A whitelist output prevents leaked PIN, cost, motivo, user or customer
  // contact even if they exist in an old fact's metadata.
  return Object.freeze({
    license,opId,kind:'credit.customer.payment.record',
    clienteId:data.clienteId,amountCents
  });
}
