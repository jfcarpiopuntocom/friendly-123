'use strict';
// C39 TDD RED first: same friendly-123 app C38 local cutover interlock only.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {inspect}=require('../scripts/architecture-2-port-score.cjs');
test('C39: real product C38 local no-dual-writer interlock earns ONLY 0.5 fixed-budget, GO0/6',()=>{
 const s=inspect();
 assert.equal(s.port,86.0);
 assert.equal(s.portBefore,68.5);
 assert.equal(s.portDelta,17.5);
 assert.equal(s.quality,76.4);
 assert.equal(s.qualityBefore,76.2);
 assert.equal(s.qualityDelta,0.2);
 assert.equal(s.go,'0/6');
 const port=JSON.parse(fs.readFileSync(path.join(__dirname,'../docs/engineering/architecture-2-port-score.json'),'utf8'));
 const quality=JSON.parse(fs.readFileSync(path.join(__dirname,'../docs/engineering/architecture-2-quality-score.json'),'utf8'));
 const ms=port.groups.flatMap(g=>g.milestones);
 assert.equal(port.maximum,100);
 assert.equal(quality.maximum,100);
 assert.equal(port.groups.reduce((a,g)=>a+g.weight,0),100,'original rubric fixed at 100');
 assert.equal(ms.find(m=>m.id==='local-legacy-relay-quiescence-gate-c38')?.done,true);
 assert.equal(ms.find(m=>m.id==='local-legacy-relay-quiescence-gate-c38')?.points,0.5);
 assert.equal(ms.find(m=>m.id==='operational-switch')?.points,1.0);
 assert.equal(ms.find(m=>m.id==='operational-switch')?.done,false);
 assert.equal(ms.find(m=>m.id==='production-business-dispatch')?.points,2.0);
 assert.equal(ms.find(m=>m.id==='production-business-dispatch')?.done,false);
 assert.equal(ms.find(m=>m.id==='typed-delta-and-legacy-retirement')?.points,1.5);
 assert.equal(ms.find(m=>m.id==='typed-delta-and-legacy-retirement')?.done,false);
 assert.equal(quality.dimensions.find(d=>d.id==='physical')?.score,0);
 assert.equal(quality.dimensions.find(d=>d.id==='sync')?.score,15.6);
 assert.equal(ms.filter(x=>!x.done).reduce((a,x)=>a+x.points,0),14.0);
 // Stacked branch SHA is only provisional; replace with ACTUAL C38 merge SHA
 // and revalidate after C38 100% CI success, before merging this score PR.
 assert.equal(port.assessedProductSha,'8cd8afb69a3c91df643d72053993cdf1d6745695');
 assert.equal(quality.assessedProductSha,port.assessedProductSha);
});
