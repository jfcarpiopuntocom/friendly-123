/* Presentation only: Friendly report frame, pagination and restrained branding.
   Money and report contents remain owned by the existing read models. */
(function (root) {
  'use strict';
  const ink = [15, 25, 35], soft = [44, 62, 80], line = [232, 236, 242];
  function create(doc, options) {
    const width = doc.internal.pageSize.getWidth(), height = doc.internal.pageSize.getHeight();
    const left = 48, right = width - 48, bottom = height - 88;
    const spanish = options.language === 'es';
    function font(size, bold, mono) {
      doc.setFont(mono ? 'courier' : 'helvetica', bold ? 'bold' : 'normal');
      doc.setFontSize(size); doc.setTextColor.apply(doc, ink);
    }
    function fit(value, size, maxWidth) {
      font(size, true);
      while (doc.getTextWidth(value) > maxWidth && size > 14) { size--; font(size, true); }
      return doc.splitTextToSize(value, maxWidth);
    }
    // Standard PDF fonts support EN/ES; use their supported minus glyph so
    // wrapping measures the same glyph that is actually printed.
    const printable = value => String(value).replace(/\u2212/g, '-');
    const business = printable(options.business || (spanish ? 'INFORME DEL NEGOCIO' : 'BUSINESS REPORT'));
    font(10.5, true);
    const businessLines = doc.splitTextToSize(business, right - left);
    const titleLines = fit(printable(options.title), 24, right - left), titleSize = doc.getFontSize();
    const titleY = 84 + (businessLines.length - 1) * 14;
    const subtitleY = titleY + (titleLines.length - 1) * titleSize * 1.15 + 24;
    const ruleY = subtitleY + 16, top = ruleY + 16;
    function background() {
      doc.saveGraphicsState();
      doc.setDrawColor.apply(doc, line); doc.setLineWidth(1.5);
      doc.roundedRect(24, 24, width - 48, height - 48, 4.5, 4.5, 'S');
      font(10.5, true); doc.setTextColor.apply(doc, soft);
      doc.text(businessLines, left, 54, { lineHeightFactor: 14 / 10.5 });
      font(titleSize, true); doc.text(titleLines, left, titleY);
      font(10.5); doc.setTextColor.apply(doc, soft);
      doc.text(printable(options.subtitle || ''), left, subtitleY);
      doc.setDrawColor.apply(doc, line); doc.line(left, ruleY, right, ruleY);
      doc.setDrawColor(232, 96, 64); doc.setLineWidth(2); doc.line(left, ruleY, left + 32, ruleY);
      doc.restoreGraphicsState();
    }
    background();
    doc.internal.events.subscribe('addPage', background);
    function table(settings) {
      const config = Object.assign({
        theme: 'plain', startY: top, margin: { left, right: 48, top, bottom: 88 },
        styles: { font: 'helvetica', fontSize: 10.5, cellPadding: 8, textColor: ink, overflow: 'linebreak', valign: 'middle' },
        headStyles: { fillColor: [248, 249, 251], textColor: soft, fontStyle: 'bold', lineColor: line, lineWidth: { bottom: 1 } },
        bodyStyles: { fillColor: false, lineColor: line, lineWidth: { bottom: 0.5 } },
        rowPageBreak: 'avoid',
        didParseCell: function (cell) {
          if (cell.section === 'body' && /^[-−]?\$[-−]?[\d,.]+$/.test(cell.cell.text.join(''))) {
            cell.cell.styles.halign = 'right'; cell.cell.styles.font = 'courier';
          }
          if (settings.totalFirst && cell.section === 'body' && cell.row.index === 0) {
            cell.cell.styles.fontStyle = 'bold'; cell.cell.styles.fillColor = [248, 249, 251];
          }
        }
      }, settings);
      delete config.totalFirst;
      doc.autoTable(config);
      return doc.lastAutoTable.finalY;
    }
    function paragraph(value, y) {
      font(11); doc.setTextColor.apply(doc, soft);
      const lines = doc.splitTextToSize(printable(value), right - left);
      lines.forEach(function (text) {
        if (y + 14 > bottom) { doc.addPage(); y = top; font(11); doc.setTextColor.apply(doc, soft); }
        doc.text(text, left, y); y += 16;
      });
      return y;
    }
    function metrics(items) {
      const gap = 12, w = (right - left - gap * (items.length - 1)) / items.length;
      items.forEach(function (item, index) {
        const x = left + index * (w + gap);
        doc.setDrawColor.apply(doc, line); doc.setLineWidth(1.5);
        doc.roundedRect(x, top + 4, w, 80, 4.5, 4.5, 'S');
        font(10.5); doc.setTextColor.apply(doc, soft); doc.text(item.label, x + 16, top + 26, { maxWidth: w - 32 });
        font(26, true, true);
        while (doc.getTextWidth(item.value) > w - 32 && doc.getFontSize() > 14) doc.setFontSize(doc.getFontSize() - 1);
        doc.text(item.value, x + 16, top + 64);
      });
    }
    function finish() {
      const count = doc.getNumberOfPages();
      for (let page = 1; page <= count; page++) {
        doc.setPage(page); font(10.5); doc.setTextColor.apply(doc, soft);
        doc.setDrawColor.apply(doc, line); doc.setLineWidth(0.75); doc.line(left, height - 64, right, height - 64);
        doc.text(spanish ? 'Resumen del negocio · USD' : 'Business summary · USD', left, height - 44);
        const pageLabel = page + ' / ' + count;
        // A visible signature next to pagination, not a background watermark.
        if (options.logo) {
          const image = doc.getImageProperties(options.logo), w = 64;
          const h = w * image.height / image.width;
          doc.addImage(options.logo, 'PNG', right - doc.getTextWidth(pageLabel) - 12 - w,
            height - 54, w, h, 'friendly-report-brand');
        }
        doc.text(pageLabel, right, height - 44, { align: 'right' });
      }
    }
    return { table, paragraph, metrics, finish, top, bottom };
  }
  const api = { create };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.OCReportPDF = api;
})(typeof window === 'object' ? window : globalThis);
