# Join notebook — production design

Date: 2026-08-28
Status: approved by JFC (Option A)

## Goal

Replace the overlapping license, team, join, activate, claim, merge, split-identity, and resync user flows with one mental model: **Join notebook**. A person pastes one license; friendly-123 opens that isolated shared notebook and syncs it automatically.

## Non-negotiable invariants

1. One canonical license identifies one notebook and one relay room.
2. Joining switches notebooks; it never merges, copies, or overwrites notebook data.
3. The current notebook is flushed and checkpointed before identity changes.
4. The destination namespace is derived before any license write.
5. `licenseCode`, sync code, active room, and active namespace cannot be committed partially.
6. A failed validation or switch leaves the current notebook unchanged.
7. PINs choose role-based views and capabilities only; they never establish sync identity.
8. Heartbeats report identity and health; they never infer or rewrite a license from room state.
9. The relay remains zero-knowledge and does not retain notebook contents.
10. No production claim is complete without two-profile sync and public-PWA verification.

## User experience

Advanced exposes two normal actions:

- **Join notebook**: opens one license field and one confirmation action.
- **Check connection**: shows a plain-language state, reason, and next step.

Normal states are Connected, Connecting, Offline, or Needs attention. Raw diagnostics are collapsed under Technical details. A proven recoverable fault may reveal one contextual recovery action. Rotate, deactivate, claim, merge, and split-identity controls are not normal user actions; destructive operations remain separated and support-only.

All visible English terminology uses **Join notebook** and **notebook**. Spanish uses **Unirse al cuaderno** and **cuaderno**. Legacy internal identifiers remain unchanged when renaming them would risk stored state.

The PIN keypad contains digits only. The newest entered digit remains visible for about 300 ms, then becomes a bullet. Earlier digits stay masked. Submission cannot expose the full PIN.

## Join state machine

1. `idle`: current notebook remains usable.
2. `validating`: normalize and validate the pasted license without writing state.
3. `checkpointing`: flush current buffers and preserve the current identity/namespace marker.
4. `switching`: derive the destination namespace and commit the canonical identity tuple.
5. `reloading`: reload only after the switch marker is durable.
6. `connecting`: enter the canonical relay room and send heartbeat.
7. `verified`: identity tuple agrees and relay health is observable.
8. `failed`: restore or retain the prior marker; show a specific next step without merging.

Rejoining the current notebook is idempotent. An interrupted switch is recoverable from the durable marker and checkpoint. Startup validates identity agreement before allowing sync writes.

## Root-cause fixes

- Preserve the existing `desde` capture before writes and cover interruption paths with tests.
- Centralize license normalization and canonical room derivation.
- Route all ordinary joins through one implementation; legacy buttons cannot mutate identity independently.
- Remove heartbeat autocuration and reject empty/invalid identity updates.
- Make shell/version mismatch detectable and ensure every served-shell change bumps cache and manifest.
- Keep reloads away from active input and transactional work.

## Verification

Automated checks must prove:

- invalid license causes zero state mutation;
- joining never changes source namespace data;
- interrupted join returns to a coherent state;
- identity fields and room agree after reload;
- same-notebook join is idempotent;
- offline operations converge after reconnect without duplication;
- two isolated browser profiles exchange a uniquely named test record;
- the public GitHub Pages build serves the intended version and shell;
- Worker/relay health is tested without logging PINs, full licenses, or business contents;
- Hugo, Paco, and Luis can understand the two-action flow.

## Rollout and rollback

Create a snapshot branch, external tar, checksums, and baseline state before edits. Commit and push in small green stages. Bump `sw.js`, `version.json`, and the deterministic manifest together. Verify locally, then verify the public URL with two isolated profiles. If any identity, namespace, data-integrity, or convergence check fails, do not deploy that stage; revert to the snapshot branch and bump the shell again so clients receive the rollback.

Cloudflare Worker or relay changes deploy only when configured credentials are available. Client-only changes must not claim Worker behavior is fixed unless the live endpoint confirms it.

## Scope

Included: license/join/sync correctness, Advanced sync UI, diagnostics wording, help/manual terminology, keypad emoji removal, brief PIN-digit feedback, safeguards, tests, deployment, and notes.

Excluded: Loyverse, unrelated accounting/navigation changes, content-retaining cloud storage, and automatic cross-notebook merge.
