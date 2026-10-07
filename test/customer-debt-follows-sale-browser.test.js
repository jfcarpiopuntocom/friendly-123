/* Autor: Claude 2026-10-07. UI real de Customers: la deuda de una venta fiada sigue a la venta, filtro
   "Pending payment", boton de registrar pago, credito a favor y vinculo manual de un cargo antiguo.
   Chromium y WebKit, es y en. Datos sinteticos. RED externa total: todo lo que no sea file:// se aborta y
   window.WebSocket se reemplaza por un stub (sin red real, ni siquiera WebSocket). */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { chromium, webkit } = require('playwright');
const { pathToFileURL } = require('node:url');
const path = require('node:path');

const INDEX = pathToFileURL(path.resolve(__dirname, '../docs/index.html')).href;
const SIN_WEBSOCKET = `
window.WebSocket = class { constructor() { this.readyState = 3; } send() {} close() {} addEventListener() {} removeEventListener() {} };
window.WebSocket.CONNECTING = 0; window.WebSocket.OPEN = 1; window.WebSocket.CLOSING = 2; window.WebSocket.CLOSED = 3;`;

async function abrir(web, lang) {
  const ctx = await web.newContext({ viewport: { width: 390, height: 844 } });
  await ctx.route((u) => !/^(file|data|blob|about):/.test(u.protocol), (r) => r.abort());
  const page = await ctx.newPage();
  await page.addInitScript(SIN_WEBSOCKET);
  await page.addInitScript((l) => { try { localStorage.setItem('f123_lang', l); } catch (_) {} }, lang);
  await page.goto(INDEX, { waitUntil: 'load' });
  await page.waitForFunction(() => window.OCI18n && window.AMG && window.AMG.Cartera && typeof window.cargarClientes === 'function');
  await page.evaluate((l) => {
    window.OCAuth.rolActual = () => 'dueno';
    window.OCI18n.setLang(l);
  }, lang);
  return page;
}

for (const [engineName, engine] of [['Chromium', chromium], ['WebKit', webkit]]) {
  for (const lang of ['es', 'en']) {
    const tag = `${engineName}/${lang}`;
    test(`Customers: la deuda sigue a la venta, filtro Pending payment, pago, credito y vinculo manual (${tag})`, async (t) => {
      const web = await engine.launch({ headless: true });
      try {
        const page = await abrir(web, lang);
        const r = await page.evaluate(async () => {
          const wait = (ms) => new Promise((x) => setTimeout(x, ms));
          const req = async (u, m = 'GET', b) => { const res = await fetch(u, { method: m, headers: b ? { 'Content-Type': 'application/json' } : undefined, body: b ? JSON.stringify(b) : undefined }); const j = await res.json(); if (!res.ok) throw new Error(u + ' ' + res.status + ' ' + JSON.stringify(j)); return j; };
          const vista = (id) => { document.querySelectorAll('.vista').forEach((v) => v.classList.remove('activa')); document.getElementById(id).classList.add('activa'); };
          const card = (id) => document.querySelector('.cliente-card[data-cliente-id="' + id + '"]');
          const esperar = async (fn) => { for (let i = 0; i < 50; i++) { const v = fn(); if (v) return v; await wait(100); } return null; };
          const out = {};
          const prod = await req('/api/productos', 'POST', { nombre: 'Taza Fiada', barcode: 'FIADO-UI-1', precio: 108, costo: 5, stockInicial: 20 });
          const cli = await req('/api/clientes', 'POST', { nombre: 'Deudor Sigue' });
          // Camino nuevo: venta fiada + cargo ligado a su venta.
          const venta = await req('/api/productos/' + prod.id + '/venta', 'POST', { cantidad: 1, clienteId: cli.id, info: { formaPago: 'fiado' } });
          await req('/api/clientes/' + cli.id + '/fiar', 'POST', { monto: 108, motivo: 'Sale on credit: Taza', ventaId: venta.ventaId });
          // Cargo antiguo SIN venta + otra venta fiada a la que se ligara a mano.
          const venta2 = await req('/api/productos/' + prod.id + '/venta', 'POST', { cantidad: 1, clienteId: cli.id, info: { formaPago: 'fiado' } });
          await req('/api/ventas/' + venta2.ventaId, 'PATCH', { precioUnit: 25 });
          await req('/api/clientes/' + cli.id + '/fiar', 'POST', { monto: 108, motivo: 'Legacy charge' });
          // Correccion de precio de la primera venta: 108 -> 18.
          await req('/api/ventas/' + venta.ventaId, 'PATCH', { precioUnit: 18 });
          vista('vista-clientes');
          await cargarClientes();
          await esperar(() => card(cli.id) && (document.getElementById('cartera-' + cli.id) || {}).innerText);
          out.saldoApi = (await req('/api/clientes/' + cli.id + '/cartera')).saldo;
          out.texto1 = (document.getElementById('cartera-' + cli.id) || {}).innerText || '';
          const btnPagar = await esperar(() => card(cli.id) && card(cli.id).querySelector('button[onclick^="ocPagarDeuda"]'));
          out.pagarTexto = btnPagar ? btnPagar.innerText.trim() : null;
          out.pagarVisible = !!btnPagar && btnPagar.getBoundingClientRect().width > 0;
          // Filtro Pending payment
          const filtro = document.querySelector('#listaClientes [data-filtro="pendiente"]');
          out.filtroExiste = !!filtro;
          if (filtro) { filtro.click(); await wait(1500); out.enFiltro = !!card(cli.id); }
          // Vinculo manual: abrir el detalle, pulsar el boton del cargo antiguo
          const det = card(cli.id) && card(cli.id).querySelector('details');
          if (det) det.open = true;
          const btnLink = await esperar(() => card(cli.id) && card(cli.id).querySelector('[data-ui="cartera.link"]'));
          out.linkBotones = card(cli.id) ? card(cli.id).querySelectorAll('[data-ui="cartera.link"]').length : 0;
          out.linkTexto = btnLink ? btnLink.textContent.trim() : null;
          if (btnLink) {
            btnLink.click();
            await esperar(() => document.getElementById('oc-vinc-sel'));
            out.modalTexto = (document.getElementById('oc-modal-msg') || {}).innerText || '';
            out.opcionesN = document.querySelectorAll('#oc-vinc-sel option').length;
            document.querySelector('[data-ui="cartera.link-accept"]').click();
            await wait(800);
          }
          out.saldoTrasVinculo = (await req('/api/clientes/' + cli.id + '/cartera')).saldo;
          await esperar(() => /25/.test((document.getElementById('cartera-' + cli.id) || {}).innerText || ''));
          out.texto2 = (document.getElementById('cartera-' + cli.id) || {}).innerText || '';
          out.desvincularBoton = !!(card(cli.id) && card(cli.id).querySelector('[data-ui="cartera.unlink"]'));
          // Se apaga el filtro Pending payment (un cliente con credito ya no cae en el).
          const f2 = document.querySelector('#listaClientes [data-filtro="pendiente"]');
          if (f2) { f2.click(); await wait(1200); }
          // Sobrepago: pagos reales superiores al valor actual => credito a favor visible.
          await req('/api/clientes/' + cli.id + '/abonar', 'POST', { monto: 100, motivo: 'real payment' });
          await cargarClientes();
          await esperar(() => /(Cr[eé]dit)/.test((document.getElementById('cartera-' + cli.id) || {}).innerText || ''));
          out.saldoCredito = (await req('/api/clientes/' + cli.id + '/cartera')).saldo;
          out.textoCredito = (document.getElementById('cartera-' + cli.id) || {}).innerText || '';
          return out;
        });
        const es = lang === 'es';
        await t.test(`saldo derivado de las ventas actuales (venta corregida a 18 + cargo antiguo 108) [${tag}]`, () => {
          assert.equal(r.saldoApi, -(18 + 108), 'antes del vinculo: venta corregida a 18 + cargo antiguo de 108 sin ligar');
          assert.match(r.texto1, es ? /Deuda\s+\$126\.00/ : /Debt\s+\$126\.00/); /* v460: en espanol debe decir Deuda (arreglo de locale es-US) */
        });
        await t.test(`Registrar pago visible y en el idioma [${tag}]`, () => {
          assert.ok(r.pagarVisible);
          /* la hoja de estilos la pone en mayusculas: se compara sin distinguir caso */
          assert.equal(r.pagarTexto.toLowerCase(), es ? 'registrar pago' : 'record a payment');
        });
        await t.test(`el deudor sigue en el filtro Pending payment [${tag}]`, () => {
          assert.ok(r.filtroExiste); assert.ok(r.enFiltro);
        });
        await t.test(`vinculo manual: boton visible a dueno, antes/despues en pantalla, solo la venta elegible [${tag}]`, () => {
          assert.equal(r.linkBotones, 1);
          assert.equal(r.opcionesN, 1, 'solo la venta fiada del mismo cliente sin otro cargo');
          assert.match(r.modalTexto, /\$108\.00/, 'monto original del cargo');
          assert.match(r.modalTexto, /\$126\.00/, 'saldo antes');
          assert.match(r.modalTexto, /\$43\.00/, 'saldo despues (18 + 25)');
          assert.match(r.linkTexto, es ? /Vincular a venta/i : /Link to sale/i); /* v460: textos aprobados por JFC 2026-10-07 */
        });
        await t.test(`tras vincular el cargo sigue a su venta y se puede deshacer [${tag}]`, () => {
          assert.equal(r.saldoTrasVinculo, -43);
          assert.match(r.texto2, /(Deuda|Debt)\s+\$43\.00/);
          assert.ok(r.desvincularBoton);
        });
        await t.test(`pagos mayores que la deuda muestran credito a favor [${tag}]`, () => {
          assert.equal(r.saldoCredito, 57);
          assert.match(r.textoCredito, /(Cr[eé]dito|Credit)\s+\$57\.00/);
        });
      } finally { await web.close(); }
    });
  }
}
