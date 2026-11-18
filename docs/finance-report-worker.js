/* Heavy reporting stays off the live-sync UI thread. No network API calls. */
importScripts('./core/business-read-model.js', './core/finance-report.js');
self.onmessage = function (event) {
  try {
    const input=event.data||{};
    self.postMessage({ rows: input.earningsBy ? self.OCFinanceProjection.earnings(input.input,input.earningsBy) : self.OCFinanceProjection.build(input.input,input.events) });
  } catch (error) {
    self.postMessage({ error: error.message || 'Report calculation failed.' });
  }
};
