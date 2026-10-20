'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {browser} = require('./helpers/browser.cjs');

const html = () => fs.readFileSync(path.join(__dirname, '../docs/index.html'), 'utf8');
// Sale reporting deliberately flattens the financial projection and omits personal contacts.
// The private synthetic catalog validates the actual stored sale snapshot without expanding reporting PII.
const sales = async w => w.catalog().ventas;

async function fixture() {
  const w = browser();
  const customer = await w.request('/api/clientes', 'POST', {
    nombre: 'Synthetic selected client',
    telefono: '+593999000111',
    email: 'fixture@example.invalid'
  });
  const product = await w.request('/api/productos', 'POST', {
    nombre: 'Synthetic ceramic item', barcode: 'SYNTH-CONTACT-FLOW-001',
    precio: 15, costo: 5, stockInicial: 10
  });
  assert.ok(customer.id && product.id);
  return {w,customer,product};
}

test('sale form does not request email or WhatsApp again after customer selector', () => {
  const source = html();
  assert.ok(source.includes('id="vi-cliente"'), 'existing customer selector remains');
  assert.ok(source.includes('id="vi-nuevo-cliente"'), 'new-customer action remains');
  assert.ok(source.includes('id="vi-newcli-email"'), 'new-customer creation still accepts email');
  assert.ok(source.includes('id="vi-newcli-tel"'), 'new-customer creation still accepts phone');
  assert.ok(!source.includes('id="vi-email"'), 'duplicate sale email removed');
  assert.ok(!source.includes('id="vi-whatsapp"'), 'duplicate sale WhatsApp removed');
  assert.ok(!source.includes('g("vi-email")') && !source.includes('g("vi-whatsapp")'),
    'confirmation no longer reads deleted inputs');
});

test('selected existing customer supplies contact snapshot without extra sale fields', async () => {
  const {w,customer,product} = await fixture();
  const saved = await w.request('/api/productos/'+product.id+'/venta', 'POST', {
    cantidad: 1, clienteId: customer.id, info: {formaPago: 'cash'}
  });
  const found = (await sales(w)).find(v => v.id === saved.ventaId);
  assert.equal(found.clienteId, customer.id);
  assert.equal(found.info.email, customer.email);
  assert.equal(found.info.whatsapp, customer.telefono);
  assert.equal((await w.request('/api/productos/'+product.id)).stockActual, 9);
});

test('legacy callers with explicit contact fields are not overwritten', async () => {
  const {w,customer,product} = await fixture();
  const saved = await w.request('/api/productos/'+product.id+'/venta','POST',{
    cantidad:1,clienteId:customer.id,info:{
      formaPago:'cash',email:'alternate@example.invalid',whatsapp:'+593999000222'
    }
  });
  const found=(await sales(w)).find(v=>v.id===saved.ventaId);
  assert.equal(found.info.email,'alternate@example.invalid');
  assert.equal(found.info.whatsapp,'+593999000222');
});

test('counter sale does not invent client identity or contact data', async () => {
  const {w,product} = await fixture();
  const saved = await w.request('/api/productos/'+product.id+'/venta','POST',{
    cantidad:1,info:{formaPago:'cash'}
  });
  const found=(await sales(w)).find(v=>v.id===saved.ventaId);
  assert.ok(!found.clienteId, 'counter sale must not link a customer');
  assert.equal(found.info.email,'');
  assert.equal(found.info.whatsapp,'');
});
