/* hf-relay.js (owner order 2026-11-04): third durable layer. The Hugging Face Space (hf-relay/server.mjs) speaks the same
   room protocol as the old Cloudflare relay (op/ckpt -> persist-result, pull v2 pages, head, ts), so this adapter only
   maps the app's room locator to the Space and returns a plain WebSocket. Frames stay end-to-end encrypted; the Space
   stores ciphertext in a private Hugging Face dataset. Photos never come here (relay-selector routes -fotos to peers).
   Exposes window.F123RelayHF = { ckptFrameBytes, connect(url) }. Loaded after firebase-relay.js, before relay-selector.js.
   To disable: remove the script tag from index.html (the selector then skips this layer; nothing else changes).
   Optional room token: if the page defines window.F123HFToken (string or function(room) -> string) it is sent as ?t=. */
(function () {
  "use strict";
  var HOST = "wss://jfcarpio-f123-relay.hf.space";
  var CKPT_CIPHER_BYTES = 768 * 1024; // same value the other layers advertise: sync-yjs compares it
  var LOC = /^wss:\/\/friendly123-sync-relay\.jfcarpio\.workers\.dev\/sala\/([a-f0-9]{40})(-y|-ops)?$/;
  function token(room) {
    try { var t = window.F123HFToken; t = typeof t === "function" ? t(room) : t; return typeof t === "string" && /^[0-9.a-f]{20,120}$/.test(t) ? t : ""; } catch (_) { return ""; }
  }
  window.F123RelayHF = {
    ckptFrameBytes: CKPT_CIPHER_BYTES,
    connect: function (url) {
      var m = String(url).match(LOC);
      if (!m) throw new TypeError("Unsupported notebook locator");
      var room = m[1] + (m[2] || ""), t = token(room);
      var ws = new WebSocket(HOST + "/sala/" + room + (t ? "?t=" + t : ""));
      ws.binaryType = "arraybuffer";
      return ws;
    }
  };
})();
