'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {inspect}=require('../scripts/architecture-2-port-score.cjs');
test('C13 metric: real repository source paths, milestone budgets and pinned evidence are valid',()=>{
 const s=inspect();
 assert.equal(s.port,81.5);
 assert.equal(s.portBefore,68.5);
 assert.equal(s.portDelta,13.0);
 assert.equal(s.quality,73.2);
 assert.equal(s.qualityBefore,67.0);
 assert.equal(s.qualityDelta,6.2);
 assert.equal(s.go,'0/6');
});
