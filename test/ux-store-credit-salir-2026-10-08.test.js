/* JFC 2026-10-08 (UX): in "Record payment" the store-credit option must read as a way of paying
   ("Pay in store credit" / "Pagar con crédito en tienda"), and after a payment is recorded the
   dismiss button of the WhatsApp receipt dialog must say "Exit"/"Salir", never "Cancel": the
   payment is already saved and "Cancel" sounded like aborting it. Red on v470, green on the fix. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'); const path = require('node:path');
const src = fs.readFileSync(path.resolve(__dirname, '../docs/index.html'), 'utf8');

test('Record payment offers "Pay in store credit" (EN) and "Pagar con crédito en tienda" (ES) for credito-tienda', () => {
  const linea = src.split(/\r?\n/).find((l) => /value: "credito-tienda"/.test(l) && /label:/.test(l));
  assert.ok(linea, 'the credito-tienda option exists');
  assert.match(linea, /"Pay in store credit"/);
  assert.match(linea, /"Pagar con crédito en tienda"/);
});

test('after recording a payment the WhatsApp receipt dialog dismisses with Exit/Salir, not Cancel', () => {
  const i = src.indexOf('Send receipt via WhatsApp?`');
  assert.ok(i > 0, 'the receipt dialog exists');
  const tramo = src.slice(i, i + 200);
  assert.match(tramo, /cancelLabel: _esP \? "Salir" : "Exit"/);
});
