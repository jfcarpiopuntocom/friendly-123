/* Calendar periods are pure business dates, independent of device timezone. */
(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.OCReportPeriod = api;
})(globalThis, function() {
  'use strict';
  function range(month, frequency) {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month || '')) return null;
    const year = Number(month.slice(0, 4)), m = Number(month.slice(5, 7));
    if (!['monthly', 'quarterly', 'yearly'].includes(frequency)) return null;
    const start = frequency === 'yearly' ? 1 : frequency === 'quarterly' ? Math.floor((m - 1) / 3) * 3 + 1 : m;
    const end = frequency === 'yearly' ? 12 : frequency === 'quarterly' ? start + 2 : m;
    const endDay = new Date(Date.UTC(year, end, 0)).getUTCDate();
    const prefix = month.slice(0, 4) + '-';
    return { from: prefix + String(start).padStart(2, '0') + '-01', to: prefix + String(end).padStart(2, '0') + '-' + endDay };
  }
  return { range };
});
