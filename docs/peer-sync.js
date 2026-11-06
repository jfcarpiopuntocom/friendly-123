// Business bytes travel only over direct RTC channels. The socket carries connection metadata.
(function () {
  'use strict';
  const ID = /^[a-f0-9]{32}$/, HASH = /^[a-f0-9]{64}$/;
  const MAX_PACKET = 384 * 1024, CHUNK = 12000, MAX_BUFFER = 512 * 1024, NUDGE_AFTER = 1000;
  // ---- v656 ICE cascade (decided by JFC 2026-11-03: "apruebo Open Relay") ----------------------------
  // Order the browser tries on its own: same Wi-Fi (host/mDNS candidates) -> STUN -> TURN. The durable
  // relays stay as the last resort and are not touched here.
  // STUN is NOT Cloudflare on purpose (JFC order 16-Oct: Cloudflare only for licences, never for sync).
  // TURN = Metered Open Relay. Its shared key is public (https://www.metered.ca/tools/openrelay/), so it may
  // live in the source. Login is the TURN REST kind:
  //   username = "<expiryUnixSeconds>:f123", password = base64(HMAC-SHA1(shared key, username)).
  // KILL SWITCH: set F123_TURN_ON = false to ship STUN only (no TURN entry is built).
  const F123_TURN_ON = true;
  const ICE_HOST = 'staticauth.openrelay.metered.ca', ICE_KEY = 'openrelayprojectsecret', ICE_TTL_MS = 3600000;
  const ICE_STUN = () => [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:' + ICE_HOST + ':80' }];
  let iceCache = null, icePending = null;
  async function iceTurn() {
    // shortcut: crypto.subtle only exists on https/localhost; elsewhere this throws and build() keeps STUN only.
    const subtle = window.crypto.subtle;
    const username = Str¶»§q«^