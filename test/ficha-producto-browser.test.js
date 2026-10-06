/* Ficha de producto (v454), navegador real: Chromium y WebKit, 390x844, es y en.
   Producto vendido por 2 personas en 2 perchas, pago parcial a una. Se abre Commissions SIN tocar pestanas
   (la de por defecto es By product), se toca la tarjeta y se verifica la ficha contra el dinero real. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { chromium, webkit } = require('playwright');
const { pathToFileURL } = require('node:url');
const path = require('node:path');

for (const [engineName, engine] of [['Chromium', chromium], ['WebKit', webkit]]) {
  for (const lang of ['es', 'en']) {
    test(`Ficha de producto (${engineName}, ${lang}): quien vendio y cuanto gano, pago y totales`, async () => {
      const web = await engine.launch({ headless: true });
      try {
        const page = await web.newPage({ viewport: { width: 390, height: 844 } });
        await page.goto(pathToFileURL(path.resolve(__dirname, '../docs/index.html')).href, { waitUntil: 'networkidle' });
        const seed = await page.evaluate(async (lang) => {
          window.OCAuth.rolActual = () => 'dueno';
          if (window.OCI18n && window.OCI18n.setLang) window.OCI18n.setLang(lang);
          const req = async (u, m = 'GET', b) => (await fetch(u, { method: m, headers: b ? { 'Content-Type': 'application/json' } : undefined, body: b ? JSON.stringify(b) : undefined })).json();
          const ana = await req('/api/promotoras', 'POST', { nombre: 'Ana Prueba', comisionBase: 40 });
          const bea = await req('/api/promotoras', 'POST', { nombre: 'Bea Prueba', comisionBase: 30 });
          const r1 = await req('/api/ubicaciones', 'POST', { nombre: 'Rack Uno', tipo: 'socio' });
          const r2 = await req('/api/ubicaciones', 'POST', { nombre: 'Rack Dos', tipo: 'socio' });
          await req('/api/ubicaciones/' + r1.id, 'PUT', { promotoraId: ana.id });
          await req('/api/ubicaciones/' + r2.id, 'PUT', { promotoraId: bea.id });
          const prod = await req('/api/productos', 'POST', { nombre: 'Taza Ficha', barcode: 'FICHA-001', precio: 100, costo: 30, stockInicial: 10, ubicacionId: r1.id });
          await req('/api/productos/' + prod.id + '/venta', 'POST', { cantidad: 1 });
          const mv = await req('/api/productos/' + prod.id, 'PATCH', { ubicacionId: r2.id });
          await req('/api/productos/' + prod.id + '/venta', 'POST', { cantidad: 1 });
          await req('/api/liquidaciones/' + r1.id + '/marcar-pagado', 'POST', { payeeId: ana.id, medioPago: 'transferencia', amountCents: 1500, opId: 'ficha-parcial' });
          const prodB = await req('/api/productos', 'POST', { nombre: 'Jarron Otro', barcode: 'FICHA-002', precio: 50, costo: 10, stockInicial: 5, ubicacionId: r1.id });
          await req('/api/productos/' + prodB.id + '/venta', 'POST', { cantidad: 1 });
          const sheet = await req('/api/ledger/producto/' + prod.id);
          const sheetB = await req('/api/ledger/producto/' + prodB.id);
          return { prodB: prodB.id, sheetB, ana: ana.id, bea: bea.id, r1: r1.id, r2: r2.id, prod: prod.id, moved: JSON.stringify(mv).slice(0, 120), sheet };
        }, lang);
        // Cada persona con su ganancia exacta, Ana con pago parcial.
        const S = seed.sheet;
        assert.equal(S.people.length, 2, 'dos personas: ' + JSON.stringify(S) + seed.moved);
        const ana = S.people.find(p => p.personId === seed.ana), bea = S.people.find(p => p.personId === seed.bea);
        assert.equal(ana.paidCents, 1500);
        assert.ok(ana.earnedCents > 1500 && ana.dueCents === ana.earnedCents - 1500);
        assert.ok(bea.earnedCents > 0 && bea.paidCents === 0);
        assert.deepEqual(S.totals, { earnedCents: ana.earnedCents + bea.earnedCents, paidCents: 1500, dueCents: ana.dueCents + bea.dueCents });

        const out = await page.evaluate(async ({ ids }) => {
          const wait = (ms) => new Promise(r => setTimeout(r, ms));
          // v454: la ficha abre ANTES de que By rack se haya pintado nunca (sin tarjetas de percha en el DOM).
          const antes = { racksPintadas: document.querySelectorAll('[data-comm-pay-person]').length };
          await abrirFichaProducto(ids.prod);
          antes.abre = !!document.querySelector('[data-ui="commissions.product-sheet"]');
          antes.texto = antes.abre ? document.querySelector('[data-ui="commissions.product-sheet"]').innerText : '';
          cerrarFichaProducto();
          await cargarComisiones(); // sin cambiar de pestana: arranca en By product
          const card = document.querySelector('[data-ui="commissions.product-card"][data-product-id="' + ids.prod + '"]');
          const res = { antes, cardFound: !!card, role: card && card.getAttribute('role'), tabindex: card && card.getAttribute('tabindex') };
          const sheetEl = () => document.querySelector('[data-ui="commissions.product-sheet"]');
          // Teclado: Enter abre la ficha; Escape la cierra.
          card.focus();
          card.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
          await wait(300);
          res.openByEnter = !!sheetEl();
          document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
          res.closedByEscape = !sheetEl();
          card.click(); await wait(300);
          res.openByClick = !!sheetEl();
          const el = sheetEl();
          res.text = el.innerText;
          const rows = [...el.querySelectorAll('[data-ficha-person]')].map(r => ({
            id: r.dataset.fichaPerson, nums: [...r.querySelectorAll('.cifra')].map(c => c.innerText.trim())
          }));
          res.rows = rows;
          res.totals = [...el.querySelectorAll('[data-ficha-totals] .cifra')].map(c => c.innerText.trim());
          res.period = el.querySelector('[data-ficha-period]').innerText;
          const cents = (s) => Math.round(Number(String(s).replace(/[^0-9.\-]/g, '')) * 100);
          res.sumRows = [0, 1, 2].map(i => rows.reduce((a, r) => a + cents(r.nums[i]), 0));
          res.totalsCents = res.totals.map(cents);
          res.fmtAmounts = {
            anaDue: fmtMoney(ids.anaDueCents / 100), beaDue: fmtMoney(ids.beaDueCents / 100),
            anaEarned: fmtMoney(ids.anaEarnedCents / 100), anaPaid: fmtMoney(15)
          };
          const payAna = el.querySelector('[data-ficha-pay="' + ids.ana + '"]');
          const payBea = el.querySelector('[data-ficha-pay="' + ids.bea + '"]');
          const vis = (b) => { if (!b) return false; const r = b.getBoundingClientRect(); const cs = getComputedStyle(b); return r.width > 0 && r.height >= 44 && cs.display !== 'none' && cs.visibility !== 'hidden'; };
          res.payAnaVisible = vis(payAna); res.payBeaVisible = vis(payBea);
          res.payAnaText = payAna ? payAna.innerText : '';
          // Still due de la ficha == suma de lo debido en las perchas del producto (pestana By rack).
          res.rackDue = [ids.r1, ids.r2].map(rid => [...document.querySelectorAll('[data-comm-pay-person]')].filter(b => b.dataset.payRack === rid).reduce((a, b) => a + Number(b.dataset.payDue), 0));
          // Cierre por toque fuera.
          document.getElementById('oc-comision-overlay').dispatchEvent(new MouseEvent('click', { bubbles: true }));
          res.closedByOutside = !sheetEl();
          // Reabrir y pagar: el formulario de pago existente (modal) se abre para Ana.
          card.click(); await wait(300);
          sheetEl().querySelector('[data-ficha-pay="' + ids.ana + '"]').click();
          await wait(300);
          const modal = document.getElementById('oc-modal-overlay');
          res.payModalOpen = getComputedStyle(modal).display !== 'none' && /Ana Prueba/i.test(modal.innerText);
          res.sheetClosedForPay = !sheetEl();
          res.modalMsg = modal.innerText;
          // Completa el pago con el formulario existente: medio (2o boton: Efectivo/Cash), monto por defecto = saldo del producto.
          const btns = [...document.querySelectorAll('#oc-modal-botones button')];
          btns.find(b => /Efectivo|Cash/.test(b.textContent)).click();
          await wait(300);
          res.promptValue = (document.getElementById('oc-prompt-input') || {}).value;
          [...document.querySelectorAll('#oc-modal-botones button')].pop().click();
          await wait(600);
          // Otro alert (recibo) puede quedar abierto: se acepta.
          for (let i = 0; i < 3; i++) { const o = document.getElementById('oc-modal-overlay'); if (getComputedStyle(o).display !== 'none') { [...o.querySelectorAll('button')].pop().click(); await wait(300); } }
          res.sheetA = await (await fetch('/api/ledger/producto/' + ids.prod)).json();
          res.sheetB = await (await fetch('/api/ledger/producto/' + ids.prodB)).json();
          res.payouts = await (await fetch('/api/payouts')).json();
          return res;
        }, { ids: { prodB: seed.prodB, prod: seed.prod, ana: seed.ana, bea: seed.bea, r1: seed.r1, r2: seed.r2, anaDueCents: ana.dueCents, beaDueCents: bea.dueCents, anaEarnedCents: ana.earnedCents } });

        assert.ok(out.cardFound && out.role === 'button' && out.tabindex === '0', 'tarjeta tocable con role/tabindex');
        assert.ok(out.openByEnter && out.closedByEscape && out.openByClick && out.closedByOutside, 'abre por Enter/click, cierra por Escape y fuera');
        assert.match(out.text, /Ana Prueba/i); assert.match(out.text, /Bea Prueba/i);
        assert.match(out.text, lang === 'es' ? /Generado/i : /Earned/i);
        assert.match(out.text, lang === 'es' ? /Por pagar/i : /Still due/i);
        assert.match(out.period, /20\d\d/);
        const anaRow = out.rows.find(r => r.id === seed.ana), beaRow = out.rows.find(r => r.id === seed.bea);
        assert.deepEqual(anaRow.nums, [out.fmtAmounts.anaEarned, out.fmtAmounts.anaPaid, out.fmtAmounts.anaDue], 'montos exactos de Ana');
        assert.equal(beaRow.nums[2], out.fmtAmounts.beaDue, 'Por pagar de Bea');
        assert.deepEqual(out.sumRows, out.totalsCents, 'el total es la suma de las filas');
        assert.equal(out.totalsCents[0] - out.totalsCents[1], out.totalsCents[2], 'Earned - Paid = Still due');
        assert.ok(out.payAnaVisible && out.payBeaVisible, 'boton de pago visible (>=44px) para quien debe');
        assert.match(out.payAnaText, lang === 'es' ? /Registrar pago/i : /Record .* payment/i);
        const rackSum = out.rackDue.reduce((a, b) => a + b, 0);
        // By rack suma TODO lo que cada persona debe en la percha: la ficha de A + lo que Ana debe del producto B (misma percha).
        assert.equal(Math.round(rackSum * 100), out.totalsCents[2] + seed.sheetB.totals.dueCents, 'Still due de la ficha + otros productos == By rack');
        assert.ok(out.sheetClosedForPay && out.payModalOpen, 'el pago abre el formulario existente de Ana');
        assert.equal(out.antes.racksPintadas, 0, 'By rack no se habia pintado');
        assert.ok(out.antes.abre && /Ana Prueba/i.test(out.antes.texto) && /Bea Prueba/i.test(out.antes.texto), 'la ficha abre sin By rack renderizado');
        assert.match(out.modalMsg, /Taza Ficha/, 'la confirmacion nombra el producto');
        assert.equal(out.promptValue, (ana.dueCents / 100).toFixed(2), 'monto por defecto = saldo de ESTE producto');
        // Pagar el producto A (25.00) no toca el producto B de Ana: su saldo queda igual al centavo.
        const anaA = out.sheetA.people.find(p => p.personId === seed.ana), anaB0 = seed.sheetB.people.find(p => p.personId === seed.ana), anaB1 = out.sheetB.people.find(p => p.personId === seed.ana);
        assert.equal(anaA.dueCents, 0, 'producto A de Ana liquidado');
        assert.equal(anaA.paidCents, anaA.earnedCents);
        assert.deepEqual(anaB1, anaB0, 'producto B intacto');
        const pagoNuevo = out.payouts.filter(p => p.opId !== 'ficha-parcial');
        assert.equal(pagoNuevo.length, 1);
        assert.equal(pagoNuevo[0].amountCents, ana.dueCents);
        assert.ok(pagoNuevo[0].items.every(i => i.kind === 'sale'), 'solo ventas');
      } finally { await web.close(); }
    });
  }
}
