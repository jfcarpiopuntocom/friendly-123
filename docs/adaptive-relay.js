// Friendly-123: one room-wide transport decision per active page.
// Native encrypted store-and-forward when available; retain the legacy
// WebRTC data channel while a provider returns 402/unavailable.
// Existing Yjs/outbox code owns encrypted payload, ID deduplication and replay.
(function () {
  "use strict";
  const native = window.F123Relay;
  const createPeer = window.F123Peer && window.F123Peer.create;
  if (!native || typeof native.connect !== "function" || typeof createPeer !== "function") return;
  const peer = createPeer();
  const rooms = new Map();
  const ROOM = /^wss:\/\/friendly123-sync-relay\.jfcarpio\.workers\.dev\/sala\/([a-f0-9]{40})(?:-y|-ops|-fotos)?$/;
  function choose(room, url) {
    let group = rooms.get(room);
    if (group) return group;
    group = { mode: null, first: null, firstUrl: url, sockets: new Set(), choosing: null };
    rooms.set(room, group);
    try { group.first = native.connect(url); }
    catch (_) { group.mode = "peer"; }
    group.choosing = group.first ? new Promise(resolve => {
      let finished = false;
      function settle(mode) {
        if (finished) return;
        finished = true;
        group.mode = mode;
        group.first.removeEventListener("open", opened);
        group.first.removeEventListener("close", failed);
        group.first.removeEventListener("error", failed);
        resolve(mode);
      }
      const opened = () => settle("native");
      const failed = () => settle("peer");
      group.first.addEventListener("open", opened);
      group.first.addEventListener("close", failed);
      group.first.addEventListener("error", failed);
      if (group.first.readyState === 1) settle("native");
      else if (group.first.readyState >= 2) settle("peer");
    }) : Promise.resolve("peer");
    return group;
  }
  class AdaptiveSocket extends EventTarget {
    constructor(url) {
      super();
      this.url = String(url);
      const match = this.url.match(ROOM);
      if (!match) throw new TypeError("Unsupported notebook locator");
      this.room = match[1]; this.readyState = 0; this.binaryType = "arraybuffer";
      this.peerOnly = false;
      this.onopen = null; this.onmessage = null; this.onerror = null; this.onclose = null;
      this.delegate = null; this.closed = false;
      const group = choose(this.room, this.url);
      this.group = group; group.sockets.add(this);
      group.choosing.then(mode => {
        if (this.closed) return;
        let socket;
        try {
          socket = mode === "native"
            ? (group.firstUrl === this.url && group.first ? (group.firstUrl = "", group.first) : native.connect(this.url))
            : peer.connect(this.url);
        } catch (_) { return this.fail(); }
        this.delegate = socket; this.peerOnly = mode === "peer";
        socket.binaryType = this.binaryType;
        socket.addEventListener("open", () => this.open());
        socket.addEventListener("message", e => {
          if (this.closed || this.readyState !== 1) return;
          const event = new MessageEvent("message", { data: e.data });
          for (const name of ["relaySource", "peerReceipt", "peerAck", "peerAccepted"]) {
            if (e[name] !== undefined) Object.defineProperty(event, name, { value: e[name] });
          }
          this.emit(event);
        });
        socket.addEventListener("error", () => { if (!this.closed) this.emit(new Event("error")); });
        socket.addEventListener("close", e => this.close(e.code || 1011, e.reason || "", e.wasClean));
        if (socket.readyState === 1) this.open();
        else if (socket.readyState >= 2) this.fail();
      }).catch(() => this.fail());
    }
    emit(e) {
      this.dispatchEvent(e);
      const f = this["on" + e.type];
      if (typeof f === "function") f.call(this, e);
    }
    open() {
      if (this.closed || this.readyState !== 0) return;
      this.readyState = 1; this.emit(new Event("open"));
    }
    fail() { this.emit(new Event("error")); this.close(1011, "sync transport unavailable", false); }
    get bufferedAmount() { return this.delegate?.bufferedAmount || 0; }
    send(frame) {
      if (this.readyState !== 1 || !this.delegate) throw new DOMException("Notebook is not connected", "InvalidStateError");
      return this.delegate.send(frame);
    }
    confirmPeerReceipt(...args) { return this.delegate?.confirmPeerReceipt?.(...args) || false; }
    acceptPeerAck(...args) { return this.delegate?.acceptPeerAck?.(...args) || false; }
    close(code = 1000, reason = "", clean = code === 1000) {
      if (this.closed) return;
      this.closed = true; this.readyState = 3;
      try { if (this.delegate && this.delegate.readyState < 2) this.delegate.close(code, reason); } catch (_) {}
      const group = this.group;
      group.sockets.delete(this);
      if (!group.sockets.size && rooms.get(this.room) === group) {
        rooms.delete(this.room);
        try { if (group.first && group.first !== this.delegate && group.first.readyState < 2) group.first.close(); } catch (_) {}
      }
      const e = new Event("close");
      for (const [k,v] of Object.entries({code, reason, wasClean:clean})) Object.defineProperty(e,k,{value:v});
      this.emit(e);
    }
  }
  window.F123Relay = {
    connect(url) { return new AdaptiveSocket(url); },
    closeAll() { for (const group of [...rooms.values()]) for (const s of [...group.sockets]) s.close(); peer.closeAll?.(); }
  };
})();
