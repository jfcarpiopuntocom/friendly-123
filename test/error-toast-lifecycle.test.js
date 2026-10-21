// The global error notice must be nonblocking and preserve diagnostics.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
const html = fs.readFileSync(path.join(__dirname, "../docs/index.html"), "utf8");
const block = html.match(/\(function cajaNegraErrores\(\) \{[\s\S]*?\n\}\)\(\);/);
assert.ok(block, "Global error handler must be present");
function harness() {
  const events = new Map();
  const banners = [], timers = [], data = new Map();
  let reloads = 0;
  const root = { appendChild(el) { banners.push(el); } };
  const document = {
    body: root, documentElement: root,
    createElement() {
      const actions = new Map();
      return {
        style: {}, innerHTML: "", removed: false, attrs: {},
        setAttribute(k,v) { this.attrs[k] = v; },
        remove() { this.removed = true; },
        querySelector(sel) {
          if (!actions.has(sel)) {
            const handlers = new Map();
            actions.set(sel, {
              addEventListener(type, cb) { handlers.set(type, cb); },
              click() { assert.ok(handlers.has("click")); handlers.get("click")(); }
            });
          }
          return actions.get(sel);
        }
      };
    }
  };
  const window = {
    addEventListener(type, cb) {
      if (!events.has(type)) events.set(type, []);
      events.get(type).push(cb);
    }
  };
  const context = { window, document,
    setTimeout(cb, ms) { timers.push({ cb, ms }); },
    localStorage: {
      getItem(k) { return data.get(k) || null; },
      setItem(k, v) { data.set(k, String(v)); }
    },
    location: { reload() { reloads++; } }
  };
  vm.runInNewContext(block[0], context, { timeout: 1000 });
  const emit = (type, ev={}) => (events.get(type) || []).forEach(cb => cb(ev));
  return { emit, banners, timers, data, reloads: () => reloads };
}
const failure = { message: "synthetic error", filename: "synthetic.js", lineno: 19 };
test("customer can close the alert without reloading or losing the log", () => {
  const s = harness(); s.emit("error", failure);
  assert.equal(s.banners.length, 1);
  const banner = s.banners[0];
  assert.match(banner.innerHTML, /data-f123-error-close/);
  banner.querySelector("[data-f123-error-close]").click();
  assert.equal(banner.removed, true);
  assert.equal(s.reloads(), 0);
  assert.equal(JSON.parse(s.data.get("f123_errores")).length, 1);
});
test("successful PIN login immediately clears a previous alert", () => {
  const s = harness(); s.emit("error", failure);
  s.emit("oc-login", { detail: { rol: "dueno" } });
  assert.equal(s.banners[0].removed, true);
});
test("automatic dismissal occurs after eight seconds", () => {
  const s = harness(); s.emit("error", failure);
  const timer = s.timers.find(t => t.ms === 8000);
  assert.ok(timer); timer.cb();
  assert.equal(s.banners[0].removed, true);
  assert.equal(JSON.parse(s.data.get("f123_errores"))[0].msg, "synthetic error");
});
test("repeated failures do not recreate the alert but remain in diagnostics", () => {
  const s = harness(); s.emit("error", failure);
  s.emit("error", { ...failure, message: "second synthetic error" });
  assert.equal(s.banners.length, 1);
  assert.equal(JSON.parse(s.data.get("f123_errores")).length, 2);
});
test("promise rejections stay logged without the overlay", () => {
  const s = harness(); s.emit("unhandledrejection", { reason: new Error("synthetic rejection") });
  assert.equal(s.banners.length, 0);
  assert.equal(JSON.parse(s.data.get("f123_errores")).length, 1);
});
test("explicit reload continues to work", () => {
  const s = harness(); s.emit("error", failure);
  s.banners[0].querySelector("[data-f123-error-reload]").click();
  assert.equal(s.reloads(), 1);
});
test("ResizeObserver loop notice is logged but never shown as a failure (Sentry FRIENDLY-123-1)", () => {
  const s = harness(); s.emit("error", { message: "ResizeObserver loop completed with undelivered notifications.", filename: "", lineno: 0 });
  assert.equal(s.banners.length, 0, "benign browser notification must not show the black notice");
  assert.equal(JSON.parse(s.data.get("f123_errores")).length, 1, "still recorded for diagnostics");
  s.emit("error", failure);
  assert.equal(s.banners.length, 1, "a real exception afterwards still shows the notice");
});
test("header ResizeObserver measures outside its own callback and canarios skips the benign notice", () => {
  const index = fs.readFileSync(path.join(__dirname, "../docs/index.html"), "utf8");
  const can = fs.readFileSync(path.join(__dirname, "../docs/canarios.js"), "utf8");
  assert.match(index, /new ResizeObserver\(function \(\) \{ if \(_raf\) return; _raf = requestAnimationFrame/);
  assert.match(can, /ResizeObserver loop/);
});
