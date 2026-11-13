/* cloudflare-relay.js (13 nov 2026): adapter for the first cascade layer, the Worker friendly123-relay-capa1.
   It speaks the same encrypted v2 protocol as the original relay (op/ckpt/pull/head, persist-result, pull-page,
   head-result), so the adapter only swaps the host of the room URL. The Worker has its own daily budget and closes
   with 1013 when full, so relay-selector moves on to Supabase/Firebase exactly as with any other refusal.
   relay-selector.js only uses it on devices flagged for QA (localStorage f123_capa1_qa = "1"); everyone else
   keeps the v0.7.72 cascade unchanged. PARA RETIRAR: delete this file and its script tag. */
(function () {
  "use strict";
  var ORIGEN = "friendly123-sync-relay.jfcarpio.workers.dev", CAPA1 = "friendly123-relay-capa1.jfcarpio.workers.dev";
  window.F123CloudflareRelay = {
    // The Worker refuses frames over 256 KiB (MAX_FRAME_BYTES); checkpoints use the 256 KiB RPC fallback.
    ckptFrameBytes: 256 * 1024,
    connect: function (url) {
      var u = String(url);
      if (u.indexOf("wss://" + ORIGEN + "/") !== 0) throw new Error("capa1: unexpected room URL");
      return new WebSocket("wss://" + CAPA1 + u.slice(("wss://" + ORIGEN).length));
    }
  };
})();
