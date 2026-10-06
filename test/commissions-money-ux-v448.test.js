const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '../docs/index.html'), 'utf8');
const help = fs.readFileSync(path.join(__dirname, '../docs/help-ui.js'), 'utf8');
const manual = fs.readFileSync(path.join(__dirname, '../docs/manual.html'), 'utf8');

function commissionsRegion() {
  const a = html.indexOf('async function cargarComisiones');
  const b = html.indexOf('// --- VISTA AVANZADO ---', a);
  assert.ok(a >= 0 && b > a, 'Commissions region must exist');
  return html.slice(a, b);
}

test('Money UX: each payable person exposes visible edit, payment, statement and history controls', () => {
  const src = commissionsRegion();
  assert.match(src, /data-comm-person-card/, 'person-level money card must exist');
  assert.match(src, /data-comm-edit-person/, 'pencil/edit control must remain visible');
  assert.match(src, /data-comm-pay-person/, 'Record payment must be visible inline');
  assert.match(src, /data-est-p=/, 'Send statement control must remain available');
  assert.match(src, /data-comm-history-person/, 'Payment history must be reachable per person');
  assert.match(src, /data-comm-edit-rack/, 'rack deal pencil must be visible in Commissions');
});

test('Money UX: person card shows Earned, Paid and Still due from ledger-backed values', () => {
  const src = commissionsRegion();
  assert.match(src, /mx\.earned/, 'Earned label must be bound into person totals');
  assert.match(src, /mx\.paid/, 'Paid label must be bound into person totals');
  assert.match(src, /mx\.due/, 'Still due label must be bound into person totals');
  assert.match(src, /earned:"Earned"/, 'English Earned copy must remain');
  assert.match(src, /paid:"Paid"/, 'English Paid copy must remain');
  assert.match(src, /due:"Still due"/, 'English Still due copy must remain');
  assert.match(src, /partially paid/i);
});

test('Money UX: payment action names the amount and preserves partial-payment flow', () => {
  const src = commissionsRegion();
  assert.match(src, /Record .* payment/);
  assert.match(src, /Pay full balance/);
  assert.match(src, /Payment amount/);
  assert.match(src, /amountCents/);
  assert.match(src, /opId/);
});

test('Money UX regression: historical Commissions controls are not lost', () => {
  const src = commissionsRegion();
  assert.match(src, /What if I sell more\?/i, 'historical simulator must remain');
  assert.match(src, /Was the percentage wrong\? Fix it/i, 'historical retrospective split correction must remain');
  assert.match(src, /Export CSV/i, 'commission export must remain');
  assert.match(html, /comm-tab-product/, 'By product tab must remain');
  assert.match(html, /comm-tab-rack/, 'By rack/event tab must remain');
  assert.match(html, /tipo === "comisionpercha"/, 'Sep 11 dashboard commission-pencil deep link must remain wired');
  assert.match(html, /function abrirEditorComisionPercha\(/, 'historical shelf commission editor must remain callable');
});

test('Money UX language: old Mark as paid wording is removed from owner-facing help/manual', () => {
  assert.doesNotMatch(help, /Mark as paid/i);
  assert.doesNotMatch(manual, /Mark as paid/i);
  assert.match(help, /Record payment/i);
  assert.match(manual, /Record payment/i);
});
