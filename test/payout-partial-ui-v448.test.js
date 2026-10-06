const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('Commissions payment UI asks the exact amount and sends integer cents to the payout ledger', () => {
  const html = fs.readFileSync(path.join(__dirname, '../docs/index.html'), 'utf8');
  const start = html.indexOf('async function marcarComisionPagada');
  const end = html.indexOf('// --- VISTA AVANZADO ---', start);
  assert.ok(start >= 0 && end > start, 'payment function must exist');
  const src = html.slice(start, end);
  assert.match(src, /ocPrompt\(/, 'payment flow must ask how much was actually paid');
  assert.match(src, /amountCents/, 'payment flow must send exact integer cents');
  assert.match(src, /r\s*&&\s*r\.items/, 'receipt must use the payout items returned by the ledger');
  assert.match(src, /Math\.round\([^\n]*\*\s*100\)/, 'UI must convert the confirmed amount to cents');
});
