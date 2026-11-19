'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {inspect}=require('../scripts/architecture-2-port-score.cjs');
test('C30 metrics: audited C29 cold Safari preinit legacy guard, fixed 100 budget and C28 pending',()=>{
 const s=inspect();
 assert.equal(s.port,84.0);
 assert.equal(s.portBefore,68.5);
 assert.equal(s.portDelta,15.5);
 assert.equal(s.quality,75.8);
 assert.equal(s.qualityBefore,75.6);
 assert.equal(s.qualityDelta,0.2);
 assert.equal(s.go,'0/6');
});
