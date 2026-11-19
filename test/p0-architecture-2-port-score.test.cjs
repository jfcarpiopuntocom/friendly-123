'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {inspect}=require('../scripts/architecture-2-port-score.cjs');
test('C26 metrics: C25 real certified browser coordinator and v810 sealed bridge, fixed 100 budget',()=>{
 const s=inspect();
 assert.equal(s.port,83.5);
 assert.equal(s.portBefore,68.5);
 assert.equal(s.portDelta,15.0);
 assert.equal(s.quality,75.6);
 assert.equal(s.qualityBefore,75.4);
 assert.equal(s.qualityDelta,0.2);
 assert.equal(s.go,'0/6');
});
