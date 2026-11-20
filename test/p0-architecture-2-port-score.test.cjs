'use strict';
// C48 RED first: C46 merged QA-only browser photo and two real Workerd handoff cycles; fixed 100.0 rubric.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {inspect}=require('../scripts/architecture-2-port-score.cjs');
test('C53: merged v0.8.22 legacy-sender retirement earns bounded fixed100 QA credit, GO0/6',()=>{
 const s=inspect();
 assert.equal(s.port,90.0);
 assert.equal(s.portBefore,68.5);
 assert.equal(s.portDelta,21.5);
 assert.equal(s.quality,78.1);
 assert.equal(s.qualityBefore,77.9);
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
 assert.equal(ms.find(m=>m.id==='typed-delta-and-legacy-retirement')?.points,1.0);
 assert.equal(ms.find(m=>m.id==='typed-delta-and-legacy-retirement')?.done,false);
 assert.equal(quality.dimensions.find(d=>d.id==='physical')?.score,0);
 assert.equal(quality.dimensions.find(d=>d.id==='sync')?.score,15.7);
 assert.equal(ms.filter(x=>!x.done).reduce((a,x)=>a+x.points,0),10.0);
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
 assert.equal(quality.dimensions.find(d=>d.id==='sync')?.previous,15.7);
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
 assert.equal(quality.dimensions.find(d=>d.id==='durability')?.score,18.2);
 assert.equal(quality.dimensions.find(d=>d.id==='durability')?.previous,18.2);
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
 assert.equal(quality.dimensions.find(d=>d.id==='migration')?.score,7.5);
 assert.equal(quality.dimensions.find(d=>d.id==='migration')?.previous,7.3);
 assert.equal(port.commercialGo.certifiedGates,0);
 assert.equal(quality.dimensions.find(d=>d.id==='physical')?.score,0);
 // C50 RED: C47 authenticated role change is merged IN PRODUCT; QA credit capped.
 const identity=port.groups.find(g=>g.id==='identity-rooms');
 assert.equal(identity?.weight,14);
 assert.equal(identity?.milestones.reduce((a,m)=>a+m.points,0),14,'identity budget fixed');
 assert.equal(ms.find(m=>m.id==='real-auth-role-epoch-qa-c47')?.points,0.5);
 assert.equal(ms.find(m=>m.id==='real-auth-role-epoch-qa-c47')?.done,true);
 assert.equal(ms.find(m=>m.id==='real-auth-role-epoch-qa-c47')?.source,'docs/sync-yjs.js');
 assert.equal(ms.find(m=>m.id==='commercial-role-switch')?.points,1.0);
 assert.equal(ms.find(m=>m.id==='commercial-role-switch')?.done,false,'unearned real role switch');
 assert.equal(quality.dimensions.find(d=>d.id==='security')?.score,10.5);
 assert.equal(quality.dimensions.find(d=>d.id==='security')?.previous,10.5);
 assert.equal(quality.dimensions.find(d=>d.id==='physical')?.score,0);
 assert.equal(port.commercialGo.certifiedGates,0);
 // C45 RED: only 0.5 split from existing 1.0 unearned business budget for real C44.
 const c44=ms.find(m=>m.id==='real-adjust-credit-browser-envelope-c44');
 assert.equal(c44?.points,0.5,'C44 earns only the QA browser+Workerd slice');
 assert.equal(c44?.done,true,'C44 must be merged in the same real product');
 assert.equal(quality.comparison.previousScore,77.9);
 assert.equal(quality.dimensions.find(d=>d.id==='business')?.previous,18.5);
 assert.equal(port.groups.find(g=>g.id==='typed-economics')?.milestones.reduce((a,m)=>a+m.points,0),17.0,'fixed 100.0-point budget');
 assert.equal(port.commercialGo.certifiedGates,0);
  // C48 assessed SHA pinned to the actual PR844 merge source.
 assert.equal(port.assessedProductSha,'b223fe801ec9599949f135423551e63cf89105c4', 'C53 must pin actual C52 merged same-app product SHA');
 assert.equal(quality.assessedProductSha,port.assessedProductSha);
});
