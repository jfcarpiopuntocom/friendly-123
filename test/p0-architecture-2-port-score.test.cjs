'use strict';
// C43 RED: require C42 real checkout DO status observer with adversarial 4/4 QA before score credit.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {inspect}=require('../scripts/architecture-2-port-score.cjs');
test('C43: C42 checkout status/ack anti-downgrade earns no more than 0.5 fixed budget, GO0/6',()=>{
 const s=inspect();
 assert.equal(s.port,87.5);
 assert.equal(s.portBefore,68.5);
 assert.equal(s.portDelta,19.0);
 assert.equal(s.quality,77.0);
 assert.equal(s.qualityBefore,76.8);
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
 assert.equal(ms.find(m=>m.id==='operational-switch')?.points,1.0);
 assert.equal(ms.find(m=>m.id==='operational-switch')?.done,false);
 assert.equal(ms.find(m=>m.id==='production-business-dispatch')?.points,0.5);
 assert.equal(ms.find(m=>m.id==='real-checkout-do-status-c42')?.points,0.5);
 assert.equal(ms.find(m=>m.id==='real-checkout-do-status-c42')?.done,true);
 assert.equal(ms.find(m=>m.id==='real-business-do-receipt-c40')?.points,0.5);
 assert.equal(ms.find(m=>m.id==='real-business-do-receipt-c40')?.done,true);
 assert.equal(ms.find(m=>m.id==='production-business-dispatch')?.done,false);
 assert.equal(ms.find(m=>m.id==='typed-delta-and-legacy-retirement')?.points,1.5);
 assert.equal(ms.find(m=>m.id==='typed-delta-and-legacy-retirement')?.done,false);
 assert.equal(quality.dimensions.find(d=>d.id==='physical')?.score,0);
 assert.equal(quality.dimensions.find(d=>d.id==='sync')?.score,15.6);
 assert.equal(ms.filter(x=>!x.done).reduce((a,x)=>a+x.points,0),12.5);
 assert.equal(port.groups.find(g=>g.id==='typed-economics')?.milestones.reduce((a,m)=>a+m.points,0),17);
 assert.equal(quality.dimensions.find(d=>d.id==='business')?.score,18.5);
 // C45 RED: only 0.5 split from existing 1.0 unearned business budget for real C44.
 const c44=ms.find(m=>m.id==='real-adjust-credit-browser-envelope-c44');
 assert.equal(c44?.points,0.5,'C44 earns only the QA browser+Workerd slice');
 assert.equal(c44?.done,true,'C44 must be merged in the same real product');
 assert.equal(quality.comparison.previousScore,76.8);
 assert.equal(quality.dimensions.find(d=>d.id==='business')?.previous,18.3);
 assert.equal(port.groups.find(g=>g.id==='typed-economics')?.milestones.reduce((a,m)=>a+m.points,0),17.0,'fixed 100.0-point budget');
 assert.equal(port.commercialGo.certifiedGates,0);
  // C43 expected source SHA must be exact product C42 MERGE commit after all CI; fill after product merge.
 assert.equal(port.assessedProductSha,'be032b2b27fd52c299d8e1b6942d9b7bb2596934', 'C45 must reference actual C44 merged product SHA, not workshop or premerge candidate');
 assert.equal(quality.assessedProductSha,port.assessedProductSha);
});
