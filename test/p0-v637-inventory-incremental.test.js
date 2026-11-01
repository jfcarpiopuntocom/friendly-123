'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium, webkit } = require('playwright');
const source = fs.readFileSync(path.join(__dirname, '../src/app/app-inline-01.js'), 'utf8');
const shipped = fs.readFileSync(path.join(__dirname, '../docs/app-inline-01.min.js'), 'utf8');
const start = source.indexOf('var _inventarioHtmlPorNodo = new WeakMap();');
const end = source.indexOf('async function cargarInventario(){', start);
assert(start > 0 && end > start);
const helper = source.slice(start, end);

test('inventory reconciliation is in the actual shipped script and preserves per-card listener guard', () => {
  assert.match(shipped, /function reconciliarGridInventario\(/);
  assert.match(shipped, /data-inv-id="\$\{escHtml\(p\.id\)\}"/);
  assert.match(shipped, /__ocInvListener/);
  assert.match(source, /reconciliarGridInventario\(grid, _toggleArch, tarjetasInv\)/);
});

for (const [name, engine] of [['Chromium', chromium], ['WebKit', webkit]]) {
  test(name + ': 300 cards, only the changed one is replaced; listeners, ordering and photos remain mounted', async () => {
    const browser = await engine.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.setContent('<div id="gridInventario"></div>');
      await page.evaluate(s => (0, eval)(s), helper);
      const outcome = await page.evaluate(() => {
        const grid = document.getElementById('gridInventario');
        const make = (n, name) => ({ id: 'p' + n,
          html: '<div class="caja" data-inv-id="p' + n + '"><button>+</button><img loading="lazy" src="data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs="><span>' + (name || 'Producto ' + n) + '</span></div>' });
        const cards = Array.from({ length: 300 }, (_, i) => make(i + 1));
        const toggle = '<div class="toggle"><button>Archived</button></div>';
        reconciliarGridInventario(grid, toggle, cards);
        const first = grid.children[1], changed = grid.children[42], last = grid.children[300];
        let clicks = 0;
        first.querySelector('button').addEventListener('click', () => { clicks++; });
        const observer = new MutationObserver(() => {});
        observer.observe(grid, { childList: true });
        reconciliarGridInventario(grid, toggle, cards);
        const noop = observer.takeRecords().length === 0;
        first.querySelector('button').click();
        cards[41] = make(42, 'Producto editado');
        reconciliarGridInventario(grid, toggle, cards);
        const sameFirst = grid.children[1] === first;
        const changedOne = grid.children[42] !== changed && grid.children[42].textContent.includes('editado');
        const sameLast = grid.children[300] === last;
        first.querySelector('button').click();
        const moved = cards.pop();
        cards.unshift(moved);
        reconciliarGridInventario(grid, toggle, cards);
        const sorted = grid.children[1] === last && grid.children[2] === first;
        cards.splice(2, 1);
        cards.push(make(301));
        reconciliarGridInventario(grid, toggle, cards);
        const count = grid.querySelectorAll('[data-inv-id]').length;
        const added = !!grid.querySelector('[data-inv-id="p301"]');
        const oldToggle = grid.firstElementChild;
        reconciliarGridInventario(grid, '<div class="toggle"><button>Active</button></div>', cards);
        const toggled = oldToggle !== grid.firstElementChild && grid.children[2] === first;
        return { noop, sameFirst, changedOne, sameLast, clicks, sorted, count, added, toggled };
      });
      assert.deepEqual(outcome, { noop:true, sameFirst:true, changedOne:true, sameLast:true,
        clicks:2, sorted:true, count:300, added:true, toggled:true });
      await page.close();
    } finally { await browser.close(); }
  });
}
