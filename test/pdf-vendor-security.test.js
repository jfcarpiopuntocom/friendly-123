'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { readyEnvironment } = require('./helpers/ready-environment.cjs');

let env;
before(async () => { env = await readyEnvironment(); });
after(async () => { if (env) await env.close(); });

async function withPDF(run) {
  const context = await env.context();
  try {
    const page = await context.newPage();
    // Load the actual vendored UMD file selected by the dashboard, in isolation.
    const dashboard = fs.readFileSync(path.join(__dirname, '../docs/dashboard.html'), 'utf8');
    const match = dashboard.match(/cargarHerramientaExportacion\("\.\/(vendor\/jspdf-[\d.]+\.umd\.min\.js)"/);
    assert.ok(match, 'dashboard must select an exact local jsPDF version');
    await page.goto(env.origin + '/404.html');
    await page.addScriptTag({ url: env.origin + '/' + match[1] });
    return await run(page);
  } finally { await context.close(); }
}

test('FreeText color cannot close the PDF style string (GHSA-7x6v-j9x4-qf24)', async () => {
  const pdf = await withPDF(page => page.evaluate(() => {
    const doc = new window.jspdf.jsPDF();
    doc.createAnnotation({
      type: 'freetext', bounds: { x: 10, y: 10, w: 120, h: 20 }, contents: 'Synthetic note',
      color: '000000) /FriendlyInjected (marker) ('
    });
    return doc.output();
  }));
  assert.ok(pdf.includes('color:#000000\\) /FriendlyInjected \\(marker\\) \\('),
    'every parenthesis in the untrusted style must remain inside the PDF literal');
  assert.ok(!pdf.includes('color:#000000) /FriendlyInjected (marker) ('),
    'the raw style must never become PDF dictionary syntax');
});

test('embedded JavaScript belongs only to the document that supplied it (GHSA-cjw8-79x6-5cj4)', async () => {
  const result = await withPDF(page => page.evaluate(() => {
    const first = new window.jspdf.jsPDF();
    first.addJS('friendly_first_marker');
    const second = new window.jspdf.jsPDF();
    second.addJS('friendly_second_marker');
    return { first: first.output(), second: second.output() };
  }));
  assert.match(result.first, /friendly_first_marker/);
  assert.doesNotMatch(result.first, /friendly_second_marker/);
  assert.match(result.second, /friendly_second_marker/);
  assert.doesNotMatch(result.second, /friendly_first_marker/);
});
