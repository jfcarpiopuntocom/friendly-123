'use strict';
// Verifies every remaining Notion War Room closure item without scope creep:
// 1) Customers: 2-device monotonic delete (never resurrected by stale offline edit);
//    $20 paid on $15 item-scoped debt settles the item & shows "Paid · Credit balance" / "Pagado · Saldo a favor".
// 2) Commissions All-dates "By artist / associate": Persona pulldown populated across all dates
//    from OCCommissionHistory.facets and honors cumulative date + filter selection.
// 3) Dashboard monthly view honors cumulative filters cleanly without shadowing .cm-card selectors.
// 4) Split commission associate filter isolates only the matching payee's commission share.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { webkit } = require('playwright');
const { pathToFileURL } = require('node:url');
const path = require('node:path');

const core = require('../docs/core/commission-history.js');

const SALES = [
  {
    id: 'sep-ana', fecha: '2026-09-10T16:00:00Z', fechaLocal: '2026-09-10', mes: '2026-09',
    productoId: 'p-book', productoNombre: 'Book', ubicacionId: 'r1', ubicacionNombre: 'Rack 1',
    clienteId: 'c1', clienteNombre: 'Maria', promotoraId: 'a-ana', asociadoNombre: 'Ana',
    cantidad: 1, precioUnit: 100, comisionPct: 20, comisionAsociado: 20, netoCasa: 80
  },
  {
    id: 'nov-ana', fecha: '2026-11-05T16:00:00Z', fechaLocal: '2026-11-05', mes: '2026-11',
    productoId: 'p-print', productoNombre: 'Print', ubicacionId: 'r2', ubicacionNombre: 'Rack 2',
    clienteId: 'c2', clienteNombre: 'Luis', promotoraId: 'a-ana', asociadoNombre: 'Ana',
    cantidad: 1, precioUnit: 50, comisionPct: 20, comisionAsociado: 10, netoCasa: 40
  },
  {
    id: 'nov-beto', fecha: '2026-11-07T16:00:00Z', fechaLocal: '2026-11-07', mes: '2026-11',
    productoId: 'p-book', productoNombre: 'Book', ubicacionId: 'r1', ubicacionNombre: 'Rack 1',
    clienteId: 'c3', clienteNombre: 'Sofia', promotoraId: 'a-beto', asociadoNombre: 'Beto',
    cantidad: 1, precioUnit: 200, comisionPct: 10, comisionAsociado: 20, netoCasa: 180
  }
];

test('split commission associate filter isolates only matching payee share', () => {
  const splitSale = {
    id: 'split-1', fechaLocal: '2026-11-10', productoId: 'p-book', productoNombre: 'Book',
    ubicacionId: 'r1', ubicacionNombre: 'Rack 1', cantidad: 1, precioUnit: 100, comisionAsociado: 30,
    reparto: [{ promotoraId: 'a-ana', nombre: 'Ana', monto: 20 }, { promotoraId: 'a-beto', nombre: 'Beto', monto: 10 }]
  };
  const out = core.project({ sales: [splitSale], filtros: { comisionista: ['a-ana'] }, group: 'comisionista' });
  assert.equal(out.totals.commission, 20);
  assert.deepEqual(out.groups.map((g) => g.id), ['a-ana']);
});

test('historical associates with missing names retain their distinct identifiers', () => {
  const sales = ['older-ana', 'older-beto'].map((id) => ({
    id, promotoraId: id, ubicacionId: 'r1', cantidad: 1, precioUnit: 20, comisionAsociado: 4
  }));
  const { rows } = core.project({ sales, group: 'comisionista', associateDetails: true });
  assert.deepEqual(rows.map(({ associate }) => [associate.id, associate.name, associate.commissionCents]), [
    ['older-ana', 'older-ana', 400], ['older-beto', 'older-beto', 400]
  ]);
});

test('WebKit: 2-device monotonic customer delete + $20 paid on $15 item debt + Paid/Credit label', async () => {
  const browser = await webkit.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 412, height: 860 } });
    await page.goto(pathToFileURL(path.resolve(__dirname, '../docs/index.html')).href, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__ocMockBackendReady === true && window.OCSync && window.AMG && window.AMG.Cartera);
    await page.addStyleTag({ content: '#oc-gate,#puerta,#oc-splash{display:none!important;pointer-events:none!important}' });

    // 1. Create two customers, delete cDel, then apply stale higher-rev edit from Device B -> cDel MUST stay deleted!
    const delResult = await page.evaluate(async () => {
      window.OCAuth = Object.assign(window.OCAuth || {}, { rolActual: () => 'dueno', esDemo: () => false });
      const created = await (await fetch('/api/clientes', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nombre: 'Belen Delete Check', telefono: '099111222' })
      })).json();
      const delRes = await fetch('/api/clientes/' + encodeURIComponent(created.id), {
        method: 'DELETE', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ quien: 'owner' })
      });
      if (!delRes.ok) throw new Error('DELETE failed: ' + delRes.status);
      // Stale remote catalog from Device B with higher rev and borrado: false
      window.OCSync.aplicarCatalogo({
        ubicaciones: [], productos: [],
        clientes: [{ id: created.id, nombre: 'Belen Edited Offline', borrado: false, rev: '9999999999999-zzzz-9999' }],
        promotoras: [], sucursales: []
      }, 'dueno');
      const liveList = await (await fetch('/api/clientes')).json();
      return { id: created.id, stillPresent: liveList.some((x) => x.id === created.id) };
    });
    assert.equal(delResult.stillPresent, false, 'deleted customer must never resurrect via stale 2-device sync');

    // 2. Customer owes $15 item-scoped debt; pays $20 via /abonar + /aplicar ($15 on cargo) -> item paid + $5 credit shown!
    const payResult = await page.evaluate(async () => {
      const cust = await (await fetch('/api/clientes', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nombre: 'Customer 20 on 15' })
      })).json();
      const fiarRes = await (await fetch('/api/clientes/' + cust.id + '/fiar', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ monto: 15, motivo: 'Painting [for:Oil Print]', opId: 'fiar-20-15-' + Date.now() })
      })).json();
      const before = await (await fetch('/api/clientes/' + cust.id + '/cartera')).json();
      const cargoKey = before.consumosPendientes[0].cargoKey;
      const abonoRes = await (await fetch('/api/clientes/' + cust.id + '/abonar', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ monto: 20, motivo: 'Abono', opId: 'customer-payment:pay20on15-' + Date.now() })
      })).json();
      const appRes = await fetch('/api/clientes/' + cust.id + '/aplicar', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ abonoId: abonoRes.movimientoId, partes: [{ cargoKey, monto: 15 }], opId: 'alloc-20-15-' + Date.now() })
      });
      const after = await (await fetch('/api/clientes/' + cust.id + '/cartera')).json();
      // Mount card placeholder and paint balance via pintarSaldoCartera
      const holder = document.createElement('div');
      holder.id = 'cartera-' + cust.id;
      document.body.appendChild(holder);
      await window.pintarSaldoCartera(cust.id);
      return {
        fiarOk: !!fiarRes.movimientoId,
        appStatus: appRes.status,
        pendingAfter: (after.consumosPendientes || []).length,
        saldoAfter: after.saldo,
        badgeText: holder.innerText
      };
    });
    assert.equal(payResult.appStatus, 200);
    assert.equal(payResult.pendingAfter, 0, 'item debt of $15 is completely settled');
    assert.equal(payResult.saldoAfter, 5, 'paying $20 on $15 leaves +$5 credit balance');
    assert.match(payResult.badgeText, /Paid|Pagado/, 'card clearly shows Paid label when settled with credit balance');
    assert.match(payResult.badgeText, /\$5\.00/, 'card shows $5.00 credit balance');
  } finally {
    await browser.close();
  }
});

test('WebKit: All-dates By artist / associate Persona dropdown & cumulative filters + Dashboard monthly filters', async () => {
  const browser = await webkit.launch({ headless: true });
  try {
    // 1. App: All-dates By artist / associate works across months & combines with C248 _ocComDesde/_ocComHasta
    const page = await browser.newPage({ viewport: { width: 412, height: 860 } });
    await page.goto(pathToFileURL(path.resolve(__dirname, '../docs/index.html')).href, { waitUntil: 'load' });
    await page.waitForFunction(() => window.OCCommissionHistory && window.F123CommissionsByPerson && typeof window.cargarComisiones === 'function');
    await page.addStyleTag({ content: '#oc-gate,#puerta,#oc-splash{display:none!important;pointer-events:none!important}' });

    await page.evaluate((sales) => {
      window.fetch = (url) => {
        if (String(url).includes('/ventas/todas')) return Promise.resolve({ ok: true, json: async () => sales });
        return Promise.resolve({ ok: true, json: async () => [] });
      };
      const vista = document.getElementById('vista-comisiones');
      vista.hidden = false; vista.style.display = 'block'; vista.classList.add('activa');
      window._ocMesComisiones = null;
      return window.cargarComisiones();
    }, SALES.concat({
      ...SALES[0], id: 'sep-celia', promotoraId: 'a-celia', asociadoNombre: 'Celia'
    }));

    // Tap By artist / associate -> Persona dropdown MUST list Ana & Beto and render both across all dates
    await page.click('#comm-tab-person');
    await page.waitForFunction(() => {
      const p = document.querySelector('#comm-panel-person');
      return p && !p.hidden && p.innerText.includes('Ana') && p.innerText.includes('Beto');
    });
    const opts = await page.locator('[data-commissions-person-select] option').allTextContents();
    assert.ok(opts.includes('Ana') && opts.includes('Beto') && opts.includes('Celia'),
      'Persona includes associates whose sales exist only in earlier months');

    await page.evaluate(() => window.cargarComisiones());
    await page.waitForFunction(() => {
      const select = document.querySelector('[data-commissions-person-select]');
      return select && [...select.options].some((option) => option.value === 'a-celia');
    });

    await page.evaluate(() => {
      window._ocComHistorySales.push({
        id: 'invalid-split', fechaLocal: '2026-09-11', ubicacionId: 'r1', ubicacionNombre: 'Rack 1',
        cantidad: 1, precioUnit: 50, comisionAsociado: 10,
        reparto: [
          { promotoraId: 'a-ana', nombre: 'Ana', monto: 8 },
          { promotoraId: 'a-beto', nombre: 'Beto', monto: 7 }
        ]
      });
      window.F123CommissionsByPerson.refresh();
    });
    const people = page.locator('#comm-panel-person [data-cm-person-id]');
    for (const id of ['a-ana', 'a-beto']) {
      const person = people.and(page.locator('[data-cm-person-id="' + id + '"]'));
      assert.match(await person.locator('.cifra').first().innerText(), /Needs review|Por verificar/);
      await person.locator('summary').click();
      assert.match(await person.locator('[data-cm-person-rack="r1"]').innerText(), /Needs review|Por verificar/);
    }

    // Narrow date range to Nov only -> Ana drops from $30 ($20+$10) to $10, Persona STILL has Ana!
    await page.evaluate(() => {
      window.ocComFechaCambiar('desde', '2026-11-01');
      window.ocComFechaCambiar('hasta', '2026-11-30');
    });
    await page.waitForFunction(() => {
      const p = document.querySelector('#comm-panel-person');
      return p && p.querySelector('[data-cm-person-id="a-ana"]') && /\$10\.00/.test(p.querySelector('[data-cm-person-id="a-ana"]').innerText);
    });
    await page.selectOption('[data-commissions-person-select]', 'a-ana');
    await page.waitForFunction(() => {
      const p = document.querySelector('#comm-panel-person');
      return p && p.innerText.includes('Ana') && !p.innerText.includes('Beto');
    });
    await browser.close();
  } catch (e) {
    try { await browser.close(); } catch (_) {}
    throw e;
  }

  // 2. Dashboard: cumulative filters also work inside selected Month AND do not break .cm-card selectors
  const browser2 = await webkit.launch({ headless: true });
  try {
    const page2 = await browser2.newPage({ viewport: { width: 1280, height: 860 } });
    await page2.goto(pathToFileURL(path.resolve(__dirname, '../docs/dashboard.html')).href, { waitUntil: 'load' });
    await page2.waitForFunction(() => window.OCDashComisiones && typeof window.OCDashComisiones.pintarConDatos === 'function');
    await page2.addStyleTag({ content: '#puerta,#oc-splash{display:none!important;pointer-events:none!important} main,#dash,#cm{display:block!important;visibility:visible!important}' });
    await page2.evaluate((sales) => {
      document.body.classList.add('abierto');
      const cm = document.getElementById('cm');
      cm.classList.add('activa');
      for (let el = cm; el; el = el.parentElement) { el.hidden = false; if (el.style) el.style.display = ''; }
      window.OCDashComisiones.pintarConDatos({
        ventas: sales,
        perchas: [{ id: 'r1', nombre: 'Rack 1', promotoraId: 'a-ana' }, { id: 'r2', nombre: 'Rack 2', promotoraId: 'a-ana' }],
        liquidaciones: [], ajustesComision: []
      });
      cm.classList.add('activa');
      for (let el = cm; el; el = el.parentElement) { el.hidden = false; if (el.style) el.style.display = ''; }
    }, SALES);
    await page2.selectOption('#cm-mes', '2026-11');
    await page2.waitForSelector('[data-cm-vista="producto"]');
    // In Nov before filter: $250 ($50 + $200). Check Associate = Ana -> $50!
    await page2.locator('[data-cm-filtros] details').first().locator('summary').click();
    await page2.locator('input[data-cm-filtro="comisionista"][value="a-ana"]').check();
    await page2.waitForFunction(() => document.getElementById('cm').innerText.includes('$50.00') && !document.getElementById('cm').innerText.includes('Beto'));
    assert.equal(await page2.locator('#cm .cm-card[data-cm-filtros]').count(), 0, 'filter bar must not have .cm-card class');
  } finally {
    await browser2.close();
  }
});
