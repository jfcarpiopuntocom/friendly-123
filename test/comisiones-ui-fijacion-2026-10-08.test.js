/* Fixation tests: they pin current correct behavior (v468); they are not proof of a bug fix.
   Scope: the Commissions screen UI helpers that live inline in docs/index.html. Every test drives the REAL page
   in Chromium (same approach as commissions-money-ux-browser-v448.test.js) with the local mock backend, and
   names the function under test in its title. No network, no real licenses, no customer data. */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { pathToFileURL } = require('node:url');
const path = require('node:path');

let browser;
before(async () => { browser = await chromium.launch({ headless: true }); });
after(async () => { if (browser) await browser.close(); });

// Opens a fresh page (fresh storage) as the owner, with a tiny request helper and the Commissions view visible.
async function abrir(rol = 'dueno') {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.goto(pathToFileURL(path.resolve(__dirname, '../docs/index.html')).href, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.OCAuth && window.OCPayoutLedger && typeof cargarComisiones === 'function');
  await page.evaluate((r) => {
    window.OCAuth.rolActual = () => r;
    window.__req = async (u, m = 'GET', b) => {
      const res = await fetch(u, { method: m, headers: b ? { 'Content-Type': 'application/json' } : undefined, body: b ? JSON.stringify(b) : undefined });
      return res.json();
    };
    document.getElementById('vista-comisiones').hidden = false;
  }, rol);
  return page;
}

// Seeds one commission rack (socio, given %), one product and one sale of `precio`. Returns ids.
const SEMILLA = `async (o) => {
  const person = await __req('/api/promotoras', 'POST', { nombre: o.persona, comisionBase: o.pct });
  const rack = await __req('/api/ubicaciones', 'POST', { nombre: o.rack, tipo: 'socio' });
  await __req('/api/ubicaciones/' + rack.id, 'PUT', { promotoraId: person.id, comisionSocio: o.pct });
  const prod = await __req('/api/productos', 'POST', { nombre: o.prod, barcode: o.barcode, precio: o.precio, costo: o.costo, stockInicial: 9, ubicacionId: rack.id });
  for (let i = 0; i < (o.ventas || 1); i++) await __req('/api/productos/' + prod.id + '/venta', 'POST', { cantidad: 1 });
  return { personId: person.id, rackId: rack.id, prodId: prod.id };
}`;
const sembrar = (page, o) => page.evaluate(`(${SEMILLA})(${JSON.stringify(o)})`);

test('poblarSelectComisionistas: lists "None" first, escapes names and preselects the current one', async () => {
  // WHY: this select assigns money-bearing agents to racks; a name with markup must stay text, never HTML.
  const page = await abrir();
  try {
    const r = await page.evaluate(async () => {
      const p = await __req('/api/promotoras', 'POST', { nombre: '<b>Ana</b> & "Co"', comisionBase: 30 });
      await __req('/api/promotoras', 'POST', { nombre: 'Zed', comisionBase: 10 });
      const sel = document.createElement('select'); sel.id = 'sel-fix'; document.body.appendChild(sel);
      await poblarSelectComisionistas('sel-fix', p.id);
      const conValor = { value: sel.value, texts: [...sel.options].map(o => o.textContent), bold: !!sel.querySelector('b'), stored: p.nombre, id: p.id };
      await poblarSelectComisionistas('sel-fix');
      const sinValor = sel.value;
      const falta = await poblarSelectComisionistas('does-not-exist'); // must not throw
      return { conValor, sinValor, falta: falta === undefined };
    });
    assert.equal(r.conValor.texts[0], '— None —');
    assert.ok(r.conValor.stored.includes('<b>'), 'precondition: markup survived storage so escaping is really tested');
    assert.ok(r.conValor.texts.includes(r.conValor.stored), 'option text is the literal name');
    assert.equal(r.conValor.bold, false, 'no <b> element was created from the name');
    assert.ok(r.conValor.texts.includes('Zed'));
    assert.equal(r.conValor.value, r.conValor.id, 'valorActual is preselected');
    assert.equal(r.sinValor, '', 'without valorActual "None" is selected');
    assert.equal(r.falta, true, 'unknown select id is a silent no-op');
  } finally { await page.close(); }
});

test('_comisionFilaHtml: a tier row carries index, goal %, commission % and a remove button', async () => {
  // WHY: the editor reads these inputs back as money rules; attribute names and bounds are the contract.
  const page = await abrir();
  try {
    const r = await page.evaluate(() => ({ h: _comisionFilaHtml(50, 12, 3), goal: window.t('comm.ed.uptoGoal'), pct: window.t('comm.ed.pct'), rm: window.t('comm.ed.removeTier') }));
    assert.match(r.h, /data-fila="3"/);
    assert.match(r.h, /class="oc-com-hasta" value="50"/);
    assert.match(r.h, /class="oc-com-pct" value="12"/);
    assert.match(r.h, /class="oc-com-hasta"[^>]*>/);
    assert.ok(/min="1" step="1" class="oc-com-hasta"/.test(r.h), 'goal must be at least 1');
    assert.ok(/min="0" max="100" step="1" class="oc-com-pct"/.test(r.h), 'commission is 0..100');
    assert.ok(r.h.includes(r.goal) && r.h.includes(r.pct));
    assert.ok(r.h.includes(`aria-label="${r.rm}"`), 'remove button is labelled for screen readers');
    assert.ok(r.goal !== 'comm.ed.uptoGoal', 'label is translated, not a raw key');
  } finally { await page.close(); }
});

test('_comisionBarraHtml: one equal segment per tier with its %, goal caption, colors cycle every 6', async () => {
  // WHY: the bar is the owner's only visual check of the tier ladder before saving.
  const page = await abrir();
  try {
    const r = await page.evaluate(() => {
      const dos = _comisionBarraHtml([{ hasta: 50, comision: 10 }, { hasta: 100, comision: 25 }]);
      const siete = _comisionBarraHtml(Array.from({ length: 7 }, (_, i) => ({ hasta: (i + 1) * 10, comision: i })));
      return { vacia: _comisionBarraHtml([]), dos, siete, tip: window.tf('comm.ed.tierTitle', { hasta: 50, com: 10 }) };
    });
    assert.equal(r.vacia, '', 'no tiers, no bar');
    assert.equal((r.dos.match(/flex:1;background:/g) || []).length, 2, 'segments are equal width (flex:1), not proportional');
    assert.match(r.dos, />10%<\/div>/); assert.match(r.dos, />25%<\/div>/);
    assert.ok(r.dos.includes('≤50%') && r.dos.includes('≤100%'), 'captions show each goal');
    assert.ok(r.dos.includes(`title="${r.tip}"`), 'tooltip is the translated tier sentence');
    assert.ok(r.dos.indexOf('#4a7fa5') < r.dos.indexOf('#2f7a4f'), 'first two colors in order');
    assert.equal((r.siete.match(/background:#4a7fa5/g) || []).length, 2, 'seventh tier wraps to the first color');
  } finally { await page.close(); }
});

test('_comisionLeerFilas: reads back exactly the numbers typed; blanks and junk become 0', async () => {
  // WHY: this is the payload of the rack/agent tier ladder; a silent NaN would save garbage rules.
  const page = await abrir();
  try {
    const r = await page.evaluate(() => {
      const caja = document.createElement('div');
      caja.innerHTML = _comisionFilaHtml(50, 12, 0) + _comisionFilaHtml(100, 0, 1);
      const [f0, f1] = caja.querySelectorAll('.oc-com-fila');
      f0.querySelector('.oc-com-hasta').value = '75'; f0.querySelector('.oc-com-pct').value = '33.5';
      f1.querySelector('.oc-com-hasta').value = 'abc'; // number input rejects letters -> ''
      f1.querySelector('.oc-com-pct').value = '';
      return _comisionLeerFilas(caja);
    });
    assert.deepEqual(r, [{ hasta: 75, comision: 33.5 }, { hasta: 0, comision: 0 }]);
  } finally { await page.close(); }
});

test('_comisionRepintarBarra: repaint drops goal<=0 rows, shows the rest, and empties when none remain', async () => {
  // WHY: a half-typed row (goal 0) must not paint a fake tier; no #oc-com-barra must not crash the editor.
  const page = await abrir();
  try {
    const r = await page.evaluate(() => {
      const caja = document.createElement('div');
      caja.innerHTML = '<div id="oc-com-barra"></div>' + _comisionFilaHtml(80, 10, 0) + _comisionFilaHtml(0, 5, 1);
      _comisionRepintarBarra(caja);
      const uno = caja.querySelector('#oc-com-barra').innerHTML;
      caja.querySelectorAll('.oc-com-hasta').forEach(i => { i.value = '0'; });
      _comisionRepintarBarra(caja);
      const ninguno = caja.querySelector('#oc-com-barra').innerHTML;
      const sinBarra = document.createElement('div'); _comisionRepintarBarra(sinBarra);
      return { uno, ninguno };
    });
    assert.equal((r.uno.match(/flex:1;background:/g) || []).length, 1);
    assert.match(r.uno, />10%<\/div>/); assert.ok(!r.uno.includes('5%'), 'the goal-0 row is not painted');
    assert.ok(r.uno.includes('≤80%'));
    assert.equal(r.ninguno, '');
  } finally { await page.close(); }
});

test('abrirEditorComision: shows rack split mirrored to 100, escapes the name, validates tiers, saves round-trip', async () => {
  // WHY: associate% + house% must always add to 100 and the saved split must be what the owner typed.
  const page = await abrir();
  try {
    const r = await page.evaluate(async () => {
      const out = {};
      await abrirEditorComision('x', { id: 'x', nombre: '<i>Wall</i> & Co', comisionSocio: 40, metaMensual: 500, escalasComision: [{ hasta: 50, comision: 10 }, { hasta: 100, comision: 20 }] });
      const caja = document.getElementById('oc-comision-caja');
      const typed = (id, v) => { const el = document.getElementById(id); el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); };
      out.open = document.getElementById('oc-comision-overlay').style.display;
      out.title = caja.querySelector('.titulo').textContent; out.italic = !!caja.querySelector('.titulo i');
      out.start = [document.getElementById('oc-com-base').value, document.getElementById('oc-com-casa').value];
      out.meta = document.getElementById('oc-com-meta').value;
      out.bar0 = caja.querySelector('#oc-com-barra').textContent.replace(/\s+/g, ' ');
      out.sums = [0, 12.34, 33.5, 100].map(n => { typed('oc-com-base', n); return Number(document.getElementById('oc-com-base').value) + Number(document.getElementById('oc-com-casa').value); });
      typed('oc-com-base', 33.5); out.casa = document.getElementById('oc-com-casa').value; out.modal = document.getElementById('oc-com-modalidad').textContent;
      typed('oc-com-casa', 25); out.baseDesdeCasa = document.getElementById('oc-com-base').value;
      caja.querySelector('#oc-com-agregar').click();
      out.filasTrasAgregar = caja.querySelectorAll('.oc-com-fila').length;
      const nueva = [...caja.querySelectorAll('.oc-com-fila')].pop();
      out.nueva = [nueva.querySelector('.oc-com-hasta').value, nueva.querySelector('.oc-com-pct').value];
      nueva.querySelector('.oc-com-hasta').value = '0';
      let puts = 0; const f = window.fetch; window.fetch = (u, o) => { if (o && o.method === 'PUT') puts++; return f(u, o); };
      document.getElementById('oc-com-guardar').click();
      await new Promise(res => setTimeout(res, 50));
      out.msgGoal0 = document.getElementById('oc-com-msg').textContent; out.putsGoal0 = puts; out.tierNeeds = window.t('comm.ed.tierNeedsGoal');
      window.fetch = f;
      nueva.querySelector('.oc-com-quitar').click();
      out.filasTrasQuitar = caja.querySelectorAll('.oc-com-fila').length;
      cerrarEditorComision(); out.cerrado = [document.getElementById('oc-comision-overlay').style.display, document.getElementById('oc-comision-caja').innerHTML];

      // Real round trip on a real rack: type 45 -> save -> backend has 45 and the same ladder.
      const rack = await __req('/api/ubicaciones', 'POST', { nombre: 'Editor rack', tipo: 'socio', comisionSocio: 40 });
      const u = (await __req('/api/ubicaciones?todas=1')).find(x => x.id === rack.id);
      await abrirEditorComision(rack.id, u);
      const t2 = (id, v) => { const el = document.getElementById(id); el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); };
      t2('oc-com-base', 45);
      document.getElementById('oc-com-agregar').click();
      const fila = document.querySelector('#oc-com-filas .oc-com-fila');
      fila.querySelector('.oc-com-hasta').value = '200'; fila.querySelector('.oc-com-pct').value = '55';
      document.getElementById('oc-com-guardar').click();
      await new Promise(res => setTimeout(res, 300));
      const g = (await __req('/api/ubicaciones?todas=1')).find(x => x.id === rack.id);
      out.guardado = { socio: g.comisionSocio, escalas: g.escalasComision };
      return out;
    });
    assert.equal(r.open, 'flex');
    assert.equal(r.title.endsWith('<i>Wall</i> & Co'), true); assert.equal(r.italic, false);
    assert.deepEqual(r.start, ['40', '60']); assert.equal(r.meta, '500');
    assert.ok(r.bar0.includes('10%') && r.bar0.includes('20%') && r.bar0.includes('≤50%') && r.bar0.includes('≤100%'));
    assert.deepEqual(r.sums, [100, 100, 100, 100], 'associate + house = 100 after every keystroke');
    assert.equal(r.casa, '66.5'); assert.ok(r.modal.includes('33.5') && r.modal.includes('66.5'));
    assert.equal(r.baseDesdeCasa, '75');
    assert.equal(r.filasTrasAgregar, 3); assert.deepEqual(r.nueva, ['100', '0'], 'a new tier starts at goal 100, 0%');
    assert.equal(r.msgGoal0, r.tierNeeds); assert.equal(r.putsGoal0, 0, 'a tier with goal 0 never reaches the backend');
    assert.equal(r.filasTrasQuitar, 2);
    assert.deepEqual(r.cerrado, ['none', '']);
    assert.equal(Number(r.guardado.socio), 45); assert.deepEqual(r.guardado.escalas, [{ hasta: 200, comision: 55 }]);
  } finally { await page.close(); }
});

test('_atarFilasComision: binds a row once (remove + live repaint) and marks it with data-oc-listo', async () => {
  // WHY: rows added later must repaint the bar; double-binding would double-fire handlers.
  const page = await abrir();
  try {
    const r = await page.evaluate(() => {
      const caja = document.createElement('div');
      caja.innerHTML = '<div id="oc-com-barra"></div>' + _comisionFilaHtml(50, 10, 0);
      document.body.appendChild(caja);
      const fila = caja.querySelector('.oc-com-fila');
      const inp = (c, v) => { const e = fila.querySelector(c); e.value = v; e.dispatchEvent(new Event('input', { bubbles: true })); };
      inp('.oc-com-pct', '11');
      const antes = caja.querySelector('#oc-com-barra').innerHTML;
      _atarFilasComision(caja); _atarFilasComision(caja); // idempotent
      const listo = fila.dataset.ocListo;
      inp('.oc-com-hasta', '60'); inp('.oc-com-pct', '15');
      const durante = caja.querySelector('#oc-com-barra').textContent.replace(/\s+/g, '');
      fila.querySelector('.oc-com-quitar').click();
      return { antes, listo, durante, filas: caja.querySelectorAll('.oc-com-fila').length, despues: caja.querySelector('#oc-com-barra').innerHTML };
    });
    assert.equal(r.antes, '', 'unbound rows do not repaint');
    assert.equal(r.listo, '1');
    assert.equal(r.durante, '15%≤60%');
    assert.equal(r.filas, 0); assert.equal(r.despues, '');
  } finally { await page.close(); }
});

test('abrirEditorComisionista: loads the agent by id, keeps hostile text as text, saves base % round-trip', async () => {
  // WHY: this editor changes how much a person earns on every rack; it must show and save exactly what is stored.
  const page = await abrir();
  try {
    const r = await page.evaluate(async () => {
      const p = await __req('/api/promotoras', 'POST', { nombre: 'Ana <script>x</script>', comisionBase: 30, telefono: '099"x', banco: 'B&B' });
      await abrirEditorComisionista(p.id); // no object passed: it must fetch it
      const caja = document.getElementById('oc-comision-caja');
      const v = (id) => document.getElementById(id).value;
      const out = { title: caja.querySelector('.titulo').textContent, scripts: caja.querySelectorAll('script').length, base: v('oc-com-base'), tel: v('oc-com-tel'), banco: v('oc-com-banco') };
      document.getElementById('oc-com-base').value = '35';
      document.getElementById('oc-com-guardar').click();
      await new Promise(res => setTimeout(res, 300));
      const g = (await __req('/api/promotoras')).find(x => x.id === p.id);
      out.guardado = g.comisionBase; out.cerrado = document.getElementById('oc-comision-overlay').style.display;
      out.nombreIntacto = g.nombre === p.nombre;
      await abrirEditorComisionista('no-such-id'); out.inexistente = document.getElementById('oc-comision-caja').innerHTML === '';
      return out;
    });
    assert.ok(r.title.includes('Ana <script>x</script>')); assert.equal(r.scripts, 0);
    assert.equal(r.base, '30'); assert.equal(r.tel, '099"x'); assert.equal(r.banco, 'B&B');
    assert.equal(Number(r.guardado), 35); assert.equal(r.cerrado, 'none'); assert.equal(r.nombreIntacto, true);
    assert.equal(r.inexistente, true, 'unknown id opens nothing');
  } finally { await page.close(); }
});

// A sale moved to the previous month through the same path a backup/sync would use (as commissions-period.test.js does).
const MES_PASADO = `async (o) => {
  const s = await (${SEMILLA})(o);
  const d = new Date(); const y = d.getUTCMonth() === 0 ? d.getUTCFullYear() - 1 : d.getUTCFullYear(); const m = d.getUTCMonth() === 0 ? 12 : d.getUTCMonth();
  const prev = y + '-' + String(m).padStart(2, '0');
  const backup = await __req('/api/respaldo/exportar');
  backup.ventas.forEach(v => { if (v.productoId === s.prodId) v.fecha = prev + '-15T17:00:00.000Z'; });
  await __req('/api/respaldo/importar', 'POST', backup);
  return Object.assign(s, { prev });
}`;

test('selectorMesComisionesHtml + cambiarMesComisiones: current month by default, unpaid past month flagged in red, switching month swaps the listed sales', async () => {
  // WHY: a month with unpaid money must never be invisible; the listed rack must belong to the month chosen.
  const page = await abrir();
  try {
    const s = await page.evaluate(`(${MES_PASADO})(${JSON.stringify({ persona: 'Mes Persona', pct: 40, rack: 'Fixture month shelf', prod: 'Fixture month product', barcode: 'FIX-MES', precio: 50, costo: 20 })})`);
    const r = await page.evaluate(async ({ prev, rackId }) => {
      const meses = await __req('/api/liquidaciones/meses');
      const html = selectorMesComisionesHtml(meses);
      const cont = document.createElement('div'); cont.innerHTML = html.control; document.body.appendChild(cont);
      const aviso = document.createElement('div'); aviso.innerHTML = html.aviso;
      const filaPrev = meses.find(x => x.mes === prev);
      const out = {
        selected: cont.querySelector('select option[selected]').value, actual: meses.find(x => x.actual).mes,
        optPrev: [...cont.querySelectorAll('option')].find(o => o.value === prev).textContent, pend: filaPrev.pendiente, fm: fmtMoney(filaPrev.pendiente),
        jump: aviso.querySelector(`[data-commissions-jump="${prev}"]`) ? true : false, notaVacia: html.nota,
        vacio: selectorMesComisionesHtml([]).control
      };
      cambiarMesComisiones('garbage'); out.tras_basura = _ocMesComisiones;
      await new Promise(res => setTimeout(res, 300));
      out.textoActual = document.getElementById('listaComisiones').innerText.includes('Fixture month product'); out.sinVentasActual = document.getElementById('listaComisiones').innerText.includes('Racks with no sales this month (1): Fixture month shelf');
      cambiarMesComisiones(prev); out.tras_prev = _ocMesComisiones;
      await new Promise(res => setTimeout(res, 400));
      out.textoPrev = document.getElementById('listaComisiones').innerText.includes('1× Fixture month product$20.00');
      out.notaPrev = selectorMesComisionesHtml(meses).nota.length > 0;
      out.selPrev = selectorMesComisionesHtml(meses).control.includes(`value="${prev}" selected`);
      const liq = (await __req('/api/liquidaciones?mes=' + prev)).find(x => x.ubicacionId === rackId);
      out.liq = { comision: liq.comisionSocio, estado: liq.estado };
      cambiarMesComisiones(null); out.tras_null = _ocMesComisiones;
      return out;
    }, { prev: s.prev, rackId: s.rackId });
    assert.equal(r.selected, r.actual, 'no month chosen -> the current month is selected');
    assert.ok(r.optPrev.includes(r.fm), 'past month option shows what is still unpaid, formatted with fmtMoney');
    assert.ok(r.pend >= 20, 'the 40% of $50 = $20 is part of that month pending');
    assert.equal(r.jump, true, 'unpaid past month gets its jump button'); assert.equal(r.notaVacia, '');
    assert.equal(r.vacio, '', 'no months, no selector');
    assert.equal(r.tras_basura, null, 'an invalid month falls back to current, never "all"');
    assert.equal(r.textoActual, false, 'current month does not list the past-month sale'); assert.equal(r.sinVentasActual, true, 'its rack is reported as having no sales this month');
    assert.equal(r.tras_prev, s.prev); assert.equal(r.textoPrev, true, 'past month lists the sale with its $20.00 commission');
    assert.equal(r.notaPrev, true, 'a past month shows the "past month" note'); assert.equal(r.selPrev, true);
    assert.deepEqual(r.liq, { comision: 20, estado: 'pendiente' });
    assert.equal(r.tras_null, null);
  } finally { await page.close(); }
});

test('abrirDesgloseMesComisiones: "due" and "people" sheets list the same people and amounts as /api/liquidaciones; totals match the header', async () => {
  // WHY: the month sheet must never show money different from the backend ledger.
  const page = await abrir();
  try {
    await sembrar(page, { persona: 'Desglose Dana', pct: 40, rack: 'Desglose shelf', prod: 'Desglose prod', barcode: 'FIX-DESG', precio: 100, costo: 30, ventas: 2 });
    const r = await page.evaluate(async () => {
      await cargarComisiones();
      const snap = _ocComMonthDetail;
      const racks = await __req('/api/liquidaciones?mes=' + encodeURIComponent(snap.mes || ''));
      const out = { totals: snap.totals };
      for (const kind of ['due', 'people', 'sales', 'house', 'bogus']) {
        await abrirDesgloseMesComisiones(kind);
        const caja = document.getElementById('oc-comision-caja');
        out[kind] = { head: (caja.querySelector('strong') || {}).textContent || null, rows: caja.querySelectorAll('[data-comm-month-row]').length,
          pay: [...caja.querySelectorAll('[data-month-pay]')].map(b => [b.dataset.name, Number(b.dataset.due)]) };
        if (kind !== 'bogus') cerrarFichaProducto();
      }
      out.fm = { due: fmtMoney(snap.totals.due), sales: fmtMoney(snap.totals.sales), house: fmtMoney(snap.totals.house), people: fmtMoney(snap.totals.people) };
      out.back = racks.flatMap(f => (f.payoutBalances || []).filter(p => p.dueCents > 0 && p.payeeId).map(p => [p.nombre, p.due]));
      out.backEarned = racks.flatMap(f => (f.payoutBalances || []).filter(p => p.earned !== 0 || p.paid !== 0 || p.due !== 0)).length;
      return out;
    });
    assert.ok(r.due.head.endsWith(r.fm.due)); assert.ok(r.sales.head.endsWith(r.fm.sales));
    assert.ok(r.house.head.endsWith(r.fm.house)); assert.ok(r.people.head.endsWith(r.fm.people));
    assert.deepEqual(r.due.pay.sort(), r.back.sort(), 'pay buttons == backend payee balances');
    assert.equal(r.people.rows, r.backEarned, 'people sheet has one row per backend balance');
    assert.ok(r.due.pay.some(([n, d]) => n === 'Desglose Dana' && d === 80), '2 sales x $100 x 40% = $80 due');
    assert.equal(r.bogus.head, null, 'unknown kind opens nothing (head stays from the last real sheet or empty)');
  } finally { await page.close(); }
});

test('revisarComisionVenta: confirm text quotes the backend preview; cancel and empty reason change nothing; a reason assigns exactly that split', async () => {
  // WHY: this edits money after the fact; the owner must see the same numbers the backend will save.
  const page = await abrir();
  try {
    const r = await page.evaluate(async () => {
      const person = await __req('/api/promotoras', 'POST', { nombre: 'Revisa Rita', comisionBase: 40 });
      const rack = await __req('/api/ubicaciones', 'POST', { nombre: 'Casa rack', tipo: 'propio' });
      const prod = await __req('/api/productos', 'POST', { nombre: 'Casa prod', barcode: 'FIX-REV', precio: 100, costo: 30, stockInicial: 3, ubicacionId: rack.id });
      await __req('/api/productos/' + prod.id + '/venta', 'POST', { cantidad: 1 });
      const venta = (await __req('/api/ventas/todas?ubicacionId=todas')).find(v => v.productoId === prod.id);
      const prev = await __req('/api/ventas/' + venta.id + '/asignar-comision', 'POST', { promotoraId: person.id, preview: true });
      const msgs = []; let confirmar = false, motivo = '';
      window.ocConfirm = async (m) => { msgs.push(m); return confirmar; };
      window.ocPrompt = async () => motivo; window.ocAlert = async (m) => { msgs.push('ALERT:' + m); };
      const split = async () => { const v = (await __req('/api/ventas/todas?ubicacionId=todas')).find(x => x.id === venta.id); return { asociado: v.comisionAsociado, casa: v.netoCasa, corregida: v.comisionCorregida, promotoraId: v.promotoraId }; };
      await revisarComisionVenta(venta.id, person.id); const trasCancelar = await split();
      confirmar = true; motivo = '   '; await revisarComisionVenta(venta.id, person.id); const trasVacio = await split();
      motivo = 'typo in deal'; await revisarComisionVenta(venta.id, person.id); const final = await split();
      return { antes: { asociado: venta.comisionAsociado, casa: venta.netoCasa, corregida: venta.comisionCorregida, promotoraId: venta.promotoraId }, msg: msgs[0], expected: window.tf('comm.reviewConfirm', { name: prev.nombre, amount: fmtMoney(prev.split.montoComisionSocio), house: fmtMoney(prev.split.montoNetoDueno) }),
        trasCancelar, trasVacio, final, prevSocio: prev.split.montoComisionSocio, prevHouse: prev.split.montoNetoDueno };
    });
    assert.equal(r.msg, r.expected, 'confirm text is built from the backend preview');
    assert.deepEqual(r.trasCancelar, r.antes, 'cancel changes nothing'); assert.deepEqual(r.trasVacio, r.antes, 'an empty reason changes nothing');
    assert.equal(r.prevSocio, 40); assert.equal(r.prevHouse, 60);
    assert.equal(r.final.asociado, r.prevSocio); assert.equal(r.final.casa, r.prevHouse); assert.equal(r.final.corregida, true);
  } finally { await page.close(); }
});

test('editorComisionHtml (inside cargarComisiones): fix-the-percentage panel mirrors backend pct, escapes rack name, only for racks with sales', async () => {
  // WHY: the correction form pre-fills the % that will be rewritten on real sales; it must equal the backend value.
  const page = await abrir();
  try {
    await sembrar(page, { persona: 'Editor Edna', pct: 35, rack: 'Rack <b>&"x"', prod: 'Edit prod', barcode: 'FIX-EDH', precio: 80, costo: 10 });
    const r = await page.evaluate(async () => {
      await __req('/api/ubicaciones', 'POST', { nombre: 'Empty rack no sales', tipo: 'socio' });
      await cargarComisiones();
      const racks = await __req('/api/liquidaciones');
      const f = racks.find(x => x.ubicacion === 'Rack <b>&"x"');
      const uid = f.ubicacionId.replace(/[^a-z0-9]/gi, '');
      const btn = document.querySelector(`[data-corregir="${CSS.escape(f.ubicacionId)}"]`);
      const sinVentas = racks.find(x => x.ubicacion === 'Empty rack no sales');
      const sumario = [...document.querySelectorAll('#listaComisiones details summary')].filter(s => s.textContent.includes('Was the percentage wrong?')).length;
      return { aso: document.getElementById('cor-aso-' + uid).value, casa: document.getElementById('cor-casa-' + uid).value, pct: f.pctEfectivo != null ? f.pctEfectivo : f.pctBase,
        nombre: btn && btn.dataset.nombre, ventasBrutas: f.ventasBrutas, bold: !!btn.closest('details').querySelector('b'), sinVentas: sinVentas.ventasBrutas, sumario, editoresTotal: document.querySelectorAll('[data-corregir]').length,
        racksConVentas: racks.filter(x => x.ventasBrutas).length };
    });
    assert.equal(Number(r.aso), r.pct); assert.equal(Number(r.aso) + Number(r.casa), 100);
    assert.equal(r.nombre, 'Rack <b>&"x"', 'rack name round-trips through the data attribute unchanged'); assert.equal(r.bold, false);
    assert.equal(r.pct, 35);
    assert.equal(r.sinVentas || 0, 0); assert.equal(r.editoresTotal, r.racksConVentas, 'a panel for every rack with sales, none for racks without');
  } finally { await page.close(); }
});

test('_marcarComisionPagadaUnaVez: a double tap records ONE payment; invalid amounts and cancel record none; receipt quotes the ledger', async () => {
  // WHY: real money; two taps on "Record payment" must never pay twice, and bad amounts must never reach the ledger.
  const page = await abrir();
  try {
    const s = await sembrar(page, { persona: 'Pago Pia', pct: 40, rack: 'Pago shelf', prod: 'Pago prod', barcode: 'FIX-PAGO', precio: 100, costo: 30, ventas: 1 });
    const r = await page.evaluate(async (s) => {
      await cargarComisiones();
      const posts = []; const f0 = window.fetch;
      window.fetch = (u, o) => { if (String(u).includes('marcar-pagado')) posts.push(JSON.parse(o.body)); return f0(u, o); };
      const alerts = [], confirms = []; let medio = 'efectivo', monto = '10.00';
      window.ocAlert = async (m) => { alerts.push(m); };
      window.ocConfirm = async (m) => { confirms.push(m); return false; };
      window.ocPrompt = async () => monto;
      window._ocModalMostrar = async () => medio;
      const pagos = async () => (await __req('/api/payouts')).length;
      const due = 40, nombre = 'Pago Pia';

      medio = false; await marcarComisionPagada(s.rackId, nombre, due, s.personId); const trasCancelar = [posts.length, await pagos()];
      medio = 'efectivo';
      for (const mal of ['0', '-5', '1.234', 'abc', '40.01']) { monto = mal; await marcarComisionPagada(s.rackId, nombre, due, s.personId); }
      const trasMalos = [posts.length, await pagos(), alerts.length];

      monto = '10.00';
      // Double tap: second call starts while the first is still waiting for its modals.
      const a = marcarComisionPagada(s.rackId, nombre, due, s.personId);
      const b = marcarComisionPagada(s.rackId, nombre, due, s.personId);
      await Promise.all([a, b]);
      const trasDoble = { posts: posts.length, pagos: await pagos(), body: posts[0] };
      const dueDespues = (await __req('/api/liquidaciones')).find(x => x.ubicacionId === s.rackId).payoutBalances.find(p => p.payeeId === s.personId);
      window.fetch = f0;
      return { trasCancelar, trasMalos, alerts, trasDoble, confirm: confirms[0], dueDespues: dueDespues.due, paidDespues: dueDespues.paid, ok10: fmtMoney(10), ok30: fmtMoney(30) };
    }, s);
    assert.deepEqual(r.trasCancelar, [0, 0], 'cancelling the method modal records nothing');
    assert.deepEqual(r.trasMalos, [0, 0, 5], 'zero, negative, 3 decimals, text and overpayment never reach the ledger and each shows an alert');
    assert.ok(r.alerts.slice(0, 4).every(m => /valid amount/.test(m)) && /cannot exceed/.test(r.alerts[4]));
    assert.equal(r.trasDoble.posts, 1, 'double tap -> exactly one POST'); assert.equal(r.trasDoble.pagos, 1, 'and one payout in the ledger');
    assert.equal(r.trasDoble.body.amountCents, 1000); assert.equal(r.trasDoble.body.medioPago, 'efectivo');
    assert.ok(/^[0-9a-f-]{36}$/.test(r.trasDoble.body.opId), 'a UUID idempotency key travels with the payment');
    assert.equal(r.paidDespues, 10); assert.equal(r.dueDespues, 30);
    assert.ok(r.confirm.includes(r.ok10) && r.confirm.includes(r.ok30), 'receipt text = paid amount and remaining due as the ledger computed them');
  } finally { await page.close(); }
});

test('_marcarComisionPagadaUnaVez: if the reply is lost, the retry re-sends the SAME opId and the ledger keeps one payment', async () => {
  // WHY: a flaky network must never turn a retry into a second payout.
  const page = await abrir();
  try {
    const s = await sembrar(page, { persona: 'Retry Rosa', pct: 40, rack: 'Retry shelf', prod: 'Retry prod', barcode: 'FIX-RETRY', precio: 100, costo: 30, ventas: 1 });
    const r = await page.evaluate(async (s) => {
      const ops = []; const f0 = window.fetch; let perder = true;
      window.fetch = async (u, o) => {
        if (!String(u).includes('marcar-pagado')) return f0(u, o);
        ops.push(JSON.parse(o.body).opId);
        const res = await f0(u, o); // the server DID apply it...
        if (perder) { perder = false; throw new Error('reply lost'); } // ...but the phone never heard back
        return res;
      };
      const alerts = [];
      window.ocAlert = async (m) => { alerts.push(m); }; window.ocConfirm = async () => false;
      window.ocPrompt = async () => '15.00'; window._ocModalMostrar = async () => 'transferencia';
      await marcarComisionPagada(s.rackId, 'Retry Rosa', 40, s.personId);
      const trasFallo = (await __req('/api/payouts')).length;
      await marcarComisionPagada(s.rackId, 'Retry Rosa', 40, s.personId);
      window.fetch = f0;
      return { ops, alerts, trasFallo, final: (await __req('/api/payouts')).length };
    }, s);
    assert.equal(r.ops.length, 2); assert.equal(r.ops[0], r.ops[1], 'same intent -> same idempotency key');
    assert.ok(/NOT recorded/.test(r.alerts[0]), 'the owner is told plainly that the app is unsure; it does not claim success');
    assert.equal(r.trasFallo, 1); assert.equal(r.final, 1, 'retry did not create a second payout');
  } finally { await page.close(); }
});

test('pintarRetencionCfg: offers 0/7/14/30 with "no hold" selected by default, owner saves and the backend agrees, others see it disabled', async () => {
  // WHY: the hold decides when commissions become payable; the screen must show the stored value and never invite a non-owner to change it.
  const page = await abrir();
  try {
    const r = await page.evaluate(async () => {
      const host = document.createElement('div'); host.id = 'ocLealtadCfg'; document.body.appendChild(host);
      await pintarRetencionCfg();
      const sel = () => document.getElementById('ocRetDias');
      const out = { opciones: [...sel().options].map(o => o.value), seleccionada: sel().value, etiqueta0: sel().options[0].textContent, etiqueta7: sel().options[1].textContent, boton: !!document.getElementById('ocRetGuardar'), deshabilitado: sel().disabled };
      sel().value = '14'; document.getElementById('ocRetGuardar').click();
      await new Promise(res => setTimeout(res, 200));
      out.msg = document.getElementById('ocRetMsg').textContent; out.backend = (await __req('/api/config/retencion')).dias;
      await pintarRetencionCfg(); out.repintada = sel().value; out.cajas = document.querySelectorAll('#ocRetencionCfg').length;
      window.OCAuth.rolActual = () => 'empleado';
      await pintarRetencionCfg(); out.empDisabled = sel().disabled; out.empBoton = !!document.getElementById('ocRetGuardar'); out.empValor = sel().value;
      return out;
    });
    assert.deepEqual(r.opciones, ['0', '7', '14', '30']); assert.equal(r.seleccionada, '0', 'off by default');
    assert.match(r.etiqueta0, /No hold|Sin retención/); assert.match(r.etiqueta7, /^7 (days|días)$/);
    assert.equal(r.boton, true); assert.equal(r.deshabilitado, false);
    assert.match(r.msg, /Saved on this device|Guardado en este aparato/); assert.equal(r.backend, 14, 'the "Saved" message is true: the backend holds 14');
    assert.equal(r.repintada, '14'); assert.equal(r.cajas, 1, 'repainting reuses the same box');
    assert.equal(r.empDisabled, true); assert.equal(r.empBoton, false); assert.equal(r.empValor, '14', 'non-owner still sees the stored value');
  } finally { await page.close(); }
});
