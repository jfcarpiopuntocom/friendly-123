/* Heavy reporting stays off the live-sync UI thread. No network API calls. */
importScripts('./core/business-read-model.js', './core/finance-report.js');
self.onmessage = function (event) {
  try {
    self.postMessage({ rows: self.OCFinanceProjection.build(event.data.input, event.data.events) });
  } catch (error) {
    self.postMessage({ error: error.message || 'Report calculation failed.' });
  }
};
