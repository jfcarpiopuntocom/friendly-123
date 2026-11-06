'use strict';
// v676+ Inventory polish: synthetic UI contracts only. Never send a real stock movement.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { chromium, webkit } = require('playwright');

const source = fs.readFileSync(path.join(__dirname, '../src/app/app-inline-01.js'), 'utf8');
const shipped = fs.readFileSync(path.join(__dirname, '../docs/app-inline-01.min.js'), 'utf8');
const start = source.indexOf('var _inventarioHtmlPorNodo = new WeakMap();');
const end = source.indexOf('async function cargarInventario(){', start);
assert.ok(start > 0 && end > start, 'read actual inventory reconciler');
const reconciler = source.slice(start, end);

for (const [label, engine] of [['Chromium', chromium], ['WebKit', webkit]]) {
  test(label + ': changed stock card replaces one node without an intermediate extra card or full refresh', async () => {
    const browser = await engine.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.setContent('<div id="gridInventario"></div>');
      await page.evaluate(s => (0, eval)(s), reconciler);
      const result = await page.evaluate(() => {
        const grid = document.getElementById('gridInventario');
        const cards = Array.from({length: 300}, (_, i) => ({ id: 'p' + i,
          html: '<div data-inv-id="p' + i + '"><span class="stock">' + i + '</span></div>' }));
        const toggle = '<div id="inv-toggle">Inventory</div>';
        reconciliarGridInventario(grid, toggle, cards);
        const unchanged = grid.children[200], old = grid.children[101];
        const nativeInsert = grid.insertBefore.bind(grid);
        let additionalInsertions = 0;
        grid.insertBefore = function (...args) { additionalInsertions++; return nativeInsert(...args); };
        cards[100] = { id: 'p100', html: '<div data-inv-id="p100"><span class="stock">33</span></div>' };
        reconciliarGridInventario(grid, toggle, cards);
        return {
          extra: additionalInsertions,
          count: grid.querySelectorAll('[data-inv-id]').length,
          changed: grid.children[101].querySelector('.stock').textContent,
          kept: grid.children[200] === unchanged,
          oldDetached: !old.isConnected
        };
      });
      assert.deepEqual(result, { extra: 0, count: 300, changed: '33', kept: true, oldDetached: true });
    } finally { await browser.close(); }
  });
}

test('manual Inventory count commits and refreshes only the active Inventory view, not hidden Today', async () => {
  const a = source.indexOf('  async function ajustarConCajita(id) {');
  const b = source.indexOf('  // Estrella:', a);
  assert.ok(a > 0 && b > a, 'actual quantity box handler is present');
  const hits = [];
  const ctx = {
    API: '/api', Promise, JSON,
    t: key => key,
    pedirCantidadStock: async () => ({ modo: 'fijar', n: 33 }),
    pedirMotivoAjuste: async () => 'reason',
    fetch: async (url, opts) => { hits.push({ type: 'POST', url, body: JSON.parse(opts.body) }); return {ok:true, json:async()=>({})}; },
    cargarInventario: async () => { hits.push({type:'Inventory'}); },
    cargarHoy: async () => { hits.push({type:'Today'}); },
    ocAlert: async txt => { hits.push({ type:'alert',txt }); }
  };
  vm.runInNewContext(source.slice(a,b) + '\nthis.run = ajustarConCajita;', ctx);
  await ctx.run('synthetic-product-id');
  assert.equal(hits.filter(h => h.type === 'POST').length, 1, 'no duplicate stock mutation');
  assert.deepEqual(hits[0].body, {stockFisico: 33, motivo:'inv.qtySetReason'});
  assert.equal(hits.filter(h => h.type === 'Inventory').length, 1);
  assert.equal(hits.filter(h => h.type === 'Today').length, 0, 'Today must refresh on navigation rather than during Inventory adjustment');
  assert.equal(hits.filter(h => h.type === 'alert').length, 0);
  // Preserve the shipped bundle contract: generated code must not still do both loads.
  const minStart = shipped.indexOf('async function ajustarConCajita(id)');
  const minEnd = shipped.indexOf('data-estrella-toggle', minStart);
  assert.ok(minStart > 0 && minEnd > minStart);
  assert.doesNotMatch(shipped.slice(minStart,minEnd), /Promise\.all\(\[cargarInventario\(\),cargarHoy\(\)\]\)/);
});

test('Inventory quick +/- handler avoids the same unnecessary hidden Today refresh', () => {
  const a = source.indexOf('  // Ajuste rápido +/- stock sin escanear.');
  const b = source.indexOf('  // JFC 2026-11-01: owner/admin quantity box.', a);
  assert.ok(a > 0 && b > a);
  assert.doesNotMatch(source.slice(a,b), /Promise\.all\(\[cargarInventario\(\), cargarHoy\(\)\]\)/);
});

for (const [label, engine] of [['Chromium', chromium], ['WebKit', webkit]]) {
  test(label + ': 500-card edit preserves document scroll, search focus and URL', async () => {
    const browser = await engine.launch({headless:true});
    try {
      const page = await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
      await page.setContent('<style>body{margin:0;overflow-anchor:auto}.item{height:64px;box-sizing:border-box;border-bottom:1px solid #ccc}</style><input id="buscar" placeholder="search"><div id="gridInventario"></div>');
      await page.evaluate(s => (0, eval)(s), reconciler);
      const result = await page.evaluate(async () => {
        const grid = document.getElementById('gridInventario');
        const search = document.getElementById('buscar');
        const cards = Array.from({length:500}, (_, i) => ({id:'p'+i,
          html:'<div class="item" data-inv-id="p'+i+'"><span>'+i+'</span></div>'}));
        const toggle = '<div class="item">Inventory</div>';
        reconciliarGridInventario(grid, toggle, cards);
        window.scrollTo(0, 64 * 240);
        search.focus({preventScroll:true});
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const beforeScroll = window.scrollY;
        const anchor = grid.children[245];
        const beforeTop = anchor.getBoundingClientRect().top;
        const beforeHref = location.href;
        cards[100] = {id:'p100',html:'<div class="item" data-inv-id="p100"><span>33</span></div>'};
        reconciliarGridInventario(grid, toggle, cards);
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        return {
          scrollDelta: Math.abs(window.scrollY - beforeScroll),
          anchorDelta: Math.abs(anchor.getBoundingClientRect().top - beforeTop),
          sameAnchor: grid.children[245] === anchor,
          focusIntact: document.activeElement === search,
          noNavigation: location.href === beforeHref,
          cardCount: grid.querySelectorAll('[data-inv-id]').length,
          edited: grid.querySelector('[data-inv-id="p100"] span').textContent
        };
      });
      assert.ok(result.scrollDelta <= 4, label + ' scroll jumped ' + result.scrollDelta + 'px');
      assert.ok(result.anchorDelta <= 4, label + ' anchor jumped ' + result.anchorDelta + 'px');
      assert.equal(result.sameAnchor, true);
      assert.equal(result.focusIntact, true);
      assert.equal(result.noNavigation, true);
      assert.equal(result.cardCount, 500);
      assert.equal(result.edited, '33');
    } finally { await browser.close(); }
  });
}
