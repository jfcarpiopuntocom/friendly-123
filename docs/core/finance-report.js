/* Pure grouping over an immutable reporting cut; adapters supply periods and labels. */
(function (root, factory) {
  const api = factory(typeof module === 'object' && module.exports ? require('./business-read-model.js') : root.OCBusinessReadModel);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.OCFinanceProjection = api;
})(globalThis, function (RM) {
  'use strict';
  function build(input, events) {
    const groups = new Map();
    for (const sale of input.sales || []) {
      if (!sale || sale.borrado) continue;
      const key = events ? RM.eventKey(sale, input.zone) : sale.ubicacionId;
      if (!key) continue;
      if (!groups.has(key)) groups.set(key, {
        scope: events ? { eventKey: key } : { locationId: key },
        name: events ? (sale.eventoNombre || sale.productoNombre || '') + ' · ' + (sale.eventoFecha || '') : sale.ubicacionNombre || key
      });
    }
    for (const expense of input.expenses || []) {
      if (!expense || expense.borrado) continue;
      const eventId = expense.eventoId || expense.eventOccurrenceId || expense.ocurrenciaId;
      const key = events ? (expense.eventKey || (eventId ? 'id:' + eventId : null)) : expense.ubicacionId;
      if (!key || key === 'todas' || groups.has(key)) continue;
      groups.set(key, { scope: events ? { eventKey: key } : { locationId: key }, name: expense.eventoNombre || expense.ubicacionNombre || key });
    }
    const rows = [{ name: null, result: RM.businessResult(input) }];
    for (const group of groups.values()) {
      const result = RM.businessResult({ ...input, scope: group.scope });
      if (result.sourceIds.sales.length || result.sourceIds.expenses.length && result.directExpensesCents !== 0) rows.push({ name: group.name, result });
    }
    return rows;
  }
  return { build };
});
