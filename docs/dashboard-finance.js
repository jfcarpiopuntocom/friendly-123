/* On-demand financial reports from the existing coherent notebook snapshot.
   No network, polling, mutation, or photo bytes. Detailed comparisons run only
   on an explicit click, outside the live sync update path. */
(function () {
  'use strict';
  let data = {}, zone = 'America/Guayaquil', host, lastReport, revision = 0, worker = null;
  const es = () => localStorage.getItem('f123_lang') === 'es';
  const text = (en, spanish) => es() ? spanish : en;
  const money = cents => cents === null ? '—' : new Intl.NumberFormat(es() ? 'es-EC' : 'en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);
  function node(tag, value) { const el = document.createElement(tag); if (value !== undefined) el.textContent = value; return el; }
  function options(select, entries) {
    select.replaceChildren();
    entries.forEach(([value, label]) => { const o = node('option', label); o.value = value; select.append(o); });
  }
  function mount() {
    const target = document.getElementById('finanzas-foto-contenido');
    if (!target) return false;
    host = document.getElementById('finance-period-report');
    if (host) return true;
    host = node('section'); host.id = 'finance-period-report'; host.className = 'cm-card';
    const heading = node('h3'); heading.id = 'finance-heading'; host.append(heading);
    const controls = node('div'); controls.className = 'cm-actions';
    const cadence = node('select'); cadence.id = 'finance-cadence';
    const month = node('input'); month.type = 'month'; month.id = 'finance-month'; month.value = window.OCBusinessReadModel.day(new Date().toISOString(), zone).slice(0, 7);
    const group = node('select'); group.id = 'finance-group';
    const generate = node('button'); generate.type = 'button'; generate.id = 'finance-generate'; generate.onclick = render;
    const pdf = node('button'); pdf.type = 'button'; pdf.id = 'finance-pdf'; pdf.onclick = exportPDF;
    controls.append(cadence, month, group, generate, pdf); host.append(controls);
    const status = node('p'); status.id = 'finance-status'; status.setAttribute('role', 'status'); host.append(status);
    const output = node('div'); output.id = 'finance-output'; output.style.overflowX = 'auto'; host.append(output);
    target.parentNode.insertBefore(host, target.nextSibling);
    return true;
  }
  function update(snapshot, businessZone) {
    data = snapshot || {}; zone = businessZone || zone; revision++;
    if (!mount()) return;
    const cadence = document.getElementById('finance-cadence'), prev = cadence.value || 'monthly';
    options(cadence, [['monthly', text('Month', 'Mes')], ['quarterly', text('Quarter', 'Trimestre')], ['yearly', text('Year', 'Año')]]); cadence.value = prev;
    const group = document.getElementById('finance-group'), oldGroup = group.value || 'shelves';
    options(group, [['shelves', text('Compare shelves / bar / classes', 'Comparar perchas / bar / clases')], ['events', text('Compare event dates', 'Comparar fechas de eventos')]]); group.value = oldGroup;
    document.getElementById('finance-heading').textContent = text('What remains for the house?', '¿Cuánto le queda a la Casa?');
    cadence.setAttribute('aria-label', text('Report period', 'Periodo del reporte'));
    document.getElementById('finance-month').setAttribute('aria-label', text('Month within the report period', 'Mes dentro del periodo'));
    group.setAttribute('aria-label', text('Compare by', 'Comparar por'));
    document.getElementById('finance-generate').textContent = text('Calculate report', 'Calcular reporte');
    document.getElementById('finance-pdf').textContent = text('Download PDF', 'Descargar PDF');
    document.getElementById('finance-status').textContent = text('Calculate to use the latest received data. Missing costs or unallocated expenses remain pending.', 'Calcula para usar los últimos datos recibidos. Los costos faltantes y gastos sin asignar quedan pendientes.');
    lastReport = null;
    // A new snapshot invalidates the old visible calculation without expensive regrouping.
    document.getElementById('finance-output').replaceChildren();
  }
  function buildReport() {
    const RM = window.OCBusinessReadModel;
    const period = window.OCReportPeriod.range(document.getElementById('finance-month').value, document.getElementById('finance-cadence').value);
    if (!period) throw new Error(text('Choose a valid report month.', 'Elige un mes válido.'));
    const c = data.cobertura || {};
    const input = { sales: data.ventas || [], expenses: data.gastos || [], adjustments: data.ajustesComision || [], period, zone,
      coverage: { sales: c.ventas === true, expenses: c.gastos === true, adjustments: c.ajustesComision === true, coherent: c.finanzasCoherentes === true } };
    const events = document.getElementById('finance-group').value === 'events';
    return { input, events, period, columns: [text('Scope', 'Área'), text('Net sales', 'Ventas netas'), text('Artist / associate', 'Artista / asociado'), text('House before costs', 'Casa antes de costos'), text('Product costs', 'Costo de productos'), text('Direct expenses', 'Gastos directos'), text('Contribution', 'Contribución'), text('House net result', 'Resultado neto Casa')] };
  }
  function values(row) {
    const r = row.result;
    return [row.name, ...['netCents', 'artistShareCents', 'houseShareCents', 'costCents', 'directExpensesCents', 'contributionCents', 'houseAfterExpensesCents'].map(key => money(r[key]))];
  }
  function note() {
    return text('House net result = net sales − artist/associate share − product costs − recorded expenses. The split is deducted once; paying it does not create a second expense. Contribution excludes general expenses. Rows with unallocated general expenses or missing evidence show —, not an asserted profit. This result is not cash on hand.', 'Resultado neto Casa = ventas netas − parte del artista/asociado − costo de productos − gastos registrados. El reparto se descuenta una vez; pagarlo no genera un segundo gasto. La contribución excluye gastos generales. Si faltan datos o gastos por asignar, aparece —, no una ganancia supuesta. Este resultado no equivale al efectivo disponible.');
  }
  async function calculate() {
    const report = buildReport(), sourceRevision = revision;
    if (worker) throw new Error(text('A report is being calculated. Wait for it to finish.', 'Hay un reporte en cálculo. Espera a que termine.'));
    const rows = await new Promise((resolve, reject) => {
      try {
        worker = new Worker('./finance-report-worker.js');
        worker.onmessage = event => { if (event.data.error) reject(new Error(event.data.error)); else resolve(event.data.rows); };
        worker.onerror = () => reject(new Error(text('The report worker could not load. Reload the dashboard and retry.', 'No cargó el cálculo del reporte. Recarga el dashboard y reintenta.')));
        worker.postMessage({ input: report.input, events: report.events });
      } catch (error) { reject(error); }
    }).finally(() => { if (worker) worker.terminate(); worker = null; });
    if (revision !== sourceRevision) throw new Error(text('New data arrived while calculating. Calculate again for a coherent result.', 'Llegaron datos nuevos durante el cálculo. Calcula otra vez para obtener un resultado coherente.'));
    const selected = buildReport();
    if (JSON.stringify(selected.period) !== JSON.stringify(report.period) || selected.events !== report.events) throw new Error(text('Selection changed. Calculate again.', 'Cambió la selección. Calcula otra vez.'));
    rows[0].name = text('Whole business', 'Negocio completo');
    return { ...report, rows };
  }
  async function render() {
    lastReport = null;
    try {
      lastReport = await calculate();
      const output = document.getElementById('finance-output'); output.replaceChildren();
      output.append(node('p', lastReport.period.from + ' — ' + lastReport.period.to));
      const table = node('table'), head = node('thead'), tr = node('tr');
      lastReport.columns.forEach(label => tr.append(node('th', label))); head.append(tr); table.append(head);
      const body = node('tbody'); lastReport.rows.forEach(row => { const tr = node('tr'); values(row).forEach(value => tr.append(node('td', value))); body.append(tr); }); table.append(body); output.append(table);
      const total = lastReport.rows[0].result;
      output.append(node('p', text('Recorded expenses (including general): ', 'Gastos registrados (incluidos generales): ') + money(total.expensesCents)));
      output.append(node('p', note()));
      document.getElementById('finance-status').textContent = text('Calculated from the latest received snapshot.', 'Calculado con la última información recibida.');
    } catch (error) { document.getElementById('finance-status').textContent = error.message; }
  }
  async function exportPDF() {
    const button = document.getElementById('finance-pdf');
    if (button.disabled) return;
    const sessionValid = window.OCDashboardExports ? window.OCDashboardExports.captureSession() : () => false;
    if (!sessionValid()) return;
    button.disabled = true; button.setAttribute('aria-busy', 'true');
    try {
      const sourceRevision = revision, requested = buildReport();
      document.getElementById('finance-status').textContent = text('Preparing PDF…', 'Preparando PDF…');
      if (window.OCDashboardExports) await window.OCDashboardExports.prepare('pdf');
      if (!sessionValid()) return;
      const selected = buildReport();
      if (revision !== sourceRevision || JSON.stringify(selected.period) !== JSON.stringify(requested.period) || selected.events !== requested.events) throw new Error(text('Data or selection changed. Export again.', 'Cambiaron los datos o la selección. Vuelve a exportar.'));
      await render(); if (!lastReport || !sessionValid()) return;
      if (!window.jspdf || !window.jspdf.jsPDF) { document.getElementById('finance-status').textContent = text('PDF tool unavailable. Retry when it finishes loading.', 'La herramienta PDF no está disponible. Reintenta cuando termine de cargar.'); return; }
      const doc = new window.jspdf.jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
      doc.setFontSize(16); doc.text(text('House profitability', 'Rentabilidad de la Casa'), 40, 40);
      doc.setFontSize(10); doc.text(lastReport.period.from + ' — ' + lastReport.period.to, 40, 60);
      doc.autoTable({ head: [lastReport.columns], body: lastReport.rows.map(values), startY: 76, styles: { fontSize: 9 }, headStyles: { fillColor: [15, 25, 35] } });
      const total = lastReport.rows[0].result;
      const explanation = text('Recorded expenses (including general): ', 'Gastos registrados (incluidos generales): ') + money(total.expensesCents) + '\n' + note();
      const lines = doc.splitTextToSize(explanation, 750);
      let y = doc.lastAutoTable.finalY + 24;
      if (y + lines.length * 12 > doc.internal.pageSize.getHeight() - 40) { doc.addPage(); y = 40; }
      doc.text(lines, 40, y); doc.save('house-result-' + lastReport.period.from + '-' + lastReport.period.to + '.pdf');
    } catch (error) {
      if (sessionValid()) document.getElementById('finance-status').textContent = text('Could not export PDF. Retry: ', 'No se pudo exportar el PDF. Reintenta: ') + error.message;
    } finally { button.disabled = false; button.removeAttribute('aria-busy'); }
  }
  window.OCFinanceReport = { update, buildReport: calculate };
})();
