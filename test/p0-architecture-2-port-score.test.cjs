'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {inspect}=require('../scripts/architecture-2-port-score.cjs');
test('C12 metric: real repository source paths, milestone budgets and pinned evidence are valid',()=>{
 const s=inspect();
 assert.equal(s.port,77.5);
 assert.equal(s.portBefore,68.5);
 assert.equal(s.portDelta,9.0);
 assert.equal(s.quality,71.5);
 assert.equal(s.qualityBefore,67.0);
 assert.equal(s.qualityDelta,4.5);
 assert.equal(s.go,'0/6');
});
