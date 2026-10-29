"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");

// Test the actual paste handlers from both entry points; all data are synthetic.
// No app launch, no network, no real license, no user storage.
for (const file of ["auth-ui.js", "dashboard.html"]) {
  test(file + ": empty iOS clipboardData leaves native paste available", () => {
    const text = file === "dashboard.html"
      ? require('./helpers/page-source.cjs').readFileSync(path.join(__dirname, "../docs", file), "utf8")
      : fs.readFileSync(path.join(__dirname, "../docs", file), "utf8");
    const begin = text.indexOf('inp.addEventListener("paste", function (e) {');
    // Focus must remain empty for native iOS Paste; the blur listener is the
    // next stable boundary after the paste handler in both entry points.
    const end = text.indexOf('inp.addEventListener("blur", function () {', begin);
    assert.ok(begin > 0 && end > begin, "paste and focus handlers must be located in the real source");
    const listeners = {};
    let formatted = 0, inputEvents = 0, deferred = 0;
    const inp = {
      value: "F123-",
      addEventListener(event, callback) { listeners[event] = callback; },
      setSelectionRange() {},
      dispatchEvent() { inputEvents++; }
    };
    vm.runInNewContext(text.slice(begin, end), {
      inp,
      window: {},
      formatear(value) { formatted++; return "F123-" + String(value).toUpperCase(); },
      alEscribir() {},
      setTimeout() { deferred++; },
      Event: class {}
    });
    assert.equal(typeof listeners.paste, "function");
    let prevented = false;
    listeners.paste({
      clipboardData: { getData() { return ""; } },
      preventDefault() { prevented = true; }
    });
    assert.equal(prevented, false, "never cancel the browser's native paste when clipboardData is empty");
    assert.equal(inp.value, "F123-", "do not clear the input when iOS withholds clipboard text");
    assert.equal(formatted, 0, "no empty-string formatting may replace a nonempty code");
    assert.ok(deferred >= 1, "defer normal formatting so native paste can insert text");

    prevented = false;
    listeners.paste({
      clipboardData: { getData() { return "SYNTHETIC"; } },
      preventDefault() { prevented = true; }
    });
    assert.equal(prevented, true, "explicit code replacement still cancels raw paste");
    assert.equal(inp.value, "F123-SYNTHETIC");
    assert.ok(inputEvents >= 0);
  });
}
