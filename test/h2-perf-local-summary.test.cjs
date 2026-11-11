'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {report, markdown, percentile} = require('../scripts/h2-perf-local-summary.cjs');

test('H2: p50/p95/counts separate strict IDB failures from serialization work', () => {
  const records = [
    {etapa:'strict_idb',ms:100,ok:true}, {etapa:'strict_idb',ms:200,ok:false},
    {etapa:'strict_idb',ms:400,ok:true}, {etapa:'snapshot_serialize',ms:20,ok:true}
  ];
  const s = report(records);
  assert.equal(s.total_stage_observations, 4);
  const idb = s.stages.find(x => x.etapa === 'strict_idb');
  assert.deepEqual(idb, {etapa:'strict_idb',n:3,successful:2,failed:1,p50_ms:200,p95_ms:400,max_ms:400});
  const ser = s.stages.find(x => x.etapa === 'snapshot_serialize');
  assert.equal(ser.n, 1); assert.equal(ser.p95_ms, 20);
  assert.match(markdown(s), /Per-stage observations are not distinct user taps/);
});

test('H2: no observations cannot be misreported as zero-latency success', () => {
  const r = report([]);
  assert.equal(r.total_stage_observations, 0);
  for (const s of r.stages) {
    assert.equal(s.n, 0);
    assert.equal(s.p50_ms, null);
    assert.equal(s.p95_ms, null);
  }
  assert.equal(percentile([],95), null);
});

test('H2: reject records with any unexpected sensitive fields', () => {
  assert.throws(() => report([{etapa:'strict_commit',ms:50,ok:true,producto:'private'}]), /Reject unexpected fields/);
  assert.throws(() => report([{etapa:'strict_commit',ms:50,ok:true,licenseCode:'private'}]), /Reject unexpected fields/);
  assert.throws(() => report([{etapa:'network',ms:50,ok:true}]), /Unknown timing stage/);
  assert.throws(() => report([{etapa:'strict_idb',ms:NaN,ok:false}]), /Invalid elapsed ms/);
  assert.throws(() => report([{etapa:'strict_idb',ms:50,ok:'true'}]), /Invalid success flag/);
  assert.throws(() => report(Array.from({length:121}, () => ({etapa:'strict_idb',ms:1,ok:true}))), /120/);
});

test('H2: accepts exact production OCPerfLocal.leer() shape, without mutating it', () => {
  const sample = [{etapa:'prior_save_wait',ms:0,ok:true}, {etapa:'strict_commit',ms:150,ok:false}];
  const before = JSON.stringify(sample);
  const r = report(sample);
  assert.equal(JSON.stringify(sample),before);
  assert.equal(r.stages.find(x=>x.etapa==='strict_commit').failed,1);
});
