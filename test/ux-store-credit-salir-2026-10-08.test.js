/* JFC 2026-10-08 corrected and approved the earlier store-credit wording:
   leave commission owed now, purchase redemption later. This replaces the
   previous Pay in store credit label contract, without changing historical facts.
   After a payment is recorded the
   dismiss button of the WhatsApp receipt dialog must say "Exit"/"Salir", never "Cancel": the
   payment is already saved and "Cancel" sounded like aborting it. Red on v470, green on the fix. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'); const path = require('node:path');
const src = fs.readFileSync(path.resolve(__dirname, '../docs/index.html'), 'utf8');

test('Record payment offers leaving the balance owed without pretending to issue store credit', () => {
  const linea = src.split(/\r?\n/).find((l) => /value: "dejar-pendiente"/.test(l) && /label:/.test(l));
  assert.ok(linea, 'the leave-pending option exists');
  assert.match(linea, /t\("comm.leavePending"\)/);
  const i18n = fs.readFileSync(path.resolve(__dirname, '../docs/i18n.js'), 'utf8');
  assert.match(i18n, /"Leave balance owed"/);
  assert.match(i18n, /"Dejar saldo pendiente"/);
});

test('after recording a payment the WhatsApp receipt dialog dismisses with Exit/Salir, not Cancel', () => {
  const i = src.indexOf('Send receipt via WhatsApp?`');
  assert.ok(i > 0, 'the receipt dialog exists');
  const tramo = src.slice(i, i + 200);
  assert.match(tramo, /cancelLabel: _esP \? "Salir" : "Exit"/);
});
