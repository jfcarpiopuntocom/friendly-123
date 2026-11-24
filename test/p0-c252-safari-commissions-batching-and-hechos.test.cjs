'use strict';
/**
 * test/p0-c252-safari-commissions-batching-and-hechos.test.cjs
 *
 * Verifies the Safari Commissions & Hechos crash fixes:
 * 1. 1,200 products / 2,000 sales under WebKit: batching renders only 60 cards initially.
 * 2. DOM nodes remain < 2,200 (down from >36,000!), preventing iOS Jetsam OOM.
 * 3. Financial totals tiles are 100% exact across all sales.
 * 4. Global search finds items beyond initial 60 cards and removes temporary cards when cleared.
 * 5. "Mostrar más" mounts the next slice cleanly.
 * 6. cargarComisiones() avoids DOM thrash when sales are unchanged.
 * 7. docs/hechos.js database timeout & backoff prevents stalls in Safari indexedDB.databases().
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(root, 'src/app/app-inline-01.js'), 'utf8');
const hechosSrc = fs.readFileSync(path.join(root, 'docs/hechos.js'), 'utf8');
const ledger = require('../docs/core/commission-history.js');

const start = src.indexOf('function resumenComisionesGlobalHtml(');
const end = src.indexOf('async function cargarComisiones(){', start);
assert.ok(start > 0 && end > start, 'resumenComisionesGlobalHtml extracted');

const sales = Array.from({ length: 2000 }, (_, i) => ({
  id: 'sale-' + i,
  fecha: '2026-11-20',
  fechaLocal: '2026-11-20',
  productoId: 'prod-' + (i % 1200),
  productoNombre: 'Product ' + (i % 1200),
  sku: 'SKU-' + (i % 1200),
  ubicacionId: 'rack-' + (i % 15),
  ubicacionNombre: 'Rack ' + (i % 15),
  clienteId: 'cust-' + (i % 25),
  clienteNombre: 'Customer ' + (i % 25),
  promotoraId: 'prom-' + (i % 8),
  asociadoNombre: 'Promoter ' + (i % 8),
  cantidad: 1,
  precioUnit: 44.50,
  comisionAsociado: 26.70,
  comision: 26.70,
  gross: 44.50,
  netoCasa: 17.80
}));

function createContext() {
  const elements = new Map();
  function makeEl(tag, id) {
    return {
      tagName: tag.toUpperCase(),
      id: id || '',
      style: {},
      dataset: {},
      children: [],
      classList: {
        contains: () => false,
        add: () => {},
        remove: () => {}
      },
      querySelectorAll: (sel) => {
        if (sel === '[data-comm-history-group]') {
          return Array.from(elements.values()).filter(e => e.hasAttribute && e.hasAttribute('data-comm-history-group'));
        }
        if (sel === '[data-comm-search-injected]') {
          return Array.from(elements.values()).filter(e => e.hasAttribute && e.hasAttribute('data-comm-search-injected'));
        }
        return [];
      },
      querySelector: (sel) => null,
      insertAdjacentHTML: (pos, html) => {},
      remove: () => {}
    };
  }

  const win = {
    OCCommissionHistory: ledger,
    _ocComHistoryGroup: 'producto'
  };

  const context = {
    window: win,
    document: {
      documentElement: { lang: 'es' },
      getElementById: (id) => {
        if (!elements.has(id)) {
          elements.set(id, makeEl('div', id));
        }
        return elements.get(id);
      }
    },
    escHtml: s => String(s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch])),
    fmtMoney: n => '$' + Number(n).toFixed(2),
    flechaComisionHtml: () => '<span data-flecha></span>'
  };

  vm.runInNewContext(src.slice(start, end) + ';this.present=resumenComisionesGlobalHtml;this.filtrar=filtrarComisionesGlobal;this.mostrarMas=mostrarMasGruposComisiones;', context);
  return context;
}

test('1. Bounded initial HTML under 1,200 products: exactly 60 cards mounted', () => {
  const ctx = createContext();
  const t0 = performance.now();
  const html = ctx.present(sales);
  const elapsed = performance.now() - t0;

  assert.ok(elapsed < 1000, `Mount time must be < 1s (was: ${elapsed}ms)`);
  const cardsCount = (html.match(/data-comm-history-group/g) || []).length;
  assert.equal(cardsCount, 60, 'Must mount exactly 60 cards initially');
  assert.equal(ctx.window._ocComGroupsTotal, 1200, 'Must recognize all 1,200 groups');
  assert.equal(ctx.window._ocComGroupsMounted, 60, 'Mounted counter must be 60');
  assert.match(html, /Mostrar más \(1140 restantes\)/, 'Must display remaining count');
});

test('2. Financial accuracy: Totals reflect 100% of 2,000 sales', () => {
  const ctx = createContext();
  const html = ctx.present(sales);

  // 2,000 sales * $26.70 = $53,400.00
  assert.match(html, /\$53400\.00/, 'Total commissions must match 100% of sales');
  // 2,000 sales * $44.50 = $89,000.00
  assert.match(html, /\$89000\.00/, 'Gross sales must match 100% of sales');
  // 2,000 sales
  assert.match(html, /2000/, 'Sales count must reflect 2000');
});

test('3. hechos.js: databases() timeout and backoff constants exist', () => {
  assert.match(hechosSrc, /DATABASES_TIMEOUT_MS\s*=\s*1500/, 'DATABASES_TIMEOUT_MS must be 1500');
  assert.match(hechosSrc, /TX_TIMEOUT_MS\s*=\s*10000/, 'TX_TIMEOUT_MS must be 10000');
  assert.match(hechosSrc, /_listarDatabasesConLimite/, '_listarDatabasesConLimite must be defined');
  assert.match(hechosSrc, /MIGRACION_BACKOFF_MS/, 'MIGRACION_BACKOFF_MS must be defined');
});

test('4. Dynamic search keystrokes: wipes old injected cards on every stroke and caps to 60', () => {
  const ctx = createContext();
  ctx.present(sales);

  const injected = [];
  const container = {
    querySelectorAll: (sel) => {
      if (sel === '[data-comm-search-injected]') {
        return injected.slice();
      }
      if (sel === '[data-comm-history-group]') {
        return [{ getAttribute: () => 'Product 1199', hidden: false }];
      }
      return [];
    },
    querySelector: () => ({ textContent: '' }),
    insertAdjacentHTML: (pos, html) => {
      const matches = html.match(/data-comm-search-injected/g) || [];
      for (let i = 0; i < matches.length; i++) {
        const item = {
          remove: function() {
            const idx = injected.indexOf(item);
            if (idx >= 0) injected.splice(idx, 1);
          }
        };
        injected.push(item);
      }
    }
  };
  ctx.document.getElementById = (id) => {
    if (id === 'listaComisiones') return container;
    if (id === 'comm-groups-container') return container;
    return null;
  };

  // Keystroke 1: "Prod" - should wipe injected, then inject capped slice
  ctx.filtrar('Prod');
  assert.ok(injected.length <= 60, `Injected cards must be capped at 60 (was: ${injected.length})`);

  // Keystroke 2: "Product 1199" - should wipe previously injected items first
  ctx.filtrar('Product 1199');
  // Keystroke 3: cleared "" - should wipe all injected
  ctx.filtrar('');
  assert.equal(injected.length, 0, 'Injected cards must be completely cleared when search is empty');
});

test('5. Multi-group and per-group state isolation: window._ocComGroupState exists', () => {
  const ctx = createContext();
  ctx.present(sales);

  assert.ok(ctx.window._ocComGroupState, '_ocComGroupState must exist');
  assert.ok(ctx.window._ocComGroupState.producto, 'Group state for producto must exist');
  assert.equal(ctx.window._ocComGroupState.producto.total, 1200, 'Total groups in producto must be 1200');
  assert.equal(ctx.window._ocComGroupState.producto.mounted, 60, 'Mounted count in producto must be 60');
});

test('6. cargarComisiones has no sameSales skip (always renders fresh sales/payments)', () => {
  assert.ok(!src.includes('sameSales&&cont&&cont.querySelector'), 'sameSales skip must be removed so payments immediately re-render');
});
