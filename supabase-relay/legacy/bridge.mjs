// Temporary wire compatibility for clients that still use the original socket.
// New clients should use the native adapter and share one Realtime connection.
export function attachLegacySocket({ incoming, relay, cleanup, initialFrames = [], setTimer = setTimeout, clearTimer = clearTimeout, maxDuration = 110000 }) {
  const pending = []; let pendingBytes = 0, finished = false, timer;
  let resolveDone;
  const done = new Promise(resolve => { resolveDone = resolve; });
  async function finish() {
    if (finished) return;
    finished = true; clearTimer(timer); pending.length = 0;
    try { if (incoming.readyState < 2) incoming.close(1000, 'relay reconnect'); } catch (_) {}
    try { relay.close(); } catch (_) {}
    try { await cleanup(); } catch (_) { /* closing cannot reopen a connection */ }
    finally { resolveDone(); }
  }
  function deliver(data) {
    if (finished) return;
    if (incoming.readyState === 1) { try { incoming.send(data); } catch (_) { void finish(); } }
    else if (incoming.readyState === 0) {
      const size = typeof data === 'string' ? new TextEncoder().encode(data).byteLength : data.byteLength ?? data.size ?? 0;
      pendingBytes += size;
      if (pendingBytes > 4 * 1024 * 1024) { void finish(); return; }
      pending.push(data);
    }
  }
  incoming.addEventListener('open', () => { for (const data of pending.splice(0)) deliver(data); pendingBytes = 0; });
  incoming.addEventListener('message', e => { try { relay.send(e.data); } catch (_) { void finish(); } });
  relay.addEventListener('message', e => deliver(e.data));
  for (const socket of [incoming, relay]) {
    socket.addEventListener('close', () => { void finish(); });
    socket.addEventListener('error', () => { void finish(); });
  }
  timer = setTimer(() => { void finish(); }, maxDuration);
  for (const frame of initialFrames) deliver(frame);
  return done;
}
