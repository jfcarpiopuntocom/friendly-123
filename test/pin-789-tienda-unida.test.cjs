// v654 regression: on a device joined to an existing store, factory PIN 789 must not open Owner just because
// Yjs recovery finished. Runs the real guard block extracted from docs/auth-ui.js.
const test = require("node:test"), assert = require("node:assert"), fs = require("fs"), path = require("path");
const src = fs.readFileSync(path.join(__dirname, "..", "docs", "auth-ui.js"), "utf8");
const start = src.indexOf('if (rolHash === "dueno" && code === ACTIVATION_PIN && central !== "owner" && _aparatoUnido) {');
const end = src.indexOf('if (rolHash === "dueno") {', start);
assert.ok(start > 0 && end > start, "guard block not found");
const block = src.slice(start, end);
const run = (pinsRol, flag, recuperando = false) => {
  let msg = null;
  const window = { OCYjs: { meta: { get: () => pinsRol }, canal: { recuperando } } };
  // flag: true = photo flag for THIS license, or a license string to simulate a flag left by another license
  const localStorage = { getItem: (k) => k === "f123_owned" ? JSON.stringify({ licenseCode: "F123-AAAA" })
    : k === "f123_pin_tienda_789" ? (flag === true ? "F123-AAAA" : flag || null) : null };
  const fn = new Function("rolHash", "code", "ACTIVATION_PIN", "central", "_aparatoUnido", "window", "localStorage", "error",
    block + "\nreturn 'entra';");
  const r = fn("dueno", "789", "789", "unconfigured", true, window, localStorage, (m) => { msg = m; });
  return r === "entra" && !msg ? "entra" : "rechaza";
};
test("789 rejected when recovery finished but store PIN never arrived", () => assert.equal(run(null, false, false), "rechaza"));
test("789 rejected while still recovering", () => assert.equal(run(null, false, true), "rechaza"));
test("789 opens when the store itself says 789", () => assert.equal(run({ owner: "789" }, false), "entra"));
test("789 rejected when store has another PIN", () => assert.equal(run({ owner: "555" }, false), "rechaza"));
test("stale photo flag never beats a real store PIN", () => assert.equal(run({ owner: "555" }, true), "rechaza"));
test("photo flag opens when pinsRol has no owner yet", () => assert.equal(run(null, true), "entra"));
test("photo flag from another license never opens", () => assert.equal(run(null, "F123-BBBB"), "rechaza"));
test("legacy '1' flag (not keyed to a license) never opens", () => assert.equal(run(null, "1"), "rechaza"));

// OpenCode audit 2026-11-03: devices joined before v654 have no join flag. On ANY device, a known store PIN other than 789 wins.
const s2 = src.indexOf('if (rolHash === "dueno" && code === ACTIVATION_PIN && central !== "owner") {');
const e2 = src.indexOf('if (rolHash === "dueno" && code === ACTIVATION_PIN && central !== "owner" && _aparatoUnido) {');
assert.ok(s2 > 0 && e2 > s2, "any-device guard not found");
const runAny = (pinsRol) => {
  let msg = null;
  const window = { OCYjs: { meta: { get: () => pinsRol } } };
  const fn = new Function("rolHash", "code", "ACTIVATION_PIN", "central", "window", "error", src.slice(s2, e2) + "\nreturn 'entra';");
  return fn("dueno", "789", "789", "unconfigured", window, (m) => { msg = m; }) === "entra" && !msg ? "entra" : "rechaza";
};
test("any device: 789 rejected once the store says another Owner PIN", () => assert.equal(runAny({ owner: "555" }), "rechaza"));
test("any device: 789 still opens a store whose own PIN is 789", () => assert.equal(runAny({ owner: "789" }), "entra"));
test("any device: no store PIN known yet does not block a creator", () => assert.equal(runAny(null), "entra"));
test("factory 789 is never reported as the central Owner PIN", () =>
  assert.match(src, /central === "unconfigured" && code !== ACTIVATION_PIN\) registrarPinOwnerExistente\(code\)/));
