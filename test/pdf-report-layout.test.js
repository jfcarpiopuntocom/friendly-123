'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { instrumentPDF, layout } = require('./helpers/report-pdf.cjs');

test('long reports preserve rows, repeat their frame and faint brand inside every page, and reserve the footer', () => {
  const tables = [], texts = [], PDF = instrumentPDF(tables, texts);
  const doc = new PDF({ orientation: 'portrait', unit: 'pt', format: 'a4' });
  const brands = [], frames = [], paragraphs = [];
  const image = doc.addImage, rect = doc.roundedRect, text = doc.text;
  doc.addImage = function (data, format, x, y, w, h, ...args) {
    brands.push({ x, y, w, h, page: doc.internal.getCurrentPageInfo().pageNumber });
    return image.call(this, data, format, x, y, w, h, ...args);
  };
  doc.roundedRect = function (...args) { frames.push(args); return rect.apply(this, args); };
  doc.text = function (value, x, y, ...args) {
    if (String(value).includes('Expense note')) paragraphs.push({ value, x, y, font: doc.getFontSize() });
    return text.call(this, value, x, y, ...args);
  };
  const report = layout.create(doc, {
    title: 'Monthly report with product costs, recorded expenses and the house result',
    business: 'Synthetic studio with a deliberately long business name for wrapping inside the complete report frame',
    subtitle: '2026-10-01 — 2026-10-31', language: 'en',
    logo: 'data:image/png;base64,' + fs.readFileSync(require.resolve('../docs/logo.png')).toString('base64')
  });
  const body = Array.from({ length: 120 }, (_, i) => ['Synthetic item ' + i, '$12.00']);
  report.table({ head: [['Product', 'Amount']], body });
  report.paragraph('Expense note: sales − costs. '.repeat(30), doc.internal.pageSize.getHeight() - 86);
  report.finish();
  const pages = doc.getNumberOfPages(), width = doc.internal.pageSize.getWidth(), height = doc.internal.pageSize.getHeight();
  assert.ok(pages > 3, 'the fixture must exercise actual AutoTable and note pagination');
  assert.equal(brands.length, pages);
  assert.equal(frames.length, pages, 'all four frame sides are drawn on every page');
  for (const brand of brands) {
    assert.ok(brand.x > width / 2 && brand.x + brand.w < width - 24, 'the complete brand sits at the right, inside the frame');
    assert.ok(brand.y > 24 && brand.y + brand.h < height - 88, 'the brand cannot enter the footer');
  }
  for (let i = 0; i < body.length; i++) assert.ok(texts.flat().includes('Synthetic item ' + i), 'no report row is lost');
  for (let i = 1; i <= pages; i++) assert.ok(texts.includes(i + ' / ' + pages), 'page totals match the final document');
  assert.ok(paragraphs.length > 0);
  for (const paragraph of paragraphs) {
    assert.ok(paragraph.y >= report.top && paragraph.y < height - 88);
    assert.equal(paragraph.font, 11);
    assert.ok(!String(paragraph.value).includes('−'), 'the measured and printed minus glyph must agree');
  }
  assert.ok(/\/ca 0\.04\b/.test(doc.output()), 'only the decorative image has very low opacity');
});
