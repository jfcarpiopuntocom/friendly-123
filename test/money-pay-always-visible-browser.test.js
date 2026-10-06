/* INVARIANTE "el boton de pagar nunca se esconde" (capability money-pay-always-visible), navegador real.
   Regla: si una vista de dinero muestra un saldo pendiente (> 0), TIENE que haber un control visible y habilitado
   para registrar ese pago. En 72h el boton desaparecio 3 veces por 3 caminos distintos (advertencia de integridad
   que ocultaba la deuda, integridad pendiente que sacaba al deudor del filtro "Pending payment", vista por producto
   del dashboard sin "Pay in the app"). Este test cubre esa clase completa, no un caso.

   Matriz: Chromium y WebKit, 390x844, idiomas es y en, estados normal e integridad-pendiente.
   Vistas: (1) Commissions por producto (tarjeta + ficha v454), (2) Commissions por percha, (3) Customers con fiado
   (sin y con el filtro "Pending payment"), (4) dashboard.html por producto y por percha.
   Visible = rect ancho/alto > 0, display != none, visibility != hidden, no disabled, alto >= 44px.
   El idioma del rotulo se revisa APARTE (subtest "idioma") para distinguir "no esta" de "esta en otro idioma".
   NO relajar estas aserciones para ponerlo en verde: un rojo es un hallazgo.

   Integridad pendiente: la app lee info.integridad.ok === false de GET /api/clientes/:id/cartera (index.html,
   pintarSaldoCartera y _deudaDe). Se simula envolviendo window.fetch para que esa respuesta lleve
   integridad {ok:false, razon}. Commissions y dashboard no leen ese campo; ahi el estado corre igual (envoltura
   activa) y sirve de guardia por si alguien lo empieza a leer. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { chromium, webkit } = require('playwright');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const fixture = require('./helpers/dashboard-comisiones-fixture.cjs');

const INDEX = pathToFileURL(path.resolve(__dirname, '../docs/index.html')).href;
const DASH = pathToFileURL(path.resolve(__dirname, '../docs/dashboard.html')).href;

/* Se inyecta en cada pagina: mide un elemento y devuelve un resumen serializable. */
const MEDIR = `
window.__medir = function (el) {
  if (!el) return { found: false };
  const r = el.getBoundingClientRect(), cs = getComputedStyle(el);
  return { found: true, w: r.width, h: r.height, display: cs.display, visibility: cs.visibility,
    disabled: !!el.disabled || el.getAttribute('aria-disabled') === 'true',
    text: (el.innerText || el.textContent || '').trim().replace(/\\s+/g, ' ') };
};
window.__envolverIntegridad = function () {
  const orig = window.fetch.bind(window);
  window.fetch = async function (u, o) {
    const res = await orig(u, o);
    if (/\\/api\\/clientes\\/[^/]+\\/cartera$/.test(String(u))) {
      const data = await res.clone().json();
      data.integridad = { ok: false, razon: 'cadena incompleta (simulada por el test)' };
      return new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    return res;
  };
};`;

function veredictoVisible(m) {
  if (!m || !m.found) return 'no existe en el DOM';
  const f = [];
  if (!(m.w > 0 && m.h > 0)) f.push('tamano ' + m.w + 'x' + m.h);
  if (m.display === 'none') f.push('display none');
  if (m.visibility === 'hidden') f.push('visibility hidden');
  if (m.disabled) f.push('deshabilitado');
  if (m.h < 44 - 0.01) f.push('alto ' + m.h + 'px < 44');
  return f.length ? f.join(', ') + ' (texto: "' + m.text + '")' : '';
}
function veredictoIdioma(m, lang) {
  if (!m || !m.found) return 'no existe en el DOM';
  const en = /\b(record|payment|pay in the app|a payment|credit|abono)\b/i, es = /\b(registrar|pago|pagar|cr[eé]dito|abono)\b/i;
  /* "abono" es palabra de ambos idiomas en la app (boton "Record credit (abono)"): no cuenta como espanol. */
  const texto = m.text.replace(/\(abono\)/ig, '');
  if (lang === 'es' && en.test(texto.replace(/abono/ig, ''))) return 'texto en ingles con idioma es: "' + m.text + '"';
  if (lang === 'en' && /\b(registrar|pago|pagar|cr[eé]dito)\b/i.test(texto)) return 'texto en espanol con idioma en: "' + m.text + '"';
  return '';
}

async function abrir(web, url, lang, integridad) {
  const page = await web.newPage({ viewport: { width: 390, height: 844 } });
  await page.addInitScript(MEDIR);
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.evaluate(({ lang, integridad }) => {
    if (window.OCAuth) window.OCAuth.rolActual = () => 'dueno';
    if (window.OCI18n && window.OCI18n.setLang) window.OCI18n.setLang(lang);
    if (integridad) window.__envolverIntegridad();
  }, { lang, integridad });
  return page;
}

for (const [engineName, engine] of [['Chromium', chromium], ['WebKit', webkit]]) {
  for (const lang of ['es', 'en']) {
    for (const estado of ['normal', 'integridad-pendiente']) {
      const integridad = estado !== 'normal';
      const tag = `${engineName}/${lang}/${estado}`;

      test(`Pagar siempre visible, app (${tag})`, async (t) => {
        const web = await engine.launch({ headless: true });
        try {
          const page = await abrir(web, INDEX, lang, integridad);
          const r = await page.evaluate(async () => {
            const wait = (ms) => new Promise(x => setTimeout(x, ms));
            const req = async (u, m = 'GET', b) => (await fetch(u, { method: m, headers: b ? { 'Content-Type': 'application/json' } : undefined, body: b ? JSON.stringify(b) : undefined })).json();
            const vista = (id) => { document.querySelectorAll('.vista').forEach(v => v.classList.remove('activa')); document.getElementById(id).classList.add('activa'); };
            const out = {};
            /* ---- Commissions: una persona, UNA percha, un producto vendido, sin pagar (debe > 0) ---- */
            const ana = await req('/api/promotoras', 'POST', { nombre: 'Ana Siempre', comisionBase: 40 });
            const rack = await req('/api/ubicaciones', 'POST', { nombre: 'Rack Siempre', tipo: 'socio' });
            await req('/api/ubicaciones/' + rack.id, 'PUT', { promotoraId: ana.id });
            const prod = await req('/api/productos', 'POST', { nombre: 'Taza Siempre', barcode: 'SIEMPRE-001', precio: 100, costo: 30, stockInicial: 5, ubicacionId: rack.id });
            await req('/api/productos/' + prod.id + '/venta', 'POST', { cantidad: 1 });
            vista('vista-comisiones');
            await cargarComisiones(); // sin tocar pestanas: arranca en By product
            await wait(150);
            const card = document.querySelector('[data-ui="commissions.product-card"][data-product-id="' + prod.id + '"]');
            out.cardProducto = !!card;
            out.productoPay = window.__medir(card && card.querySelector('[data-comm-pay-from-product]'));
            if (card) { card.click(); await wait(350); }
            out.fichaAbierta = !!document.querySelector('[data-ui="commissions.product-sheet"]');
            out.fichaPay = window.__medir(document.querySelector('[data-ficha-pay]'));
            if (out.fichaAbierta) cerrarFichaProducto();
            cambiarVistaComisiones('rack');
            await wait(100);
            out.rackPay = window.__medir(document.querySelector('[data-comm-pay-person]'));
            /* ---- Customers: fiado de 40, sin y con filtro Pending payment ---- */
            const cli = await req('/api/clientes', 'POST', { nombre: 'Deudor Siempre' });
            await req('/api/clientes/' + cli.id + '/fiar', 'POST', { monto: 40, motivo: 'test' });
            vista('vista-clientes');
            await cargarClientes();
            const esperarBoton = async (sel) => {
              for (let i = 0; i < 40; i++) { const b = document.querySelector('.cliente-card[data-cliente-id="' + cli.id + '"] ' + sel); if (b) return b; await wait(100); }
              return null;
            };
            out.cliPagar = window.__medir(await esperarBoton('button[onclick^="ocPagarDeuda"]'));
            out.cliAbono = window.__medir(await esperarBoton('button[onclick^="ocRegistrarCredito"]'));
            out.cartTxt = (document.getElementById('cartera-' + cli.id) || {}).innerText || '';
            const filtro = document.querySelector('#listaClientes [data-filtro="pendiente"]');
            out.filtroExiste = !!filtro;
            if (filtro) {
              filtro.click();
              await wait(1500);
              out.cliPagarFiltro = window.__medir(await esperarBoton('button[onclick^="ocPagarDeuda"]'));
              out.cliAbonoFiltro = window.__medir(await esperarBoton('button[onclick^="ocRegistrarCredito"]'));
              out.cliEnFiltro = !!document.querySelector('.cliente-card[data-cliente-id="' + cli.id + '"]');
            }
            return out;
          });
          const casos = [
            ['Commissions por producto: tarjeta (golden16)', r.productoPay],
            ['Commissions por producto: ficha v454 tras tocar tarjeta', r.fichaPay],
            ['Commissions por percha: Record payment', r.rackPay],
            ['Customers fiado: Record a payment', r.cliPagar],
            ['Customers fiado: Record credit (abono)', r.cliAbono],
            ['Customers filtro Pending payment: Record a payment', r.cliPagarFiltro || { found: false }],
            ['Customers filtro Pending payment: Record credit (abono)', r.cliAbonoFiltro || { found: false }],
          ];
          for (const [nombre, m] of casos) {
            await t.test(`${nombre} [${tag}] visible, habilitado, >=44px`, () => {
              assert.equal(veredictoVisible(m), '', nombre + ' observado: ' + JSON.stringify(m));
            });
            await t.test(`${nombre} [${tag}] idioma`, () => {
              assert.equal(veredictoIdioma(m, lang), '', nombre);
            });
          }
          await t.test(`Estado simulado efectivo [${tag}]`, () => {
            /* Guarda del propio test: la advertencia de integridad aparece solo en el estado integridad-pendiente. */
            assert.equal(/pending verification/i.test(r.cartTxt), integridad, 'texto de cartera: ' + r.cartTxt);
          });
          await t.test(`Customers filtro Pending payment lista al deudor [${tag}]`, () => {
            assert.ok(r.filtroExiste, 'el filtro Pending payment existe');
            assert.ok(r.cliEnFiltro, 'el deudor sigue en la lista con el filtro encendido');
          });
        } finally { await web.close(); }
      });

      test(`Pagar siempre visible, dashboard (${tag})`, async (t) => {
        const web = await engine.launch({ headless: true });
        try {
          const page = await abrir(web, DASH, lang, integridad);
          const r = await page.evaluate(async (datos) => {
            const wait = (ms) => new Promise(x => setTimeout(x, ms));
            const out = {};
            /* Estado post-login: igual que mostrar() de dashboard.html (puerta oculta, tablero visible). */
            document.getElementById('puerta').style.display = 'none';
            document.getElementById('cabecera').style.display = 'block';
            document.getElementById('tablero').style.display = 'block';
            window.OCDashComisiones.pintarConDatos(datos);
            await wait(100);
            const link = () => window.__medir(document.querySelector('#cm .cm-actions a.pagar'));
            out.productoPay = link();
            out.productoPendiente = /still to pay/i.test(document.getElementById('cm').innerText);
            const bp = document.querySelector('#cm [data-cm-vista="percha"]');
            if (bp) bp.click();
            await wait(100);
            out.perchaPay = link();
            return out;
          }, fixture.datos);
          assert.ok(r.productoPendiente, 'el fixture muestra saldo pendiente en el dashboard');
          const casos = [['dashboard por producto: Pay in the app', r.productoPay], ['dashboard por percha: Pay in the app', r.perchaPay]];
          for (const [nombre, m] of casos) {
            await t.test(`${nombre} [${tag}] visible, habilitado, >=44px`, () => {
              assert.equal(veredictoVisible(m), '', nombre + ' observado: ' + JSON.stringify(m));
            });
            await t.test(`${nombre} [${tag}] idioma`, () => {
              assert.equal(veredictoIdioma(m, lang), '', nombre);
            });
          }
        } finally { await web.close(); }
      });
    }
  }
}
