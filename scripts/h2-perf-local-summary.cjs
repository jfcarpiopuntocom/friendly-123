'use strict';
// H2 — read-only local timing summarizer, never connects to clients or telemetry.
// Run: node scripts/h2-perf-local-summary.cjs <qa-stage-metrics.json>
// Only {"etapa":"...", "ms":number, "ok":boolean} values are accepted.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const STAGES = ['prior_save_wait', 'snapshot_serialize', 'strict_idb', 'strict_commit'];
const MAX_RECORDS = 120;

function percentile(sorted, pct) {
  if (!sorted.length) return null;
  return sorted[Math.max(0, Math.ceil((pct / 100) * sorted.length) - 1)];
}
function report(records) {
  assert.ok(Array.isArray(records), 'Expected OCPerfLocal.leer() JSON array');
  assert.ok(records.length <= MAX_RECORDS, 'Unexpected >120 local timing records');
  for (const [idx, r] of records.entries()) {
    assert.ok(r && typeof r === 'object' && !Array.isArray(r), 'Invalid row ' + idx);
    assert.deepEqual(Object.keys(r).sort(), ['etapa', 'ms', 'ok'].sort(),
      'Reject unexpected fields: no ids, licenses, PINs, product names or payloads');
    assert.ok(STAGES.includes(r.etapa), 'Unknown timing stage on row ' + idx);
    assert.ok(typeof r.ms === 'number' && Number.isFinite(r.ms) && r.ms >= 0 && r.ms <= 3600000,
      'Invalid elapsed ms on row ' + idx);
    assert.equal(typeof r.ok, 'boolean', 'Invalid success flag on row ' + idx);
  }
  const stages = STAGES.map(etapa => {
    const values = records.filter(r => r.etapa === etapa);
    const times = values.map(r => r.ms).sort((a, b) => a - b);
    return {
      etapa, n: values.length,
      successful: values.filter(r => r.ok).length,
      failed: values.filter(r => !r.ok).length,
      p50_ms: percentile(times, 50),
      p95_ms: percentile(times, 95),
      max_ms: times.length ? times[times.length - 1] : null
    };
  });
  return { kind: 'H2-local-save-stage-diagnostics', total_stage_observations: records.length, stages,
    caveat: 'Per-stage observations are not distinct user taps or end-to-end latency. Device RAM, Sync3 latency and user success rate are not measured.' };
}
function markdown(out) {
  const lines = ['H2 diagnostic (local stages, no identifiers)', '',
    '| Stage | N | OK | Failed | P50 ms | P95 ms | Max ms |',
    '|---|---:|---:|---:|---:|---:|---:|',
    ...out.stages.map(x => '| ' + x.etapa + ' | ' + x.n + ' | ' + x.successful + ' | ' + x.failed +
      ' | ' + (x.p50_ms ?? '—') + ' | ' + (x.p95_ms ?? '—') + ' | ' + (x.max_ms ?? '—') + ' |'),
    '', out.caveat];
  return lines.join('\n');
}
if (require.main === module) {
  try {
    const path = process.argv[2];
    assert.ok(path && !path.startsWith('-'), 'Usage: node scripts/h2-perf-local-summary.cjs qa-metrics.json');
    const data = JSON.parse(fs.readFileSync(path, 'utf8'));
    console.log(markdown(report(data)));
  } catch (err) {
    console.error('H2 REJECTED: ' + err.message);
    process.exitCode = 1;
  }
}
module.exports = {report, markdown, percentile, STAGES};
