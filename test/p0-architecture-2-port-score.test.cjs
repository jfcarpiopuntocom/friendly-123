'use strict';
// C48 RED first: C46 merged QA-only browser photo and two real Workerd handoff cycles; fixed 100.0 rubric.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {inspect}=require('../scripts/architecture-2-port-score.cjs');
test('C63: C62 real frozen legacy cat roots reject private-only Yjs v1, same app fixed100 GO0/6',()=>{
 const s=inspect();
 assert.equal(s.port,92.0);
 assert.equal(s.portBefore,68.5);
 assert.equal(s.portDelta,23.5);
 assert.equal(s.quality,79.1);
 assert.equal(s.qualityBefore,78.9);
 assert.equal(s.qualityDelta,0.2);
 assert.equal(s.go,'0/6');
 const port=JSON.parse(fs.readFileSync(path.join(__dirname,'../docs/engineering/architecture-2-port-score.json'),'utf8'));
 const quality=JSON.parse(fs.readFileSync(path.join(__dirname,'../docs/engineering/architecture-2-quality-score.json'),'utf8'));
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
 assert.equal(quality.dimensions.find(d=>d.id==='physical')?.score,0);
 assert.equal(quality.dimensions.find(d=>d.id==='sync')?.score,15.9);
 assert.equal(ms.filter(x=>!x.done).reduce((a,x)=>a+x.points,0),8.0);
 assert.equal(port.groups.find(g=>g.id==='typed-economics')?.milestones.reduce((a,m)=>a+m.points,0),17);
 assert.equal(quality.dimensions.find(d=>d.id==='business')?.score,18.5);
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
 assert.equal(quality.dimensions.find(d=>d.id==='photos')?.score,7.7);
 assert.equal(quality.dimensions.find(d=>d.id==='photos')?.previous,7.7);
 assert.equal(quality.dimensions.find(d=>d.id==='sync')?.previous,15.9);
 assert.equal(quality.dimensions.find(d=>d.id==='physical')?.previous,0);
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
 assert.equal(quality.dimensions.find(d=>d.id==='durability')?.score,18.4);
 assert.equal(quality.dimensions.find(d=>d.id==='durability')?.previous,18.4);
 assert.equal(quality.dimensions.find(d=>d.id==='photos')?.previous,7.7);
 assert.equal(port.commercialGo.certifiedGates,0,'QA-only flags do not grant commercial GO');
 assert.equal(quality.dimensions.find(d=>d.id==='physical')?.score,0);

 // C53 RED: retire exactly THREE legacy Yjs senders under active 2.0, preserve failback.
 const browser=port.groups.find(g=>g.id==='browser-cutover');
 assert.equal(browser?.weight,10,'original browser-cutover budget stays fixed10');
 assert.equal(browser?.milestones.reduce((a,m)=>a+m.points,0),10);
 const c52=ms.find(m=>m.id==='c52-legacy-yjs-senders-retired-under-cutover');
 assert.equal(c52?.points,0.5,'limited engineering QA credit, not all legacy retired');
 assert.equal(c52?.done,true);
 assert.equal(c52?.source,'docs/sync-yjs.js');
 assert.equal(ms.find(m=>m.id==='typed-delta-and-legacy-retirement')?.done,false);
 assert.equal(quality.dimensions.find(d=>d.id==='migration')?.score,7.7);
 assert.equal(quality.dimensions.find(d=>d.id==='migration')?.previous,7.7);
 assert.equal(port.commercialGo.certifiedGates,0);
 assert.equal(quality.dimensions.find(d=>d.id==='physical')?.score,0);

 // C55 RED: C54 closes the old PRIMARY sender while active, distinct from C52 shadows.
 const c54=ms.find(m=>m.id==='c54-primary-fallback-old-yjs-writer-fence');
 assert.equal(c54?.done,true,'C54 requires merged real source');
 assert.equal(c54?.points,0.5,'C54 partial QA earns no physical/commercial credit');
 assert.equal(c54?.source,'docs/sync-yjs.js');
 assert.equal(ms.find(m=>m.id==='typed-delta-and-legacy-retirement')?.done,false);
 assert.equal(browser.milestones.reduce((a,m)=>a+m.points,0),10,'no new rubric weight');
 assert.equal(port.commercialGo.certifiedGates,0);
 assert.equal(quality.dimensions.find(d=>d.id==='physical')?.score,0);

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
 assert.equal(quality.dimensions.find(d=>d.id==='physical')?.score,0);
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
 assert.equal(quality.dimensions.find(d=>d.id==='security')?.score,10.9);
 assert.equal(quality.dimensions.find(d=>d.id==='security')?.previous,10.7);
 assert.equal(quality.dimensions.find(d=>d.id==='physical')?.score,0);
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
 assert.equal(quality.dimensions.find(d=>d.id==='security')?.previous,10.7);
 assert.equal(quality.dimensions.find(d=>d.id==='physical')?.score,0);
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
 assert.equal(ms.find(m=>m.id==='r2-service-binding-installed')?.done,false);
 assert.equal(quality.dimensions.find(d=>d.id==='durability')?.score,18.4);
 assert.equal(quality.dimensions.find(d=>d.id==='durability')?.previous,18.4);
 assert.equal(quality.dimensions.find(d=>d.id==='physical')?.score,0);
 assert.equal(port.commercialGo.certifiedGates,0);

 // C63 RED: C62 actual source requires PUBLIC roots even legacy v1 numeric.
 const c62=ms.find(m=>m.id==='c62-legacy-frozen-private-root-rejection');
 assert.equal(c62?.points,0.2,'small new privacy QA from original real HEAD pending');
 assert.equal(c62?.done,true,'must be in the real functional product');
 assert.equal(c62?.source,'cloudflare-yparty-worker/src/trusted-frozen-source.mjs');
 assert.equal(ms.find(m=>m.id==='real-firebase-head-complete')?.points,2.0);
 assert.equal(ms.find(m=>m.id==='real-firebase-head-complete')?.done,false);
 assert.equal(ms.find(m=>m.id==='r2-service-binding-installed')?.done,false);
 assert.equal(quality.dimensions.find(d=>d.id==='security')?.score,10.9);
 assert.equal(quality.dimensions.find(d=>d.id==='security')?.previous,10.7);
 assert.equal(quality.dimensions.find(d=>d.id==='durability')?.score,18.4);
 assert.equal(quality.dimensions.find(d=>d.id==='durability')?.previous,18.4);
 assert.equal(port.commercialGo.certifiedGates,0);
 assert.equal(quality.dimensions.find(d=>d.id==='physical')?.score,0);
 // C45 RED: only 0.5 split from existing 1.0 unearned business budget for real C44.
 const c44=ms.find(m=>m.id==='real-adjust-credit-browser-envelope-c44');
 assert.equal(c44?.points,0.5,'C44 earns only the QA browser+Workerd slice');
 assert.equal(c44?.done,true,'C44 must be merged in the same real product');
 assert.equal(quality.comparison.previousScore,78.9);
 assert.equal(quality.dimensions.find(d=>d.id==='business')?.previous,18.5);
 assert.equal(port.groups.find(g=>g.id==='typed-economics')?.milestones.reduce((a,m)=>a+m.points,0),17.0,'fixed 100.0-point budget');
 assert.equal(port.commercialGo.certifiedGates,0);
  // C48 assessed SHA pinned to the actual PR844 merge source.
 assert.equal(port.assessedProductSha,'6e802e6e0df0988922220dd634a40f7788638f05', 'C63 pins exact C62 source merged in same friendly-123');
 assert.equal(quality.assessedProductSha,port.assessedProductSha);
});
