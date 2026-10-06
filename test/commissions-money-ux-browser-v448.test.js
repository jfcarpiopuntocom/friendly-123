const { test } = require('node:test');
const assert = require('node:assert/strict');
const { chromium, webkit } = require('playwright');
const { pathToFileURL } = require('node:url');
const path = require('node:path');

for (const [engineName, engine] of [['Chromium', chromium], ['WebKit', webkit]]) {
test(`Money UX browser (${engineName}): partial payout renders person-first controls on mobile without overflow`, async () => {
  const web = await engine.launch({ headless: true });
  try {
    const page = await web.newPage({ viewport: { width: 390, height: 844 } });
    await page.goto(pathToFileURL(path.resolve(__dirname, '../docs/index.html')).href, { waitUntil: 'networkidle' });

    const result = await page.evaluate(async () => {
      window.OCAuth.rolActual = () => 'dueno';
      const req = async (u, m = 'GET', b) => {
        const r = await fetch(u, {
          method: m,
          headers: b ? { 'Content-Type': 'application/json' } : undefined,
          body: b ? JSON.stringify(b) : undefined
        });
        return r.json();
      };

      const person = await req('/api/promotoras', 'POST', { nombre: 'Candy Smith', comisionBase: 40 });
      const rack = await req('/api/ubicaciones', 'POST', { nombre: 'Artist wall', tipo: 'socio' });
      await req('/api/ubicaciones/' + rack.id, 'PUT', { promotoraId: person.id });
      const product = await req('/api/productos', 'POST', {
        nombre: 'Ceramic cup', barcode: 'CUP-MONEY-UX', precio: 100, costo: 30,
        stockInicial: 5, ubicacionId: rack.id
      });
      await req('/api/productos/' + product.id + '/venta', 'POST', { cantidad: 1 });
      await req('/api/liquidaciones/' + rack.id + '/marcar-pagado', 'POST', {
        payeeId: person.id, medioPago: 'transferencia', amountCents: 1500,
        opId: 'money-ux-browser-partial'
      });

      await cargarComisiones();
      const card = document.querySelector('[data-comm-person-card][data-payee-id="' + person.id + '"]');
      const pay = card && card.querySelector('[data-comm-pay-person]');
      const edit = card && card.querySelector('[data-comm-edit-person]');
      const statement = card && card.querySelector('[data-est-p="' + person.id + '"]');
      const history = card && card.querySelector('[data-comm-history-person]');
      const rackEdit = document.querySelector('[data-liq-ubic="' + rack.id + '"] [data-comm-edit-rack]');
      const rect = card && card.getBoundingClientRect();

      // Hugo/Paco/Luis: existence is not enough. Exercise the real editors.
      edit.click();
      await new Promise(r => setTimeout(r, 80));
      const personEditorOpen = document.getElementById('oc-comision-overlay').style.display === 'flex'
        && document.getElementById('oc-comision-caja').innerText.includes('Candy Smith');
      cerrarEditorComision();

      rackEdit.click();
      await new Promise(r => setTimeout(r, 80));
      const rackEditorOpen = document.getElementById('oc-comision-overlay').style.display === 'flex'
        && document.getElementById('oc-comision-caja').innerText.includes('Artist wall');
      cerrarEditorComision();

      // Sep 11 regression: dashboard deep-link must still reach the same real shelf editor.
      location.hash = '#editar=comisionpercha:' + encodeURIComponent(rack.id);
      procesarDeepLinkEditar();
      await new Promise(r => setTimeout(r, 900));
      const historicalDeepLinkOpen = document.getElementById('oc-comision-overlay').style.display === 'flex'
        && document.getElementById('oc-comision-caja').innerText.includes('Artist wall');
      cerrarEditorComision();

      return {
        text: card ? card.innerText : '',
        payText: pay ? pay.innerText : '',
        payMinHeight: pay ? getComputedStyle(pay).minHeight : '',
        edit: !!edit, statement: !!statement, history: !!history, rackEdit: !!rackEdit,
        personEditorOpen, rackEditorOpen, historicalDeepLinkOpen,
        cardLeft: rect ? rect.left : -1, cardRight: rect ? rect.right : 9999,
        viewport: window.innerWidth
      };
    });

    assert.match(result.text, /Candy Smith/);
    assert.match(result.text, /Earned/);
    assert.match(result.text, /Paid/);
    assert.match(result.text, /Still due/);
    assert.match(result.text, /partially paid/i);
    assert.match(result.payText, /Record .* payment/);
    assert.ok(result.edit, 'person deal pencil exists');
    assert.ok(result.rackEdit, 'rack deal pencil exists');
    assert.ok(result.statement, 'statement action exists');
    assert.ok(result.history, 'history exists');
    assert.ok(result.personEditorOpen, 'person pencil opens the existing commissionist editor');
    assert.ok(result.rackEditorOpen, 'rack pencil opens the existing shelf commission editor');
    assert.ok(result.historicalDeepLinkOpen, 'Sep 11 #editar=comisionpercha deep-link still opens the real shelf editor');
    assert.equal(result.payMinHeight, '44px');
    assert.ok(result.cardLeft >= 0 && result.cardRight <= result.viewport + 1, 'person money card stays within 390px viewport');
  } finally {
    await web.close();
  }
});
}
