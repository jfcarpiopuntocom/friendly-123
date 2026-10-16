const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');

test('customer form creates, edits and reloads WhatsApp/Cuenca/gender in Chromium', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(pathToFileURL(path.resolve(__dirname, '../docs/index.html')).href, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.cargarClientes && window.OCI18n && window.OCAuth);
    const show = async () => page.evaluate(async () => {
      OCAuth.rolActual = () => 'dueno'; OCI18n.setLang('es');
      document.getElementById('oc-gate')?.remove();
      await cargarClientes();
      document.querySelectorAll('.vista').forEach(el => el.style.display = 'none');
      const section = document.getElementById('vista-clientes'); section.style.display = 'block';
      section.querySelectorAll('details').forEach(el => el.open = true);
    });
    await show();
    await page.locator('#cliNombre').fill('Synthetic profile browser');
    await page.locator('#cliTelefono').fill('0991234567');
    await page.locator('#cliCuenca').check();
    await page.locator('#cliGenero').selectOption('female');
    assert.equal(await page.locator('#cliTelefono').inputValue(), '099-123-4567');
    await page.locator('#btnAltaCliente').click();
    await page.waitForFunction(() => document.getElementById('cliNombre').value === '');
    const customer = await page.evaluate(async () => (await (await fetch('/api/clientes')).json()).find(c => c.nombre === 'Synthetic profile browser'));
    assert.equal(customer.resideCuenca, true); assert.equal(customer.genero, 'female');
    await page.evaluate(id => toggleEditarContacto('cliedit-' + id), customer.id);
    await page.locator('#oc-edit-cuenca-' + customer.id).uncheck();
    await page.locator('#oc-edit-genero-' + customer.id).selectOption('male');
    await page.locator('#oc-cliedit-' + customer.id + ' button').click();
    await page.waitForFunction(async id => {
      const c = (await (await fetch('/api/clientes')).json()).find(c => c.id === id);
      return c.resideCuenca === false && c.genero === 'male';
    }, customer.id);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.cargarClientes && window.OCI18n && window.OCAuth);
    await show();
    const restored = await page.evaluate(async id => (await (await fetch('/api/clientes')).json()).find(c => c.id === id), customer.id);
    assert.equal(restored.resideCuenca, false); assert.equal(restored.genero, 'male');
    assert.match(await page.locator('#listaClientes').innerText(), /WhatsApp 099-123-4567/);
    assert.match(await page.locator('#listaClientes').innerText(), /Reside en Cuenca: No/);
  } finally { await browser.close(); }
});
