'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {inspect}=require('../scripts/architecture-2-port-score.cjs');
test('C16a metrics: real repository source paths, milestone budgets and pinned evidence are valid',()=>{
 const s=inspect();
 assert.equal(s.port,81.5);
 assert.equal(s.portBefore,68.5);
 assert.equal(s.portDelta,13.0);
 assert.equal(s.quality,74.1);
 assert.equal(s.qualityBefore,72.7);
 assert.equal(s.qualityDelta,1.4);
 assert.equal(s.go,'0/6');
});
