# P0 release guards — physical acceptance (manual, SHA-specific)

This checklist complements, but **cannot be replaced by**, GitHub Actions.
Do not check boxes based on a simulated browser test. No sample transactions or
personal/customer data should be put into a public PR or telemetry.

**Candidate commit SHA:** `_______________________________`
**Shell and cache generation:** `_______________________________`
**Reviewer, local date/time (Ecuador):** `_______________________________`
**Exact device/browser:** `_______________________________`

## Mandatory physical checks (all on the exact published candidate SHA)

- [ ] **One-device local sale first, irrespective of Sync3 status.** Make one
  agreed low-impact test transaction on the pilot device. Confirm exactly one
  sale in Sold, corresponding stock -1, and that both survive a full close and
  reopening of the same PWA/browser. Never retry a doubtful charge without
  first checking Sold.
- [ ] **Customer and manual inventory on the same device.** One customer Add
  saves exactly once after reopening; one inventory +1/-1 saves without a
  false success toast, jumping stock, or reload. No unrelated records change.
- [ ] **Historical Commissions and Summary by Product.** Select at least two
  earlier months (including a previous year if the notebook contains one).
  Verify a real historic product with house-only sales appears, even with $0
  associate commission; a product with a split shows the exact historical
  amount, unpaid/paid status, and does not double-count payouts or bleed across
  months. Compare with actual historic Sold receipts; **do not create
  artificial payments or edit historical money**.
- [ ] **Safari/PWA and Opera/PC view.** On each accessible real device confirm
  the exact shell+SHA, month selection and product breakdown; no blank results
  falsely presented as $0 when loading failed.
- [ ] **Same-license Sync3 bonus (A → B → A twice).** After single-device
  operations succeed, check same notebook and sale/stock/photo continuity
  across two different devices, including after reconnect. Do not turn off
  Sync3 or erase IndexedDB for this test.

## NO-GO, rollback and evidence policy

- Fail if any persisted receipt, stock, commission period or product summary
  differs from the verified source facts, or the browser returns success without
  a surviving durable write. Unknown physical state is **NO-GO**, not green.
- Require GitHub PR SHA-exact required P0 hotfix gate and manifest checks GREEN.
  Advisory full regression failures must be explicitly investigated rather than
  dismissed without attribution.
- Record only **non-sensitive** evidence: device type/browser, timestamp, exact
  SHA, step passed/failed, error code, anonymized operation ID if appropriate.
  Never attach PINs, personal data, business amounts/receipts, images or customer
  records to a public PR.
- If a candidate fails: keep previous stable release; repair in an isolated
  branch and rerun required tests plus this same physical checklist. Do not
  clear a client's cache/IndexedDB or modify real historical data as a shortcut.

## 14-day single metric

**Critical-business-operation first-attempt durable success rate**
= unique user-initiated sale/customer/stock operations that ACK once and are
verified after reopen ÷ all unique user-initiated attempts across real devices.
Count failures, timeouts, retries and dropped acknowledgements in the
denominator. Label device/browser and exact shell SHA, use no identifying
customer or financial payload. Report numerator, denominator and device-days;
a rate without sample size or offline/reopen verification is not a proof of
reliability. Sync latency is tracked separately; it cannot make a failed local
sale look successful.
