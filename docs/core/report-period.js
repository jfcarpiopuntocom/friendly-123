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
  const DAY = /^\d{4}-\d{2}-\d{2}$/;
  const iso = t => new Date(t).toISOString().slice(0, 10);
  const valid = day => {
    if (!DAY.test(day || '')) return false;
    const [year,month,date]=day.split('-').map(Number);
    return iso(Date.UTC(year,month-1,date))===day;
  };
  // TODAY is a business-local date computed by OCBusinessReadModel.day(now,zone).
  // UTC is used ONLY for calendar arithmetic after that local day is fixed.
  function quick(kind,today,from,to) {
    if (!valid(today)) return null;
    const [y,m,d]=today.split('-').map(Number);
    const t=Date.UTC(y,m-1,d), DAY_MS=86400000;
    if(kind==='today')return {from:today,to:today};
    if(kind==='yesterday'){const date=iso(t-DAY_MS);return{from:date,to:date};}
    if(kind==='7d')return{from:iso(t-6*DAY_MS),to:today};
    if(kind==='thisMonth')return range(today.slice(0,7),'monthly');
    if(kind==='lastMonth')return range(iso(Date.UTC(y,m-2,1)).slice(0,7),'monthly');
    if(kind==='custom')return valid(from)&&valid(to)&&from<=to?{from,to}:null;
    return null;
  }
  return { range, quick };
});
