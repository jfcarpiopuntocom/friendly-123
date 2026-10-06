// Escenario FICTICIO para el contrato de UI. Nunca datos de clientes.
// Personas: Ana Prueba, Beto Prueba. Perchas: Percha Prueba, Percha Dos.
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const INDEX = pathToFileURL(path.resolve(__dirname, '../../docs/index.html')).href;

async function openApp(browser, { locale = 'en-US' } = {}) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, locale });
  await page.goto(INDEX, { waitUntil: 'load' });
  await page.waitForFunction(() => window.OCSecure && window.OCAuth);
  return page;
}

async function seedScenario(page, { integridadPendiente = false } = {}) {
  // Se requiere aqui (no arriba) para evitar dependencia circular futura.
  const { loginAs } = require('../helpers/ui-contract-login.cjs');
  // 1) PINs reales: dueno 682 (reemplaza 789), empleado 260, contador 357.
  await page.evaluate(async () => {
    await window.OCSecure.guardarSecreto('789', ['260'], '357', 'owner@example.invalid');
    await window.OCSecure.fijarOwnerPin('682');
  });
  // 2) El mock autoriza por rol REAL: los datos se crean con sesion de dueno.
  await loginAs(page, 'dueno');
  const ids = await page.evaluate(async () => {
    const req = async (u, m = 'GET', b) => {
      const r = await fetch(u, { method: m, headers: b ? { 'Content-Type': 'application/json' } : undefined, body: b ? JSON.stringify(b) : undefined });
      const j = await r.json();
      if (!r.ok) throw new Error(m + ' ' + u + ' -> ' + r.status + ' ' + JSON.stringify(j));
      return j;
    };
    // balance-due: 1 producto -> 1 percha -> 1 persona
    const ana = await req('/api/promotoras', 'POST', { nombre: 'Ana Prueba', comisionBase: 40 });
    const rack = await req('/api/ubicaciones', 'POST', { nombre: 'Percha Prueba', tipo: 'socio' });
    await req('/api/ubicaciones/' + rack.id, 'PUT', { promotoraId: ana.id });
    const taza = await req('/api/productos', 'POST', { nombre: 'Taza Prueba', barcode: 'TAZA-001', precio: 100, costo: 30, stockInicial: 5, ubicacionId: rack.id });
    await req('/api/productos/' + taza.id + '/venta', 'POST', { cantidad: 1 });
    // product-multi-rack: mismo producto en 2 perchas con 2 personas
    const beto = await req('/api/promotoras', 'POST', { nombre: 'Beto Prueba', comisionBase: 30 });
    const rack2 = await req('/api/ubicaciones', 'POST', { nombre: 'Percha Dos', tipo: 'socio' });
    await req('/api/ubicaciones/' + rack2.id, 'PUT', { promotoraId: beto.id });
    const vela = await req('/api/productos', 'POST', { nombre: 'Vela Prueba', barcode: 'VELA-001', precio: 50, costo: 10, stockInicial: 4, ubicacionId: rack.id });
    await req('/api/productos/' + vela.id + '/venta', 'POST', { cantidad: 1 });
    await req('/api/productos/' + vela.id + '/venta', 'POST', { cantidad: 1, ubicacionId: rack2.id });
    // customer-debt
    await req('/api/clientes', 'POST', { nombre: 'Cliente Prueba' });
    // team-member: admin con PIN propio (solo el dueno puede crear admins)
    await req('/api/usuarios', 'POST', { nombre: 'Admin Prueba', pin: '514', rol: 'admin' });
    return { personId: ana.id, rackId: rack.id, productId: taza.id };
  });
  if (integridadPendiente) await provocarIntegridadPendiente(page);
  // 3) Volver a la pantalla de PIN: cada rol bajo prueba entra por su cuenta.
  await page.evaluate(() => window.OCAuth.salir && window.OCAuth.salir());
  return ids;
}

// integridadPendiente = lo que hace `info.integridad.ok === false` en la pantalla
// (index.html pintarSaldoCartera -> /api/clientes/:id/cartera ->
// AMG.Hechos.verificarCadenas). Mecanismo REAL, sin tocar docs/: se importa por
// la puerta publica `AMG.Hechos.importarRemoto` un hecho de OTRO aparato con hash
// valido pero con secuencia 2 y sin la 1 ("hueco de secuencia", como un sync que
// llego incompleto). Es el mismo caso de los incidentes de pago. Se comprueba
// que el efecto exista; si no, LANZA (nunca se ignora en silencio).
async function provocarIntegridadPendiente(page) {
  const razon = await page.evaluate(async () => {
    const H = window.AMG && window.AMG.Hechos;
    if (!H) throw new Error('AMG.Hechos no disponible');
    const hecho = { id: 'fixtureext-2', instanceId: 'fixtureext', autor: 'fixture', reloj: { fixtureext: 2 },
      ts: Date.now(), tipo: 'fixture-sync-incompleto', datos: {}, hashPrevio: 'h-1-ausente' };
    const base = JSON.stringify({ id: hecho.id, instanceId: hecho.instanceId, autor: hecho.autor,
      reloj: hecho.reloj, ts: hecho.ts, tipo: hecho.tipo, datos: hecho.datos, hashPrevio: hecho.hashPrevio });
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(base));
    hecho.hash = Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
    await H.importarRemoto(hecho);
    const clientes = await (await fetch('/api/clientes')).json();
    const c = clientes.find((x) => x.nombre === 'Cliente Prueba');
    const info = await (await fetch('/api/clientes/' + c.id + '/cartera')).json();
    return info && info.integridad && info.integridad.ok === false ? info.integridad.razon : null;
  });
  if (!razon) throw new Error('integridadPendiente: el mecanismo no produjo integridad.ok === false');
}
module.exports = { openApp, seedScenario };
