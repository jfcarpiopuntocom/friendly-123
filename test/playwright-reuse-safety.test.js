'use strict';
// Synthetic data only: no credentials, clients, network or production origin.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { withIsolatedPage } = require('./helpers/playwright-reusable.cjs');
const ORIGIN = 'http://localhost:17833/';

test('one browser, two contexts: business storage stays isolated', async () => {
  let firstBrowser;
  await withIsolatedPage('chromium', async ({ page, context, browser }) => {
    firstBrowser = browser;
    await context.route(ORIGIN, route => route.fulfill({ contentType: 'text/html', body: '<title>synthetic business 1</title>' }));
    await page.goto(ORIGIN);
    await page.evaluate(() => localStorage.setItem('f123_owned', 'SYNTHETIC-OWNER-1'));
    assert.equal(await page.evaluate(() => localStorage.getItem('f123_owned')), 'SYNTHETIC-OWNER-1');
  });
  await withIsolatedPage('chromium', async ({ page, context, browser }) => {
    assert.equal(browser, firstBrowser, 'Chromium process must be reused');
    await context.route(ORIGIN, route => route.fulfill({ contentType: 'text/html', body: '<title>synthetic business 2</title>' }));
    await page.goto(ORIGIN);
    assert.equal(await page.evaluate(() => localStorage.getItem('f123_owned')), null,
      'a different case must NEVER inherit the prior notebook');
  }, { viewport: { width: 390, height: 844 } });
});

test('fixture rejects unexpected engines before launching a browser', async () => {
  await assert.rejects(withIsolatedPage('production', async () => {}), /Unknown Playwright engine/);
});
