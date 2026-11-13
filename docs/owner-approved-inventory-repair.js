// P0 safety: automatic stock reconciliation is disabled.
// Stock quantities must derive from authenticated, idempotent movements.
// A snapshot value (including seven) is never an automatic target.
(function (root) {
  'use strict';
  function plan() { return null; }
  async function run() { return { changed: 0, skipped: 'automatic-reconciliation-disabled' }; }
  if (typeof module === 'object' && module.exports) module.exports = { plan, run };
})(typeof window === 'undefined' ? null : window);
