"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { browser } = require("./helpers/browser.cjs");

const tick = () => new Promise(resolve => setImmediate(resolve));
async function flush() { for (let i = 0; i < 4; i++) await tick(); }

// The real browser fixture intercepts /api and runs the actual mock-backend.
// No network, real licenses, client names, or customer data are involved.
// A failed first persistence and an overlapping second write MUST NOT remove
// the second expense or falsely announce success for a failed first write.
for (const firstOk of [false, true]) {
  test("simultaneous expense writes serialize durable boundaries; first=" + firstOk, async () => {
    const app = browser();
    app.OCAuth = { rolActual: () => "dueno" };
    const originalSetItem = app.localStorage.setItem;
    app.localStorage.setItem = () => { throw new Error("Synthetic localStorage quota"); };
    const gates = [];
    app.OCEstadoIDB = {
      guardar: () => new Promise(resolve => { gates.push(resolve); })
    };
    const post = concepto => app.fetch("/api/gastos", {
      method: "POST",
      body: JSON.stringify({ concepto, monto: 12.34, metodoPago: "cash" })
    });

    const a = post("Synthetic expense A");
    await flush();
    assert.equal(gates.length, 1, "first durable boundary must reach the delayed IDB mirror");

    const b = post("Synthetic expense B");
    await flush();
    assert.equal(gates.length, 1, "the second mutation cannot enter its durable boundary before the first settles");

    gates[0](firstOk);
    const replyA = await a;
    assert.equal(replyA.status, firstOk ? 200 : 507);
    await flush();
    assert.equal(gates.length, 2, "second durable boundary starts only after first commit or rollback");

    gates[1](true);
    const replyB = await b;
    assert.equal(replyB.status, 200, "the second expense really commits");
    const { gastos } = await (await app.fetch("/api/gastos")).json();
    assert.equal(gastos.filter(g => g.concepto === "Synthetic expense B").length, 1,
      "second committed expense survives the first transaction's outcome");
    assert.equal(gastos.some(g => g.concepto === "Synthetic expense A"), firstOk,
      "first failed expense is absent; first committed expense remains");
    const backup = await (await app.fetch("/api/respaldo/exportar")).json();
    assert.equal(backup.gastos.some(g => g.concepto === "Synthetic expense B"), true,
      "export snapshot includes the durable second expense");

    app.localStorage.setItem = originalSetItem;
    delete app.OCEstadoIDB;
  });
}
