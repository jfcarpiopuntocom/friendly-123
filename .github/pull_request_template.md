# PR · Evidence before change (HARDRULE VISIBILITY FIRST)

> Reference: [current scope freeze](https://app.notion.com/p/4011642b67f38177b1c9cc5b00dcf734) and [restricted causal map](https://app.notion.com/p/4021642b67f381f09d96f65192326f9f). **DO NOT copy private incidents, credentials, client names, screenshots or customer data into a public PR.**

## Authority
- [ ] Existing E1–E6 acceptance criterion or explicitly approved S1 (link to authorized internal decision, no customer details):
- [ ] SHA and baseline checked; touched files not reserved by another agent:
- [ ] Unrelated ideas/refactors parked; no new specs, colors or product features:

## Impact map — versioned to the exact SHA
- Entry (UI/role/tab/PIN) → ledger/stock/photo/expense → durable storage (IDB/LS) → Yjs/outbox/transport bundle → relay RPC → remote merge → UI/restart:
- All consumers / historical formats / side effects / failure paths:
- Expected rollback; evidence that no other data is lost:
- Unknown paths and what evidence would resolve them:

## RED → GREEN, tiny proof
- [ ] Actual issue reproduced with synthetic input and focused test: 
- [ ] Smallest fix (file list and diff summary):
- [ ] Failure/concurrent/replay case passed, not only happy path:
- [ ] Another agent independently reviewed:
- [ ] Final release gate on frozen SHA once, not repeated indiscriminately:

## Release and client safety
- [ ] No private data or internal investigations included in public commit, artifacts, generated graphs or history
- [ ] No secret, administrative page or debug asset unintentionally published
- [ ] Deployed bundle, manifest, service worker, server functions, branch, and user-facing URL independently confirmed
- [ ] Two device contexts / reconnection / name / PIN / photos / stock / sales / expenses / commissions verified where relevant
- [ ] Real cost/relay activity observed without creating a provider-held customer cloud
- [ ] NOT YET PROVEN recorded explicitly; do not label STABLE because CI is green

**Stop condition:** exactly what observation lets us stop work rather than add features:
