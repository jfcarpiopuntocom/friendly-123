// Lapicito de incidentes + lista negra directa (JFC 2026-09-26). Decision de JFC:
// de un incidente ya anotado se corrige FECHA, HORA y NOTA (no la calificacion,
// no se borra), y solo dueno o admin. Pruebas 1-3 escritas antes del codigo: rojas
// en v410. La 4 exige el mismo candado de rol en "despedir" (lista negra).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { browser } = require('./helpers/browser.cjs');

async function clienteConIncidente() {
  const w = browser();
  w.OCAuth = { rolActual: () => 'dueno' };
  const c = await w.request('/api/clientes', 'POST', { nombre: 'Cliente Prueba' });
  await w.request(`/api/clientes/${c.id}/evaluacion`, 'PATCH', { quien: 'Ana', confiabilidad: 1, horaIncidente: '10:15' });
  return { w, c };
}
const leer = async (w, id) => (await w.request('/api/clientes')).find((x) => x.id === id);

test('1. owner corrects date, time and note of an incident; rating and who stay', async () => {
  const { w, c } = await clienteConIncidente();
  await w.request(`/api/clientes/${c.id}/incidentes/0`, 'PATCH', { quien: 'JFC', fechaIncidente: '2026-09-20', horaIncidente: '18:40', nota: 'Left without paying' });
  const h = (await leer(w, c.id)).evaluacion.historial[0];
  assert.equal(h.fechaIncidente, '2026-09-20');
  assert.equal(h.horaIncidente, '18:40');
  assert.equal(h.nota, 'Left without paying');
  assert.equal(h.confiabilidad, 1);
  assert.equal(h.quien, 'Ana');
  assert.equal(h.editadoPor, 'JFC');
});

test('2. only the fields sent change (the note alone does not wipe the time)', async () => {
  const { w, c } = await clienteConIncidente();
  await w.request(`/api/clientes/${c.id}/incidentes/0`, 'PATCH', { quien: 'JFC', nota: 'Rude at the counter' });
  const h = (await leer(w, c.id)).evaluacion.historial[0];
  assert.equal(h.horaIncidente, '10:15');
  assert.equal(h.nota, 'Rude at the counter');
});

test('3. an employee cannot edit an incident; bad date or time is rejected', async () => {
  const { w, c } = await clienteConIncidente();
  await assert.rejects(() => w.request(`/api/clientes/${c.id}/incidentes/0`, 'PATCH', { fechaIncidente: '2026-13-40' }), /400/);
  await assert.rejects(() => w.request(`/api/clientes/${c.id}/incidentes/0`, 'PATCH', { horaIncidente: '25:99' }), /400/);
  await assert.rejects(() => w.request(`/api/clientes/${c.id}/incidentes/7`, 'PATCH', { nota: 'x' }), /404/);
  w.OCAuth.rolActual = () => 'empleado';
  await assert.rejects(() => w.request(`/api/clientes/${c.id}/incidentes/0`, 'PATCH', { nota: 'x' }), /403/);
});

test('4. blacklist (fire) is owner/admin only; admin can', async () => {
  const { w, c } = await clienteConIncidente();
  w.OCAuth.rolActual = () => 'empleado';
  await assert.rejects(() => w.request(`/api/clientes/${c.id}/despedir`, 'POST', {}), /403/);
  w.OCAuth.rolActual = () => 'admin';
  const r = await w.request(`/api/clientes/${c.id}/despedir`, 'POST', {});
  assert.equal(r.despedido, true);
});

// 5. Por la PANTALLA (leccion del Spray): el lapicito abre, guarda y la tarjeta pinta lo nuevo.
test('5. UI: pencil opens the editor, Save stores it and the card shows it', async () => {
  const { chromium } = require('playwright');
  const { pathToFileURL } = require('node:url');
  const path = require('node:path');
  const web = await chromium.launch({ headless: true });
  try {
    const page = await web.newPage({ viewport: { width: 390, height: 844 } });
    await page.goto(pathToFileURL(path.resolve(__dirname, '../docs/index.html')).href, { waitUntil: 'networkidle' });
    const r = await page.evaluate(async () => {
      window.OCAuth.rolActual = () => 'dueno';
      const req = async (u, m = 'GET', b) => (await fetch(u, { method: m, headers: b ? { 'Content-Type': 'application/json' } : undefined, body: b ? JSON.stringify(b) : undefined })).json();
      const c = await req('/api/clientes', 'POST', { nombre: 'Rosa Prueba' });
      await req(`/api/clientes/${c.id}/evaluacion`, 'PATCH', { quien: 'Ana', confiabilidad: 1, horaIncidente: '10:15' });
      const buscar = async () => {
        await cargarClientes();
        const b = document.querySelector('#listaClientes input');
        if (b) { b.value = 'Rosa'; b.dispatchEvent(new Event('input', { bubbles: true })); }
        await new Promise((ok) => setTimeout(ok, 400));
        return document.querySelector(`[data-cliente-id="${c.id}"]`);
      };
      toggleEditarIncidente(c.id + ':0');
      const card = await buscar();
      const k = c.id + ':0';
      const editor = !!document.getElementById('oc-incn-' + k);
      document.getElementById('oc-incf-' + k).value = '2026-09-20';
      document.getElementById('oc-inch-' + k).value = '18:40';
      document.getElementById('oc-incn-' + k).value = 'Left without paying';
      await guardarIncidente(c.id, 0);
      const despues = await buscar();
      return { editor, fire: !!(card && card.querySelector('[data-despedir-id]')), txt: despues ? despues.innerText : '' };
    });
    assert.ok(r.editor, 'the pencil opens date, time and note');
    assert.ok(r.fire, 'blacklist button is always there for the owner');
    assert.match(r.txt, /2026-09-20 · 18:40/);
    assert.match(r.txt, /Left without paying/);
  } finally { await web.close(); }
});
