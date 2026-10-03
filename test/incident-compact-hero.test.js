const { test } = require('node:test');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { pathToFileURL } = require('node:url');
const path = require('node:path');

async function measure(width) {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    await page.goto(pathToFileURL(path.resolve(__dirname, '../docs/index.html')).href,
      { waitUntil: 'networkidle' });
    return await page.evaluate((viewportWidth) => {
      const hero = document.getElementById('heroSemaforo');
      const title = document.getElementById('heroTitulo');
      const sub = document.getElementById('heroSubtitulo');
      const clock = document.getElementById('heroReloj');
      const how = document.querySelector('#vista-hoy > details');
      hero.className = 'hero-semaforo rojo tag-card';
      title.textContent = 'You need to act today — there are emergencies in your business.';
      sub.textContent = '0 sales recorded today.';
      clock.textContent = 'Sat, Oct 3 at 11:19 AM';
      const hr = hero.getBoundingClientRect();
      const dr = how.getBoundingClientRect();
      return {
        width: viewportWidth,
        heroHeight: hr.height,
        gapToHow: dr.top - hr.bottom,
        titleFont: parseFloat(getComputedStyle(title).fontSize),
        clockFont: parseFloat(getComputedStyle(clock).fontSize),
        titleLinesApprox: Math.round(title.getBoundingClientRect().height / parseFloat(getComputedStyle(title).lineHeight)),
        shellText: document.documentElement.innerHTML.includes('f123-shell-v444')
      };
    }, width);
  } finally {
    await browser.close();
  }
}

test('Today emergency hero is compact and How does it work stays attached on 603px viewport', async () => {
  const r = await measure(603);
  assert.ok(r.heroHeight <= 100, 'hero should stay under 100 CSS px at 603px viewport: ' + JSON.stringify(r));
  assert.ok(r.gapToHow <= 8, 'How does it work should sit close to hero: ' + JSON.stringify(r));
  assert.ok(r.titleFont <= 15.1, 'mobile headline should be compact: ' + JSON.stringify(r));
  assert.ok(r.clockFont <= 12.1, 'timestamp pill should be secondary while respecting the 12px readability floor: ' + JSON.stringify(r));
  assert.equal(r.shellText, false, 'aesthetic hotfix must not introduce shell v444');
});

test('Today emergency hero stays compact on desktop too', async () => {
  const r = await measure(1200);
  assert.ok(r.heroHeight <= 85, 'desktop hero should stay compact: ' + JSON.stringify(r));
  assert.ok(r.gapToHow <= 8, 'desktop How does it work should stay close: ' + JSON.stringify(r));
  assert.ok(r.titleFont <= 18.1, 'desktop headline should stay restrained: ' + JSON.stringify(r));
});
