// Source-specific contracts. Unmapped sources retain the conservative basename
// fallback; the full release-control suite still runs independently in parallel.
module.exports = {
  'docs/core/ledger.js': [
    'test/ledger-v1.test.js', 'test/ficha-producto.test.js',
    'test/product-sheet-direction-continuity.test.js',
    'test/customer-debt-double-entry.test.js', 'test/customer-debt-follows-sale.test.js',
    'test/commissions-statement-ledger.test.js', 'test/money-durable-concurrency.test.js',
    'test/dashboard-money-conflicts.test.js', 'test/payout-ledger-v448.test.js',
    'test/payout-ledger-integration-v448.test.js', 'test/payout-partial-ui-v448.test.js'
  ],
  'docs/auth-ui.js': [
    'test/auth-emergency-recovery.test.js', 'test/business-name.test.js',
    'test/cost-density-pin.test.js', 'test/license-name-fusion.test.js',
    'test/photo-prime-directive-g04.test.js', 'test/sala-sigue-licencia.test.js',
    'test/shell-gate.test.js', 'test/team-access-hardening.test.js',
    'test/pin-owner-integrity.test.js', 'test/linus-roles-matriz.test.js',
    'test/tab-session-handoff.test.js', 'test/linus-dos-pestanas.test.js',
    'test/yjs-idle-write-budget.test.js'
  ]
};
