'use strict';
// Exercise the real presentation and pagination while observing report values.
const { jsPDF } = require('../../docs/vendor/jspdf-4.2.1.umd.min.js');
require('../../docs/vendor/jspdf-autotable-5.0.9.min.js').applyPlugin(jsPDF);
const layout = require('../../docs/pdf-report-layout.js');
function instrumentPDF(tables, texts) {
  return function (options) {
    const doc = new jsPDF(options), table = doc.autoTable, text = doc.text;
    doc.autoTable = function (settings) { tables.push(settings); return table.call(this, settings); };
    doc.text = function (value, ...args) { texts.push(value); return text.call(this, value, ...args); };
    doc.save = function () {};
    return doc;
  };
}
module.exports = { instrumentPDF, layout };
