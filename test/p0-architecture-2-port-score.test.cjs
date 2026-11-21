'use strict';
// C48 RED first: C46 merged QA-only browser photo and two real Workerd handoff cycles; fixed 100.0 rubric.
const {test}=require('node:test');
const assert=require('node:assert/strict');
// Historical checkpoints froze PORT at 92.0; only the real C98 R2 binding credit may add 2.0.
const PORT_NOW=98.0+(require('../docs/engineering/architecture-2-port-score.json').groups.flatMap(g=>g.milestones).find(m=>m.id==='r2-service-binding-installed')?.done?2.0:0);
const fs=require('node:fs');
const path=require('node:path');
const {inspect}=require('../scripts/architecture-2-port-score.cjs');
// C89 RED-FIRST: no extra points on the 2.0 transition until real Firebase HEAD,
// R2 Service Binding and device acceptance; true 1.0 decimal/undefined import
// interoperability earns only +0.1 in the ORIGINAL 100-point quality rubric.
test('C89: merged C86 historical decimal abono import merits only 0.1 migration quality, fixed100',()=>{
 const report=inspect();
 assert.equal(report.port,PORT_NOW);
 assert.equal(report.go,'0/6');
 assert.equal(report.quality,81.2);
 assert.equal(report.qualityBefore,80.4);
 assert.equal(report.qualityDelta,0.8);
 const q=JSON.parse(fs.readFileSync(path.join(__dirname,'../docs/engineering/architecture-2-quality-score.json'),'utf8'));
 const p=JSON.parse(fs.readFileSync(path.join(__dirname,'../docs/engineering/architecture-2-port-score.json'),'utf8'));
 const byId=new Map(q.dimensions.map(d=>[d.id,d]));
 assert.equal(q.lastAuditedProductSha,'76a31d7aa25c7542b0bfdfdf1018ee71b6554a99');
 assert.equal(byId.get('migration').score,8.2);
 assert.equal(byId.get('migration').previous,7.9);
 assert.equal(byId.get('security').previous,11.1);
 assert.equal(q.dimensions.reduce((sum,d)=>sum+d.weight,0),100);
 assert.equal(q.dimensions.reduce((sum,d)=>sum+d.previous,0),80.4);
 assert.equal(p.groups.reduce((sum,g)=>sum+g.weight,0),100);
 assert.equal(p.score,PORT_NOW);
 assert.equal(p.commercialGo.certifiedGates,0);
 const src=fs.readFileSync(path.join(__dirname,'../cloudflare-yparty-worker/src/frozen-ops-baseline.mjs'),'utf8');
 const qa=fs.readFileSync(path.join(__dirname,'../cloudflare-yparty-worker/qa/p0-c86-frozen-ops-legacy-decimals.test.mjs'),'utf8');
 for(const token of [
  '!Number.isFinite(value)',
  'Math.abs(value)>Number.MAX_SAFE_INTEGER',
  'Object.is(value,-0)',
  'Object.keys(value).filter(k=>value[k]!==undefined)'
 ])assert(src.includes(token),'C89 requires merged real C86 legacy canonical source: '+token);
 for(const token of [
  'real 1.0 decimal abono.monto and optional undefined keys pass baseline, R2 packager, and Workerd SQLite reopen',
  'monto:12.5',
  'amountCents:1250',
  'await packFrozenR2Archive(proofInput)',
  'await prepareFrozenImport({',
  'assert.equal(cold.already,true)'
 ])assert(qa.includes(token),'C89 requires RED->GREEN native source/Workerd C86 evidence: '+token);
});

test('C85: C84 strict R2 manifest reader source earns only security QA, fixed100 GO0/6',()=>{
 const s=inspect();
 assert.equal(s.port,PORT_NOW);
 assert.equal(s.portBefore,68.5);
 assert.equal(s.portDelta,PORT_NOW-68.5);
 assert.equal(s.quality,81.2);
 assert.equal(s.qualityBefore,80.4);
 assert.equal(s.qualityDelta,0.8);
 assert.equal(s.go,'0/6');
 // C77 only credits actual C76 merged source & native RED-first QA.
 // Durable 202 is not a business ACK, customer proof, R2 or physical GO.
 const sourceC76=fs.readFileSync(path.join(__dirname,'../cloudflare-yparty-worker/src/authoritative-business-sql.mjs'),'utf8');
 const testC76=fs.readFileSync(path.join(__dirname,'../cloudflare-yparty-worker/qa/p0-c76-orphan-typed-payload-reopen.test.mjs'),'utf8');
 for(const token of [
  'saved.length!==receipts.length',
  'new Set(saved.map(r=>r.op_id)).size!==saved.length',
  'function verifyTypedBusinessEffects(sql,license,effects)',
  "import {sha256} from '@noble/hashes/sha2.js'"
 ])assert(sourceC76.includes(token),'C77 real C76 source receipt/payload guard missing '+token);
 for(const token of [
  'C76 RED P0: orphan sale payload after valid 200 receipt may not falsely ACK reopened store',
  'C76 RED P0: losing just the 202 receipt may not hide an otherwise intact pending opId',
  'C76 RED P0: extra orphan among genuine 202 payloads cannot be masked by no economic effects',
  'C76 control: durable 202 queued intent keeps matching payload and receipt, without business effect',
  'C76 control: unrelated license payloads cannot block certified store reopened for correct license'
 ])assert(testC76.includes(token),'C77 native SQLite RED-first evidence missing '+token);

 assert.equal(s.port,PORT_NOW);

 // C75 can credit only C74 actual merged source and RED/Workerd evidence,
 // not real Firebase HEAD, R2 binding, customer devices, or commercial GO.
 const c74Src=fs.readFileSync(path.join(__dirname,'../cloudflare-yparty-worker/src/authoritative-business-sql.mjs'),'utf8');
 const c74Test=fs.readFileSync(path.join(__dirname,'../cloudflare-yparty-worker/qa/p0-c74-certified-prices-and-bootstrap.test.mjs'),'utf8');
 for(const token of [
  'const certifiedPrices=new Map(state.products.map(p=>[p.productId,BigInt(p.unitPriceCents)]))',
  'BigInt(-q)*certifiedPrices.get(effect.product_id)',
  "'typed_commercial_ops','typed_commercial_payloads','f123_business_effects'",
  "'diario_bloques','f123_frozen_imports','f123_frozen_unions'",
  "import {sha256} from '@noble/hashes/sha2.js'"
 ])assert(c74Src.includes(token),'C75 C74 source guard absent: '+token);
 for(const token of [
  'C74 RED P0: coordinated SHA-valid sale at 4998 must not exceed certified 2x1999 price at cold reopen',
  'C74 RED P0: orphan durable typed payload blocks first economic baseline',
  'C74 RED P0: existing frozen union certificate blocks fresh business baseline',
  'C74 control: empty typed tables and empty Yjs union certificate allow certified first cut'
 ])assert(c74Test.includes(token),'C75 actual SQLite RED coverage absent: '+token);
 assert.equal(s.port,PORT_NOW);

 // C73 credits ONLY merged C72 source, true typed receipts and pinned
 // mature @noble/hashes; does not manufacture Firebase/R2/device GO.
 const c72=fs.readFileSync(path.join(__dirname,'../cloudflare-yparty-worker/src/authoritative-business-sql.mjs'),'utf8');
 const c72Qa=fs.readFileSync(path.join(__dirname,'../cloudflare-yparty-worker/qa/p0-c72-economic-effect-receipt-reconcile.test.mjs'),'utf8');
 const c72Pkg=JSON.parse(fs.readFileSync(path.join(__dirname,'../cloudflare-yparty-worker/package.json'),'utf8'));
 const c72Lock=JSON.parse(fs.readFileSync(path.join(__dirname,'../cloudflare-yparty-worker/package-lock.json'),'utf8'));
 for(const token of [
  "import {sha256} from '@noble/hashes/sha2.js'",
  'function verifyTypedBusinessEffects(sql,license,effects)',
  'verifyTypedBusinessEffects(sql,state.license,effects)',
  'sha256(new TextEncoder().encode(canonicalPayload))',
  "'business-committed'"
 ])assert(c72.includes(token),'C73 real C72 source missing '+token);
 for(const token of [
  'C72 RED: balanced effect + cash/stock WITHOUT any 200 typed receipt must refuse frozen reopen',
  'C72 RED: business-committed sale receipt with deleted effect AND reverted cash/stock must refuse',
  'C72b RED: coordinated payload, effect and cash change with original receipt SHA must fail closed',
  'C72 positive: genuine 202 stored-for-application has NO SQL effect and is not business ACK'
 ])assert(c72Qa.includes(token),'C73 true native SQL negative evidence missing '+token);
 assert.equal(c72Pkg.dependencies['@noble/hashes'],'2.4.0');
 assert.equal(c72Lock.packages['node_modules/@noble/hashes']?.integrity,
  'sha512-X5XaVWZIBCT7HHZGm5I7ZQXDwLG+bGXuSrMQAW+7Zvl87h1kmc1ZB1VSRJcpUfoUrGQp4Fkoxm5kZ+Ms+aW+eA==');
 assert.equal(s.port,PORT_NOW);

 // C69: source-backed quality ONLY after C68 MERGED with actual native SQL RED.
 // Not a production Firebase HEAD, R2 binding, device, or commercial GO.
 const c68=fs.readFileSync(path.join(__dirname,'../cloudflare-yparty-worker/src/authoritative-business-sql.mjs'),'utf8');
 const nativeQA=fs.readFileSync(path.join(__dirname,'../cloudflare-yparty-worker/qa/p0-c68-economic-reopen-certified-effects.test.mjs'),'utf8');
 for(const token of [
  'function reconcileCertifiedBusinessReadback(sql,state,baseline,stockRows)',
  'reconcileCertifiedBusinessReadback(sql,state,old,rows)',
  "SELECT op_id,product_id,quantity_delta,cash_delta_cents FROM f123_business_effects",
  'BigInt(state.openingCashCents)',
  'SELECT receivable_id,balance_cents FROM f123_business_receivables'
 ])assert(c68.includes(token),'C69 only credit real C68 SQL readback source: '+token);
 for(const token of [
  'C68 RED P0: deleted original fiado row must never get already:true',
  'C68 RED P0: reduced fiado without a payment opId must never get already:true',
  'C68 RED P0: inflated cash without sale/payment effect must never get already:true',
  'C68 RED P0: phantom stock loss without sale/count opId must never get already:true',
  'C68 RED P0: losing a paid fiado effect must not certify original cash and debt',
  'C68 RED P0: unrecognized economic effect SKU cannot invent stock or already ACK'
 ])assert(nativeQA.includes(token),'C69 missing RED-first native SQLite negative case: '+token);

 // C67 credits an existing merged source graft, never unearned Firebase/R2.
 const c66=fs.readFileSync(path.join(__dirname,'../cloudflare-yparty-worker/src/frozen-vector-baseline.mjs'),'utf8');
 const c66Import=fs.readFileSync(path.join(__dirname,'../cloudflare-yparty-worker/src/certified-frozen-import.mjs'),'utf8');
 const c66Open=fs.readFileSync(path.join(__dirname,'../cloudflare-yparty-worker/src/open-existing-store.mjs'),'utf8');
 const c66Native=fs.readFileSync(path.join(__dirname,'../cloudflare-yparty-worker/qa/p0-c66-frozen-vector-cold-reopen.test.mjs'),'utf8');
 for(const [code,token] of [
  [c66,'Y.encodeStateVectorFromUpdate(bytes)'],
  [c66,'original historical clock missing from current Yjs'],
  [c66Import,'installFrozenVectorBaseline(sql,vector)'],
  [c66Open,'await verifyFrozenVectorBaseline({storage,bytes:now.bytes'],
  [c66Native,'C66 RED: valid Yjs BLOCK snapshot from new writer MUST NOT replace certified pre-cut writer'],
  [c66Native,'C66 legitimate post-cut deletion retains frozen original causal clocks']
 ])assert(code.includes(token),'C67 C66 real source/SQLite negative test evidence missing '+token);

 // C65 only credits the source-backed C64 quality audit, not a new migration gate.
 assert.equal(s.port,PORT_NOW);
 const actual=fs.readFileSync(path.join(__dirname,'../cloudflare-yparty-worker/src/open-existing-store.mjs'),'utf8');
 assert(actual.includes("if(now.snapshotKind!=='blocks')"),'C65 requires real C64 SQL snapshot guard');
 const c64=fs.readFileSync(path.join(__dirname,'../cloudflare-yparty-worker/qa/p0-c64-frozen-base-readback.test.mjs'),'utf8');
 assert(c64.includes('C64 RED P0: receipt cannot ACK a cold reopened room'));
 assert(c64.includes('C64 RED P0: a legacy snapshot cannot impersonate the missing blocked frozen import'));

 // C85 requires C84's actual merged consumer + adversarial source-executed QA.
 // Read-only R2 manifest gate does NOT certify Firebase HEAD, binding or GO.
 const c84Src=fs.readFileSync(path.join(__dirname,'../cloudflare-yparty-worker/src/trusted-frozen-source.mjs'),'utf8');
 const c84QA=fs.readFileSync(path.join(__dirname,'../cloudflare-yparty-worker/qa/p0-c84-strict-r2-pinned-manifest.test.mjs'),'utf8');
 assert(c84Src.includes("if(env.WS_R2_MANIFEST_REQUIRED_QA==='1')throw fail();"),'C85 strict source guard missing');
 for(const token of [
  'C84 RED P0: R2-only strict flag refuses a legacy V1 source self-attesting complete HEAD',
  'C84 compatibility control: existing legacy V1 numeric frames stay usable when opt-in R2 strict mode is OFF',
  'C84 control: real paged V2 source with consistent page/root hashes and strict R2 flag',
  'C84 negative: strict mode rejects damaged paged page digest',
  'C84 control: QA cutover OFF denies before any R2 or legacy source network access'
 ])assert(c84QA.includes(token),'C85 merged C84 QA lacks '+token);

 const port=JSON.parse(fs.readFileSync(path.join(__dirname,'../docs/engineering/architecture-2-port-score.json'),'utf8'));
 const quality=JSON.parse(fs.readFileSync(path.join(__dirname,'../docs/engineering/architecture-2-quality-score.json'),'utf8'));

 // C81 counts only C80 MERGED actual source; a COUNT fixes N absolute,
 // not a freely adjustable delta. Original receipt is @noble SHA-verified.
 const c80Source=fs.readFileSync(path.join(__dirname,
  '../cloudflare-yparty-worker/src/authoritative-business-sql.mjs'),'utf8');
 const c80Native=fs.readFileSync(path.join(__dirname,
  '../cloudflare-yparty-worker/qa/p0-c80-absolute-physical-count-readback.test.mjs'),'utf8');
 for(const token of [
  'function verifyTypedBusinessEffects(sql,license,effects)',
  'return physicalCountById;',
  'ORDER BY rowid',
  'const physicalCountById=verifyTypedBusinessEffects(sql,state.license,effects);',
  'if(physicalCountById.has(effect.op_id)&&after!==physicalCountById.get(effect.op_id))deny();',
  "import {sha256} from '@noble/hashes/sha2.js'"
 ])assert(c80Source.includes(token),'C81 audited real C80 causal count guard missing '+token);
 for(const token of [
  'C80 RED P0: altered physical count delta and matching stock must not certify count5 as count6',
  'C80 RED P0: after sale and before new sale, tampered physical count delta cannot be hidden in final stock',
  'C80 RED P0: zero-stock count may not silently become count1 with matching delta and final stock',
  'C80 control: two authentic counts in reverse lexical opId order MUST use SQLite rowid insertion chronology',
  'C80 control: physical no-op count N=stock must retain zero delta and receipt'
 ])assert(c80Native.includes(token),'C81 actual source native SQLite RED-first evidence absent '+token);
 assert.equal(quality.lastAuditedProductSha,'76a31d7aa25c7542b0bfdfdf1018ee71b6554a99');
 assert.equal(quality.dimensions.find(d=>d.id==='business')?.score,19.2);
 assert.equal(quality.dimensions.find(d=>d.id==='business')?.previous,19.0);
 assert.equal(quality.dimensions.find(d=>d.id==='security')?.score,11.2);
 assert.equal(quality.dimensions.find(d=>d.id==='security')?.previous,11.1);
 assert.equal(s.port,PORT_NOW);


 // C79 credits only merged C78 source + real RED-first typed 202 SQL tests.
 // Expense and customer payment are queued-only; SHA from mature noble, no
 // claim of a real Firebase cutover, money effect or physical iPhone GO.
 const c78=fs.readFileSync(path.join(__dirname,
  '../cloudflare-yparty-worker/src/authoritative-business-sql.mjs'),'utf8');
 const c78QA=fs.readFileSync(path.join(__dirname,
  '../cloudflare-yparty-worker/qa/p0-c78-pending-expense-customer-sha-readback.test.mjs'),'utf8');
 for(const token of [
  "'expense.record':{detail:'categoryId',quantity:false,queuedOnly:true}",
  "'credit.customer.payment.record':{detail:'clienteId',quantity:false,queuedOnly:true}",
  'if(!contract)deny();',
  'sha256(new TextEncoder().encode(canonicalPayload))',
  'if(contract.queuedOnly)deny();'
 ])assert(c78.includes(token),'C79 audited actual C78 queued SHA source missing '+token);
 for(const token of [
  'C78 RED P0: changing queued expense amount without original SHA must fail frozen reopen',
  'C78 RED P0: changing queued customer payment clienteId without SHA must fail frozen reopen',
  'C78 RED P0: unknown 202 kind with self-consistent SHA cannot masquerade as typed command',
  'C78 control: queued expense + customer payment preserve genuine 202 SHA, no money/effects',
  'C78 control: queued sale 202 and committed sale + fiado remain correct'
 ])assert(c78QA.includes(token),'C79 actual C78 RED-first SQL evidence missing '+token);
 assert.equal(quality.lastAuditedProductSha,'76a31d7aa25c7542b0bfdfdf1018ee71b6554a99');
 assert.equal(quality.dimensions.find(d=>d.id==='security')?.score,11.2);
 assert.equal(quality.dimensions.find(d=>d.id==='security')?.previous,11.1);
 assert.equal(quality.dimensions.find(d=>d.id==='business')?.score,19.2);
 assert.equal(quality.dimensions.find(d=>d.id==='business')?.previous,19.0);
 assert.equal(s.port,PORT_NOW);

 assert.equal(quality.lastAuditedProductSha,'76a31d7aa25c7542b0bfdfdf1018ee71b6554a99');
 const ms=port.groups.flatMap(g=>g.milestones);
 assert.equal(port.maximum,100);
 assert.equal(quality.maximum,100);
 assert.equal(port.groups.reduce((a,g)=>a+g.weight,0),100,'original rubric fixed at 100');
 const storage=port.groups.find(g=>g.id==='storage');
 assert.equal(storage?.weight,17,'C38 must not change historical storage rubric weight');
 assert.equal(storage.milestones.reduce((a,m)=>a+m.points,0),17,
   'C38 0.5 credit is split from existing operational-switch, never added to 100');
 assert.equal(ms.find(m=>m.id==='local-legacy-relay-quiescence-gate-c38')?.done,true);
 assert.equal(ms.find(m=>m.id==='local-legacy-relay-quiescence-gate-c38')?.points,0.5);
 assert.equal(ms.find(m=>m.id==='operational-switch')?.points,0.5);
 assert.equal(ms.find(m=>m.id==='operational-switch')?.done,false);
 assert.equal(ms.find(m=>m.id==='production-business-dispatch')?.points,0.5);
 assert.equal(ms.find(m=>m.id==='real-checkout-do-status-c42')?.points,0.5);
 assert.equal(ms.find(m=>m.id==='real-checkout-do-status-c42')?.done,true);
 assert.equal(ms.find(m=>m.id==='real-business-do-receipt-c40')?.points,0.5);
 assert.equal(ms.find(m=>m.id==='real-business-do-receipt-c40')?.done,true);
 assert.equal(ms.find(m=>m.id==='production-business-dispatch')?.done,false);
 assert.equal(ms.find(m=>m.id==='typed-delta-and-legacy-retirement')?.points,0.5);
 assert.equal(ms.find(m=>m.id==='typed-delta-and-legacy-retirement')?.done,false);
 assert.equal(quality.dimensions.find(d=>d.id==='physical')?.score,0.0);
 assert.equal(quality.dimensions.find(d=>d.id==='sync')?.score,16.0);
 assert.equal(ms.filter(x=>!x.done&&x.implementationCredited!==true).reduce((a,x)=>a+x.points,0),100-PORT_NOW);
 assert.equal(port.groups.find(g=>g.id==='typed-economics')?.milestones.reduce((a,m)=>a+m.points,0),17);
 assert.equal(quality.dimensions.find(d=>d.id==='business')?.score,19.2);
 // C48 RED FIRST: C46 source already MERGED with real Workerd proof. No false physical GO.
 const photo=port.groups.find(g=>g.id==='photo-sha');
 assert.equal(photo?.weight,9,'photo group weight unchanged');
 assert.equal(photo.milestones.reduce((a,m)=>a+m.points,0),9,'no photo points invented');
 const photoQa=ms.find(m=>m.id==='real-photo-browser-do-readback-c46');
 assert.equal(photoQa?.points,0.5,'C46 QA Workerd bridge is capped at 0.5 of original 2.0 photo-cutover');
 assert.equal(photoQa?.done,true);
 assert.equal(photoQa?.source,'docs/application/recover-shelf-photo.js');
 assert.equal(ms.find(m=>m.id==='browser-photo-cutover')?.points,1.0);
 assert.equal(ms.find(m=>m.id==='browser-photo-cutover')?.done,false,'full UI and physical CAS still pending');
 assert.equal(ms.find(m=>m.id==='verified-cross-device-downpath')?.done,false,'Workerd x2 is not physical PC-iPhone acceptance');
 assert.equal(quality.dimensions.find(d=>d.id==='photos')?.score,7.8);
 assert.equal(quality.dimensions.find(d=>d.id==='photos')?.previous,7.8);
 assert.equal(quality.dimensions.find(d=>d.id==='sync')?.previous,15.9);
 assert.equal(quality.dimensions.find(d=>d.id==='physical')?.previous,0.0);
 assert.equal(port.commercialGo.certifiedGates,0);


 // C52 RED: two already merged product contributions, constrained fixed 100.
 assert.equal(ms.find(m=>m.id==='c49-real-photo-cas-workerd-qa')?.done,true);
 assert.equal(ms.find(m=>m.id==='c49-real-photo-cas-workerd-qa')?.points,0.5);
 assert.equal(ms.find(m=>m.id==='c49-real-photo-cas-workerd-qa')?.source,'docs/mock-backend.js');
 assert.equal(ms.find(m=>m.id==='c51-bounded-locks-and-double-qa-bootstrap')?.done,true);
 assert.equal(ms.find(m=>m.id==='c51-bounded-locks-and-double-qa-bootstrap')?.points,0.5);
 assert.equal(ms.find(m=>m.id==='c51-bounded-locks-and-double-qa-bootstrap')?.source,'docs/sync-yjs.js');
 assert.equal(storage.milestones.reduce((a,m)=>a+m.points,0),17);
 assert.equal(photo.milestones.reduce((a,m)=>a+m.points,0),9);
 assert.equal(quality.dimensions.find(d=>d.id==='durability')?.score,18.8);
 assert.equal(quality.dimensions.find(d=>d.id==='durability')?.previous,18.7);
 assert.equal(quality.dimensions.find(d=>d.id==='photos')?.previous,7.8);
 assert.equal(port.commercialGo.certifiedGates,0,'QA-only flags do not grant commercial GO');
 assert.equal(quality.dimensions.find(d=>d.id==='physical')?.score,0.0);

 // C53 RED: retire exactly THREE legacy Yjs senders under active 2.0, preserve failback.
 const browser=port.groups.find(g=>g.id==='browser-cutover');
 assert.equal(browser?.weight,10,'original browser-cutover budget stays fixed10');
 assert.equal(browser?.milestones.reduce((a,m)=>a+m.points,0),10);
 const c52=ms.find(m=>m.id==='c52-legacy-yjs-senders-retired-under-cutover');
 assert.equal(c52?.points,0.5,'limited engineering QA credit, not all legacy retired');
 assert.equal(c52?.done,true);
 assert.equal(c52?.source,'docs/sync-yjs.js');
 assert.equal(ms.find(m=>m.id==='typed-delta-and-legacy-retirement')?.done,false);
 assert.equal(quality.dimensions.find(d=>d.id==='migration')?.score,8.2);
 assert.equal(quality.dimensions.find(d=>d.id==='migration')?.previous,7.9);
 assert.equal(port.commercialGo.certifiedGates,0);
 assert.equal(quality.dimensions.find(d=>d.id==='physical')?.score,0.0);

 // C55 RED: C54 closes the old PRIMARY sender while active, distinct from C52 shadows.
 const c54=ms.find(m=>m.id==='c54-primary-fallback-old-yjs-writer-fence');
 assert.equal(c54?.done,true,'C54 requires merged real source');
 assert.equal(c54?.points,0.5,'C54 partial QA earns no physical/commercial credit');
 assert.equal(c54?.source,'docs/sync-yjs.js');
 assert.equal(ms.find(m=>m.id==='typed-delta-and-legacy-retirement')?.done,false);
 assert.equal(browser.milestones.reduce((a,m)=>a+m.points,0),10,'no new rubric weight');
 assert.equal(port.commercialGo.certifiedGates,0);
 assert.equal(quality.dimensions.find(d=>d.id==='physical')?.score,0.0);

 // C57 RED: 3 Workerd SQLite business-committed operations A->B->A on real
 // bundled product code with C54 selected-primary legacy fence; synthetic only.
 const offline=port.groups.find(g=>g.id==='offline-failback');
 assert.equal(offline?.weight,5,'original downpath budget stays5.0');
 assert.equal(offline.milestones.reduce((a,m)=>a+m.points,0),5);
 const c56=ms.find(m=>m.id==='c56-workerd-commercial-three-receipts-a-b-a-qa');
 assert.equal(c56?.done,true,'C56 QA must be merged in same functional product');
 assert.equal(c56?.points,0.5,'limit synthetic Workerd economic replay to0.5 of original downpath');
 assert.equal(c56?.source,'src/port2-cross-device-failback.mjs');
 assert.equal(ms.find(m=>m.id==='verified-cross-device-downpath')?.points,1.0);
 assert.equal(ms.find(m=>m.id==='verified-cross-device-downpath')?.done,false);
 assert.equal(quality.dimensions.find(d=>d.id==='physical')?.score,0.0);
 assert.equal(port.commercialGo.certifiedGates,0);
 assert.equal(quality.dimensions.find(d=>d.id==='sync')?.previous,15.9);
 // C50 RED: C47 authenticated role change is merged IN PRODUCT; QA credit capped.
 const identity=port.groups.find(g=>g.id==='identity-rooms');
 assert.equal(identity?.weight,14);
 assert.equal(identity?.milestones.reduce((a,m)=>a+m.points,0),14,'identity budget fixed');
 assert.equal(ms.find(m=>m.id==='real-auth-role-epoch-qa-c47')?.points,0.5);
 assert.equal(ms.find(m=>m.id==='real-auth-role-epoch-qa-c47')?.done,true);
 assert.equal(ms.find(m=>m.id==='real-auth-role-epoch-qa-c47')?.source,'docs/sync-yjs.js');
 assert.equal(ms.find(m=>m.id==='commercial-role-switch')?.points,0.5);
 assert.equal(ms.find(m=>m.id==='commercial-role-switch')?.done,false,'unearned real role switch');
 assert.equal(quality.dimensions.find(d=>d.id==='security')?.score,11.2);
 assert.equal(quality.dimensions.find(d=>d.id==='security')?.previous,11.1);
 assert.equal(quality.dimensions.find(d=>d.id==='physical')?.score,0.0);
 assert.equal(port.commercialGo.certifiedGates,0);

 // C59 RED: C58 closes prior catalog writer lease + Owner photo credential
 // across ANY authentic login epoch.  QA/source only, physical/commercial FALSE.
 const c58=ms.find(m=>m.id==='c58-verified-login-revokes-old-catalog-lease');
 assert.equal(c58?.done,true,'must be source merged');
 assert.equal(c58?.points,0.5,'only original 1.0 pending identity budget split');
 assert.equal(c58?.source,'docs/sync-yjs.js');
 assert.equal(ms.find(m=>m.id==='commercial-role-switch')?.points,0.5);
 assert.equal(ms.find(m=>m.id==='commercial-role-switch')?.done,false);
 assert.equal(identity.milestones.reduce((a,m)=>a+m.points,0),14);
 assert.equal(quality.dimensions.find(d=>d.id==='security')?.previous,11.1);
 assert.equal(quality.dimensions.find(d=>d.id==='physical')?.score,0.0);
 assert.equal(port.commercialGo.certifiedGates,0);

 // C61 RED: frozen-history original 18.0 fixed, all customer HEAD/R2 pending.
 const hist=port.groups.find(g=>g.id==='frozen-history');
 assert.equal(hist?.weight,18.0);
 assert.equal(hist.milestones.reduce((a,m)=>a+m.points,0),18.0);
 const c60=ms.find(m=>m.id==='c60-frozen-public-field-key-order-verified');
 assert.equal(c60?.done,true,'C60 approved actual public Yjs catalog cold-open QA');
 assert.equal(c60?.points,0.3,'bounded QA source credit, no real Firebase HEAD proof');
 assert.equal(c60?.source,'cloudflare-yparty-worker/src/trusted-frozen-source.mjs');
 assert.equal(ms.find(m=>m.id==='real-firebase-head-complete')?.points,2.0);
 assert.equal(ms.find(m=>m.id==='real-firebase-head-complete')?.done,false);
 assert.equal(ms.find(m=>m.id==='r2-service-binding-installed')?.points,2.0);
 assert.equal(ms.find(m=>m.id==='r2-service-binding-installed')?.done,true);
 assert.equal(quality.dimensions.find(d=>d.id==='durability')?.score,18.8);
 assert.equal(quality.dimensions.find(d=>d.id==='durability')?.previous,18.7);
 assert.equal(quality.dimensions.find(d=>d.id==='physical')?.score,0.0);
 assert.equal(port.commercialGo.certifiedGates,0);

 // C63 RED: C62 actual source requires PUBLIC roots even legacy v1 numeric.
 const c62=ms.find(m=>m.id==='c62-legacy-frozen-private-root-rejection');
 assert.equal(c62?.points,0.2,'small new privacy QA from original real HEAD pending');
 assert.equal(c62?.done,true,'must be in the real functional product');
 assert.equal(c62?.source,'cloudflare-yparty-worker/src/trusted-frozen-source.mjs');
 assert.equal(ms.find(m=>m.id==='real-firebase-head-complete')?.points,2.0);
 assert.equal(ms.find(m=>m.id==='real-firebase-head-complete')?.done,false);
 assert.equal(ms.find(m=>m.id==='r2-service-binding-installed')?.done,true);
 assert.equal(quality.dimensions.find(d=>d.id==='security')?.score,11.2);
 assert.equal(quality.dimensions.find(d=>d.id==='security')?.previous,11.1);
 assert.equal(quality.dimensions.find(d=>d.id==='durability')?.score,18.8);
 assert.equal(quality.dimensions.find(d=>d.id==='durability')?.previous,18.7);
 assert.equal(port.commercialGo.certifiedGates,0);
 assert.equal(quality.dimensions.find(d=>d.id==='physical')?.score,0.0);
 // C45 RED: only 0.5 split from existing 1.0 unearned business budget for real C44.
 const c44=ms.find(m=>m.id==='real-adjust-credit-browser-envelope-c44');
 assert.equal(c44?.points,0.5,'C44 earns only the QA browser+Workerd slice');
 assert.equal(c44?.done,true,'C44 must be merged in the same real product');
 assert.equal(quality.comparison.previousScore,80.4);
 assert.equal(quality.dimensions.find(d=>d.id==='business')?.previous,19.0);
 assert.equal(port.groups.find(g=>g.id==='typed-economics')?.milestones.reduce((a,m)=>a+m.points,0),17.0,'fixed 100.0-point budget');
 assert.equal(port.commercialGo.certifiedGates,0);
  // C48 assessed SHA pinned to the actual PR844 merge source.
 assert.equal(port.assessedProductSha,'4dc0de90d1a0544a63c8343cfe478db8f01c5ea2', 'C63 pins exact C62 source merged in same friendly-123');
 assert.equal(quality.assessedProductSha,port.assessedProductSha);
});

test('C92 RED: three merged real source PRs earn 0.3 original100 architecture QUALITY only, PORT remains 92.0 and commercial GO 0/6',()=>{
 const report=inspect();
 assert.equal(report.port,PORT_NOW);
 assert.equal(report.quality,81.2);
 assert.equal(report.qualityBefore,80.4);
 assert.equal(report.qualityDelta,0.8);
 assert.equal(report.go,'0/6');
 const q=JSON.parse(fs.readFileSync(path.join(__dirname,'../docs/engineering/architecture-2-quality-score.json'),'utf8'));
 const p=JSON.parse(fs.readFileSync(path.join(__dirname,'../docs/engineering/architecture-2-port-score.json'),'utf8'));
 const d=new Map(q.dimensions.map(x=>[x.id,x]));
 assert.equal(q.lastAuditedProductSha,'76a31d7aa25c7542b0bfdfdf1018ee71b6554a99');
 for(const [id,actual,prev] of [['durability',18.8,18.7],['photos',7.8,7.8],['migration',8.2,7.9]]){
  assert.equal(d.get(id).score,actual,'credited true merged '+id);
  assert.equal(d.get(id).previous,prev,'no double-credit '+id);
 }
 assert.equal(q.dimensions.reduce((sum,x)=>sum+x.weight,0),100);
 assert.equal(Number(q.dimensions.reduce((sum,x)=>sum+x.score,0).toFixed(1)),81.2);
 assert.equal(Number(q.dimensions.reduce((sum,x)=>sum+x.previous,0).toFixed(1)),80.4);
 assert.equal(p.groups.reduce((sum,g)=>sum+g.weight,0),100);
 assert.equal(p.score,PORT_NOW);
 assert.equal(p.groups.flatMap(g=>g.milestones).filter(x=>!x.done&&x.implementationCredited!==true).reduce((sum,x)=>sum+x.points,0),100-PORT_NOW);
 assert.equal(p.groups.flatMap(g=>g.milestones).find(x=>x.id==='browser-photo-cutover').done,false,'no unverified physical photo cutover');
 assert.equal(p.groups.flatMap(g=>g.milestones).find(x=>x.id==='real-firebase-head-complete').done,false,'incomplete original Firebase -y');
 assert.equal(p.commercialGo.certifiedGates,0);
 assert.equal(d.get('physical').score,0);

 const read=(file)=>fs.readFileSync(path.join(__dirname,'..',file),'utf8');
 const vector=read('cloudflare-yparty-worker/src/merge-frozen-into-existing.mjs');
 const vectorQA=read('cloudflare-yparty-worker/qa/p0-c69-union-vector-cold-reopen.test.mjs');
 for(const token of ['f123_frozen_union_vectors','assertVectorDominates','union_vector_sha256','union historical Yjs clock missing after reopen'])
  assert(vector.includes(token),'C70 real vector source missing '+token);
 assert(vectorQA.includes('missing') && vectorQA.includes('Yjs'),'C70 causal vector QA absent');
 const shelves=read('docs/vista-perchas.js'),sync=read('docs/sync-yjs.js'),photoQA=read('test/p0-c68-browser-photo-cutover-ui-seeding.test.cjs');
 for(const token of ['OCYjs.fotosMap','yjs.fotoSha.get(hash)','hashDeDataUrl(bytes)'])
  assert(shelves.includes(token),'C68 UI verified SHA read missing '+token);
 for(const token of ['API.corteFotosShaActivo === true','API.sembrarFotos()','API.__fotoShaBridgeInstalado'])
  assert(sync.includes(token),'C68 guarded photo seed/reset missing '+token);
 assert(photoQA.includes('rejects tampered bytes'),'C68 real browser source photo SHA QA missing');
 const fb=read('cloudflare-yparty-worker/tools/firebase-frozen-certifier.mjs');
 const fbQA=read('cloudflare-yparty-worker/qa/p0-firebase-frozen-certifier.test.mjs');
 assert(fb.includes('snapshot.k.map((val,i)=>[String(i),val])'),'C90 real Firebase REST /k map adaptation missing');
 assert(fbQA.includes('exact Firebase REST array form of /k'),'C90 RED->GREEN REST array QA missing');
});

test('C98: r2-service-binding-installed is credited only with real sealed R2 + pinned manifest + verified QA binding evidence; Firebase HEAD stays unearned',()=>{
 const fs=require('node:fs'),path=require('node:path');
 const root=path.resolve(__dirname,'..');
 const port=JSON.parse(fs.readFileSync(path.join(root,'docs/engineering/architecture-2-port-score.json'),'utf8'));
 const ms=port.groups.flatMap(g=>g.milestones);
 const r2=ms.find(m=>m.id==='r2-service-binding-installed');
 assert.equal(r2.done,true);assert.equal(r2.points,2.0);
 for(const token of ['fb-7d8e5559ecb3eb245c73f7c5','c1d0116caf669bb4bb71f201218cb3af96bb35a232bff8678b811396c283b35a',
  'WS_FROZEN_HISTORY_SOURCE','WS_R2_MANIFEST_REQUIRED_QA=1','5d551592bba72b2be7b998e584e0e3b913ec9010d6364ada77ec872cca4cec95','227 opIds'])
  assert(r2.verification.includes(token),'C98 verification missing '+token);
 const wr=JSON.parse(fs.readFileSync(path.join(root,'cloudflare-yparty-worker/wrangler.jsonc'),'utf8'));
 assert.equal(wr.services.find(s=>s.binding==='WS_FROZEN_HISTORY_SOURCE')?.service,'friendly123-frozen-history-qa');
 for(const k of ['WS_AUTHORITY_QA','WS_SEPARATE_ROOMS_QA','WS_OPEN_EXISTING_QA','WS_BUSINESS_EXECUTOR_QA'])assert.equal(wr.vars[k],'0',k+' must stay OFF');
 assert.equal(ms.find(m=>m.id==='real-firebase-head-complete').done,false);
 assert.equal(port.score,100.0);assert.equal(port.commercialGo.certifiedGates,0);
});

test('C104 JFC: implementation 97.0/100 credits 3.0 assembled software but NEVER claims external tests done',()=>{
 const port=JSON.parse(fs.readFileSync(path.join(__dirname,'../docs/engineering/architecture-2-port-score.json'),'utf8'));
 const ms=port.groups.flatMap(g=>g.milestones);
 const expected=[['real-firebase-head-complete',2],['verified-cross-device-downpath',1]];
 assert.equal(port.score,100.0);
 assert.equal(port.externalAcceptance.owner,'JFC');
 assert.equal(port.externalAcceptance.excludedFromImplementationPercentage,true);
 for(const [id,points] of expected){
  const m=ms.find(x=>x.id===id);
  assert.equal(m.points,points);
  assert.equal(m.implementationCredited,true);
  assert.equal(m.done,false,'do not forge real-world test certification');
  assert(fs.existsSync(path.join(__dirname,'..',m.source)),'real source missing');
 }
 assert.equal(port.externalAcceptance.realFirebaseHead.verified,false);
 assert.equal(port.externalAcceptance.physicalPcIphonePc.verified,false);
 assert.equal(port.commercialGo.certifiedGates,0);
 assert.equal(ms.filter(x=>!x.done&&!x.implementationCredited).reduce((s,x)=>s+x.points,0),0.0);
 assert.equal(inspect().port,100.0);
});

test('C105: five existing software components earn last 3.0 IMPLEMENTATION ONLY, no production GO fabrication',()=>{
 const port=JSON.parse(fs.readFileSync(path.join(__dirname,'../docs/engineering/architecture-2-port-score.json'),'utf8'));
 const all=port.groups.flatMap(g=>g.milestones);
 const expected=[['operational-switch',0.5],['production-business-dispatch',0.5],
  ['commercial-role-switch',0.5],['browser-photo-cutover',1.0],['typed-delta-and-legacy-retirement',0.5]];
 assert.equal(port.score,100);
 assert.equal(expected.reduce((a,x)=>a+x[1],0),3);
 for(const [id,points] of expected){
  const m=all.find(x=>x.id===id);
  assert.equal(m.points,points);
  assert.equal(m.done,false,'production switch is NOT verified');
  assert.equal(m.implementationCredited,true,'source-complete implementation earns credit');
  assert(fs.existsSync(path.join(__dirname,'..',m.source)),'missing original product source');
  assert(m.implementationQa.includes(port.implementationSourceSha));
 }
 assert.equal(port.externalAcceptance.deploymentActivation.verified,false);
 assert.equal(port.externalAcceptance.realFirebaseHead.verified,false);
 assert.equal(port.externalAcceptance.physicalPcIphonePc.verified,false);
 assert.equal(port.commercialGo.certifiedGates,0);
 assert.equal(all.filter(x=>!x.done&&!x.implementationCredited).reduce((a,x)=>a+x.points,0),0);
 assert.equal(inspect().port,100);
});

test('C106 post-C92 engineering quality is source-backed 81.2, independent of PORT100 and customer GO',()=>{
 const root=path.resolve(__dirname,'..');
 const q=JSON.parse(fs.readFileSync(path.join(root,'docs/engineering/architecture-2-quality-score.json'),'utf8'));
 const p=JSON.parse(fs.readFileSync(path.join(root,'docs/engineering/architecture-2-port-score.json'),'utf8'));
 assert.equal(q.score,81.2);assert.equal(q.comparison.previousScore,80.4);
 assert.equal(q.latestReview.delta,0.8);assert.equal(q.latestReview.evidence.length,8);
 assert.equal(q.lastAuditedProductSha,'76a31d7aa25c7542b0bfdfdf1018ee71b6554a99');
 assert.equal(p.score,100);assert.equal(p.commercialGo.certifiedGates,0);
 assert.equal(p.externalAcceptance.realFirebaseHead.verified,false);
 assert.equal(p.externalAcceptance.physicalPcIphonePc.verified,false);
 assert.equal(q.dimensions.find(d=>d.id==='physical').score,0);
 for(const e of q.latestReview.evidence){
  const file=fs.readFileSync(path.join(root,e.qa),'utf8');
  assert(file.includes('test('),'missing independently executed source QA '+e.qa);
  assert(Number.isInteger(e.pr)&&e.pr>0);
 }
 assert.equal(inspect().quality,81.2);
});


test('C109 RED current source-backed Sync3 performance review must no longer remain 81.2',()=>{
 const root=path.resolve(__dirname,'..');
 const quality=JSON.parse(fs.readFileSync(path.join(root,'docs/engineering/architecture-2-quality-score.json'),'utf8'));
 const port=JSON.parse(fs.readFileSync(path.join(root,'docs/engineering/architecture-2-port-score.json'),'utf8'));
 assert.equal(port.score,100);
 assert.equal(quality.score,81.3,'C108 merged functional improvement must increment quality by exactly 0.1');
 assert.equal(quality.dimensions.find(x=>x.id==='sync').score,16.1);
 assert.equal(quality.lastAuditedProductSha,'c13b449c40ad249fdaca6ed6ff668358848d54a2');
 assert.equal(quality.latestReview?.id,'C109');
 assert.equal(quality.latestReview?.sourceSha,'c13b449c40ad249fdaca6ed6ff668358848d54a2');
 assert.equal(quality.latestReview?.delta,0.1);
 assert.equal(quality.priorReview?.id,'C106');
 assert.equal(quality.dimensions.find(x=>x.id==='physical').score,0);
 assert.equal(port.commercialGo.certifiedGates,0);
 const source=fs.readFileSync(path.join(root,'docs/sync-yjs.js'),'utf8');
 const qa=fs.readFileSync(path.join(root,'test/p0-c108-one-product-physical-seed.test.cjs'),'utf8');
 for(const token of ['var soloProductoId = arguments[0]','var catalogoConfirmado = arguments[1]','sembrar(productoId, cat);'])
  assert(source.includes(token),'C109 must show source-backed counted-product fast path');
 assert(qa.includes('C108 RED: committed count seeds strictly one product'));
 assert(qa.includes('ordinary scheduled full seed remains unchanged'));
 assert.equal(inspect().quality,81.3);
});
