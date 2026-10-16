const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const profile = require('../docs/customer-profile.js');

test('WhatsApp display preserves international digits and unrecognized contacts', () => {
  const cases = [
    ['0991234567', '099-123-4567'],
    ['+593 99 123 4567', '+593-99-123-4567'],
    ['+1 (305) 555-0100', '+1-305-555-0100'],
    ['+44 20 1234 5678', '+44-20-1234-5678'],
    ['5551234', '555-1234'],
    ['0991234567 ext. 2', '0991234567 ext. 2'],
    ['', '']
  ];
  for (const [raw, expected] of cases) {
    assert.equal(profile.whatsapp(raw), expected);
    assert.equal(profile.whatsapp(expected), expected);
    assert.equal(profile.whatsapp(raw).replace(/\D/g, ''), raw.replace(/\D/g, ''));
  }
  assert.equal(profile.residentLabel(undefined, true), 'Sin registrar');
  assert.equal(profile.residentLabel(false, true), 'No');
  assert.equal(profile.genderLabel(undefined, true), 'Desconocido');
});

// Execute the production dashboard editor with a minimal DOM, exercising the
// actual PATCH payload/confirmation rather than duplicating its typed logic.
function editor(customer) {
  const elements = [];
  const node = tag => {
    const n = { tag, children: [], events: {}, style: {}, value: '', textContent: '',
      appendChild(child) { this.children.push(child); },
      setAttribute() {}, addEventListener(k, fn) { this.events[k] = fn; },
      checkValidity() { return true; }, showModal() {}, focus() {}, close() {}, remove() {}
    };
    Object.defineProperty(n.style, 'cssText', { set() {} });
    elements.push(n); return n;
  };
  const calls = [];
  const context = {
    window: { OCCustomerProfile: profile }, localStorage: { getItem: () => 'es' },
    document: { createElement: node, body: node('body'), addEventListener() {} },
    autorizado: true, editorDeviceId: 'synthetic-device', _sesionLocal: false,
    datos: { clientes: [customer], cobertura: { clientes: true } },
    ordenar: async (method, route, body, target) => { calls.push({ method, route, body, target }); return { ok: true, datos: { ...customer, ...body } }; },
    pedirFoto() {}
  };
  vm.createContext(context);
  const source = fs.readFileSync(require.resolve('../docs/dashboard.html'), 'utf8');
  const start = source.indexOf('  var editorClienteDialog = null;');
  const end = source.indexOf('  /* JFC 2026-10-09: edits stay', start);
  vm.runInContext(source.slice(start, end), context);
  context.abrirEditorContactoDashboard(customer.id);
  const inputs = elements.filter(e => ['input', 'textarea', 'select'].includes(e.tag));
  const keys = ['nombre', 'telefono', 'email', 'notas', 'rangoEdad', 'pais', 'resideCuenca', 'genero'];
  return { calls, fields: Object.fromEntries(keys.map((k, i) => [k, inputs[i]])), save: () => elements.find(e => e.textContent === 'Guardar cambios').events.click(), elements };
}

test('dashboard preserves unknown residence and stored WhatsApp when editing another field', async () => {
  const e = editor({ id: 'synthetic-1', nombre: 'Synthetic', telefono: '0991234567' });
  assert.equal(e.fields.telefono.value, '099-123-4567');
  assert.equal(e.fields.resideCuenca.indeterminate, true);
  e.fields.notas.value = 'Synthetic note';
  await e.save();
  assert.equal(e.calls.length, 1);
  assert.equal(e.calls[0].body.notas, 'Synthetic note');
  assert.equal(Object.hasOwn(e.calls[0].body, 'resideCuenca'), false);
  assert.equal(Object.hasOwn(e.calls[0].body, 'telefono'), false);
  assert.equal(e.calls[0].body.baseContacto.resideCuenca, null);
});

test('dashboard saves false as boolean and confirms gender changes in the same editor', async () => {
  const e = editor({ id: 'synthetic-2', nombre: 'Synthetic', resideCuenca: true, genero: 'female' });
  e.fields.resideCuenca.checked = false;
  e.fields.genero.value = 'male';
  await e.save();
  assert.equal(e.calls[0].body.resideCuenca, false);
  assert.equal(e.calls[0].body.genero, 'male');
  assert.ok(e.elements.some(n => n.textContent === 'Guardado'));
});
