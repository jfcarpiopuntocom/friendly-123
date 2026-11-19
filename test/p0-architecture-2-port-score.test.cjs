'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {inspect}=require('../scripts/architecture-2-port-score.cjs');
test('C24 metrics: C23 bundle and C21b tombstones on pinned product SHA, weights remain fixed 100',()=>{
 const s=inspect();
 assert.equal(s.port,83.0);
 assert.equal(s.portBefore,68.5);
 assert.equal(s.portDelta,14.5);
 assert.equal(s.quality,75.4);
 assert.equal(s.qualityBefore,74.9);
 assert.equal(s.qualityDelta,0.5);
 assert.equal(s.go,'0/6');
});
