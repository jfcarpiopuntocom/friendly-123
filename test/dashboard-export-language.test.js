'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const html = fs.readFileSync(path.join(__dirname, '../docs/dashboard.html'), 'utf8');
const from = html.indexOf('  function etiquetaExportacion(');
const to = html.indexOf('  /* ================================================== QUIEN ESTA EN EL LOOP', from);

test('accountant table exports follow Spanish and subsequent English selection without changing financial values', () => {
  let lang = 'es';
  const pdfTables = [], pdfText = [], downloads = [];
  const cols = [{ title: 'Product', field: 'productoNombre' }, { title: 'Price', field: 'precioUnit' }];
  const translations = { Sales: 'Ventas', Product: 'Producto', Price: 'Precio' };
  const context = {
    window: {
      OCDashIdioma: { traducir: value => lang === 'es' ? translations[value] || null : null },
      jspdf: { jsPDF: function () { return {
        setFontSize() {}, text(value) { pdfText.push(value); },
        autoTable(value) { pdfTables.push(value); }, save() {}
      }; } }
    },
    localStorage: { getItem: () => lang },
    VISTAS: { ventas: { nombre: 'Sales', cols } }, vista: 'ventas', datos: {},
    tabla: {
      getData: () => [{ productoNombre: 'Synthetic coffee', precioUnit: 10 }],
      getColumns: () => cols.map(definition => ({ getDefinition: () => definition })),
      download(type, file, options) { downloads.push({ type, file, options, headers: cols.map(c => c.titleDownload) }); }
    },
    $: () => ({ textContent: 'Synthetic shop' }), money: value => '$' + value.toFixed(2)
  };
  vm.createContext(context);
  vm.runInContext(html.slice(from, to), context);
  vm.runInContext('exportar("pdf"); exportar("xlsx");', context);
  assert.deepEqual(Array.from(pdfTables[0].head[0]), ['Producto', 'Precio']);
  assert.deepEqual(Array.from(pdfTables[0].body[0]), ['Synthetic coffee', '$10.00']);
  assert.match(pdfText[1], /^Ventas · /);
  assert.equal(downloads[0].options.sheetName, 'Ventas');
  assert.deepEqual(downloads[0].headers, ['Producto', 'Precio']);
  assert.match(downloads[0].file, / · Ventas · /);
  assert.deepEqual(cols.map(c => c.title), ['Product', 'Price'], 'source titles remain reversible');
  lang = 'en';
  vm.runInContext('exportar("pdf"); exportar("xlsx"); exportar("csv");', context);
  assert.deepEqual(Array.from(pdfTables[1].head[0]), ['Product', 'Price']);
  assert.equal(downloads[1].options.sheetName, 'Sales');
  assert.deepEqual(downloads[1].headers, ['Product', 'Price']);
  assert.deepEqual(downloads[2].headers, ['Product', 'Price']);
});
