'use strict';
// READ-ONLY, synthetic, no external network or real client data.
// CDP measures Chromium JavaScript heap (not whole device RAM), main-thread
// work and long tasks. Compare pinned 2026-10-01 to this PR, on the SAME runner.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const { readyEnvironment } = require('../test/helpers/ready-environment.cjs');

const oldRoot = process.env.F123_BASELINE_DOCS;
const newRoot = path.resolve(__dirname, '../docs');
assert.ok(oldRoot && fs.existsSync(path.join(oldRoot, 'index.html')), 'historical docs root required');
assert.ok(fs.existsSync(path.join(newRoot, 'index.html')), 'candidate docs root required');

function mb(bytes) { return Math.round(bytes / 1048576 * 100) / 100; }
function round(n) { return Math.round(Number(n || 0) * 10) / 10; }

async function snapshot(page, cdp) {
  await cdp.send('HeapProfiler.collectGarbage');
  const metrics = await cdp.send('Performance.getMetrics');
  const m = Object.fromEntries(metrics.metrics.map(x => [x.name, x.value]));
  assert.ok(Number.isFinite(m.JSHeapUsedSize), 'Chromium CDP JSHeapUsedSize unavailable');
  const dom = await page.evaluate(() => {
    const p = window.__f123Perf39 || {};
    const entries = performance.getEntriesByType('navigation');
    const nav = entries[entries.length - 1];
    return {
      scriptNodes: [...document.scripts].filter(x => !!x.src).length,
      domNodes: document.querySelectorAll('*').length,
      imgNodes: document.images.length,
      navLoadMs: nav ? nav.loadEventEnd - nav.startTime : null,
      longTasks: (p.longTasks || []).length,
      longTaskTotalMs: Math.round((p.longTasks || []).reduce((sum, x) => sum + x.duration, 0)),
      longTaskMaxMs: Math.round(Math.max(0, ...(p.longTasks || []).map(x => x.duration))),
      runtimeErrors: p.errors || 0,
      resourceJsRequests: performance.getEntriesByType('resource').filter(x => /\.js(?:[?#]|$)/.test(x.name)).length,
      readyState: document.readyState
    };
  });
  return {
    ...dom,
    jsHeapUsedMb: mb(m.JSHeapUsedSize),
    jsHeapCommittedMb: mb(m.JSHeapTotalSize),
    scriptMs: round((m.ScriptDuration || 0) * 1000),
    taskMs: round((m.TaskDuration || 0) * 1000),
    layoutMs: round((m.LayoutDuration || 0) * 1000),
    eventListeners: m.JSEventListeners || 0,
    nodeMetric: m.Nodes || 0
  };
}
async function profile(label, root) {
  const env = await readyEnvironment({ root });
  try {
    const ctx = await env.context({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
    await ctx.addInitScript(() => {
      window.__f123Perf39 = { longTasks: [], errors: 0 };
      window.addEventListener('error', () => { window.__f123Perf39.errors++; });
      try {
        new PerformanceObserver(list => {
          const a = window.__f123Perf39.longTasks;
          for (const item of list.getEntries()) a.push({ start: item.startTime, duration: item.duration });
        }).observe({ type: 'longtask', buffered: true });
      } catch (_) { /* Unsupported engines are not silently interpreted as 0. */ }
    });
    const page = await ctx.newPage();
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('Performance.enable');
    await cdp.send('HeapProfiler.enable');
    const started = performance.now();
    const response = await page.goto(env.origin + '/index.html', { waitUntil: 'load', timeout: 90000 });
    assert.ok(response && response.ok(), label + ': synthetic index.html did not load');
    await page.waitForTimeout(900);
    const cold = await snapshot(page, cdp);
    await page.waitForTimeout(3000);
    const idle = await snapshot(page, cdp);
    await ctx.close();
    return { label, observedWallLoadMs: round(performance.now() - started - 3900), cold, idle };
  } finally { await env.close(); }
}
async function main() {
  const historic = await profile('2026-10-01 v442', path.resolve(oldRoot));
  const candidate = await profile('candidate branch (v706 runtime)', newRoot);
  const table = [historic, candidate];
  console.log('P39_BROWSER_PROFILE_SYNTHETIC ' + JSON.stringify(table));
  const headers = ['Build', 'Cold JS heap MB*', 'Idle JS heap MB*', 'Startup script ms', 'Idle script ms', 'Cold long tasks', 'Idle long tasks', 'Cold DOM nodes', 'Scripts'];
  const rows = table.map(x => [
    x.label, x.cold.jsHeapUsedMb, x.idle.jsHeapUsedMb, x.cold.scriptMs,
    x.idle.scriptMs, x.cold.longTasks, x.idle.longTasks, x.cold.domNodes, x.cold.scriptNodes
  ]);
  const note = '*CDP JS heap after forced GC, not browser/phone process RSS. Synthetic cold pre-login only; not equivalent to RAM with real photos or active Sync3.';
  const output = [
    '## P0 RAM/CPU forensic diagnostic — pinned 1 Oct vs candidate',
    '',
    '| ' + headers.join(' | ') + ' |',
    '|' + headers.map(() => '---').join('|') + '|',
    ...rows.map(row => '| ' + row.join(' | ') + ' |'),
    '',
    note,
    '',
    'All fixture network traffic is restricted to local loopback. This is a diagnostic, not a performance-pass gate.',
    ''
  ].join('\n');
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, output);
  process.stdout.write(output + '\n');
}
main().catch(error => { console.error('P39 PROFILE FAILED', error); process.exitCode = 1; });
