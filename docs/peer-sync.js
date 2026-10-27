// Business bytes travel only over direct RTC channels. The socket carries connection metadata.
(function () {
  'use strict';
  const ID = /^[a-f0-9]{32}$/, HASH = /^[a-f0-9]{64}$/;
  const MAX_PACKET = 384 * 1024, CHUNK = 12000, MAX_BUFFER = 512 * 1024, NUDGE_AFTER = 1000;
  function create(options = {}) {
    const WS = options.WebSocket || window.WebSocket, RTC = options.RTCPeerConnection || window.RTCPeerConnection;
    const secure = options.crypto || window.crypto, hubs = new Map();
    const signalURL = options.signalURL || 'wss://friendly123-sync-relay.jfcarpio.workers.dev/signal/';
    const iceServers = options.iceServers || [{ urls: 'stun:stun.cloudflare.com:3478' }];
    const random = () => Array.from(secure.getRandomValues(new Uint8Array(16)), n => n.toString(16).padStart(2, '0')).join('');
    const encode = bytes => { let value = ''; for (let i = 0; i < bytes.length; i += 8192) value += String.fromCharCode(...bytes.subarray(i, i + 8192)); return btoa(value); };
    const decode = text => { if (typeof text !== 'string' || text.length > MAX_PACKET * 2 || !/^[A-Za-z0-9+/]*={0,2}$/.test(text)) throw Error('Invalid peer frame'); return Uint8Array.from(atob(text), c => c.charCodeAt(0)); };
    const hash = async bytes => Array.from(new Uint8Array(await secure.subtle.digest('SHA-256', bytes)), n => n.toString(16).padStart(2, '0')).join('');
    class Socket extends EventTarget {
      constructor(hub, topic, url) {
        super(); this.hub = hub; this.topic = topic; this.url = url; this.peerOnly = true;
        this.readyState = 0; this.binaryType = 'arraybuffer'; this.onopen = this.onmessage = this.onerror = this.onclose = null;
        this.sent = new Map(); this.receipts = new Set(); this.ackCandidates = new Set(); this.serial = Promise.resolve(); this.queuedBytes = 0;
        hub.sockets.add(this); hub.start();
        if (hub.connected().length) queueMicrotask(() => this.open());
      }
      get bufferedAmount() { this.hub.nudge(); return this.queuedBytes + this.hub.connected().reduce((n, peer) => n + (peer.dc.bufferedAmount || 0), 0); }
      emit(type, properties = {}) {
        const event = type === 'message' ? new MessageEvent(type, { data: properties.data }) : new Event(type);
        for (const [key, value] of Object.entries(properties)) if (key !== 'data') Object.defineProperty(event, key, { value });
        this.dispatchEvent(event); if (typeof this['on' + type] === 'function') this['on' + type](event);
      }
      open() {
        if (this.readyState !== 0) return;
        this.readyState = 1; this.emit('open'); this.presence();
      }
      presence() { if (this.readyState === 1) this.emit('message', { data: JSON.stringify({ k: 'peers', n: this.hub.connected().length + 1 }) }); }
      send(value) {
        if (this.readyState !== 1) throw new DOMException('No direct peer is connected', 'InvalidStateError');
        const size = typeof value === 'string' ? new TextEncoder().encode(value).byteLength : value instanceof Blob ? value.size : value.byteLength;
        if (!Number.isFinite(size) || this.bufferedAmount + size > MAX_BUFFER) throw new DOMException('Direct peer queue is full', 'QuotaExceededError');
        this.queuedBytes += size;
        const copy = typeof value === 'string' ? value : value instanceof ArrayBuffer ? value.slice(0) : ArrayBuffer.isView(value) ? value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength) : value;
        this.serial = this.serial.then(async () => {
          if (this.readyState !== 1) return;
          let control; if (typeof copy === 'string') { try { control = JSON.parse(copy); } catch (_) {} }
          if (control && ['head', 'pull', 'ts'].includes(control.k)) {
            if (control.k === 'ts') this.hub.clock(control.t0);
            else if (control.k === 'head') this.emit('message', { data: JSON.stringify({ k: 'head-result', unsupported: true, v: 2 }) });
            else this.emit('message', { data: JSON.stringify({ k: 'pull-page', v: 2, rev: Math.max(-1, Number(control.rev) || 0), seq: Math.max(0, Number(control.seq) || 0), n: 0, more: false }) });
            return;
          }
          let packet;
          if (control && ['op', 'ckpt'].includes(control.k)) {
            if (control.ack !== 1 || typeof control.id !== 'string' || control.id.length > 160) throw Error('Invalid durable peer frame');
            const bytes = decode(control.c), digest = await hash(bytes), key = control.k + ':' + control.id;
            packet = { v: 1, topic: this.topic, type: 'durable', id: control.id, kind: control.k, hash: digest, data: encode(bytes) };
            const prior = this.sent.get(key);
            if (!prior && this.sent.size >= 4096) throw Error('Peer receipt capacity reached');
            // A legacy retry re-encrypts with a fresh IV; receipts for its previous ciphertext must expire.
            if (prior && prior.hash !== digest) for (const old of this.ackCandidates) if (old.id === control.id && old.kind === control.k) this.ackCandidates.delete(old);
            const record = prior && prior.hash === digest ? prior : { hash: digest, peers: new Map() }; this.sent.set(key, record);
            for (const peer of this.hub.connected()) if (await this.hub.deliver(peer, packet)) record.peers.set(peer.id, peer.dc);
            return;
          }
          const binary = typeof copy !== 'string';
          const bytes = binary ? new Uint8Array(copy instanceof Blob ? await copy.arrayBuffer() : copy) : null;
          packet = { v: 1, topic: this.topic, type: binary ? 'binary' : 'text', data: binary ? encode(bytes) : copy };
          for (const peer of this.hub.connected()) await this.hub.deliver(peer, packet);
        }).catch(() => { if (this.readyState === 1) this.close(1013, 'direct delivery pending; local changes retained'); }).finally(() => { this.queuedBytes -= size; });
      }
      confirmPeerReceipt(receipt, proof) {
        if (!this.receipts.has(receipt) || this.readyState !== 1) return false;
        const peer = this.hub.peers.get(receipt.peer);
        if (!peer || peer.dc !== receipt.channel || peer.dc.readyState !== 'open') return false;
        const bytes = proof instanceof ArrayBuffer ? new Uint8Array(proof) : proof;
        if (!(bytes instanceof Uint8Array) || bytes.byteLength > 4096) return false;
        this.receipts.delete(receipt);
        return this.hub.deliver(peer, { v: 1, topic: this.topic, type: 'ack', id: receipt.id, kind: receipt.kind, hash: receipt.hash, data: encode(bytes) });
      }
      acceptPeerAck(meta) {
        if (!this.ackCandidates.has(meta)) return false;
        this.ackCandidates.delete(meta);
        const key = meta.kind + ':' + meta.id, pending = this.sent.get(key);
        const peer = this.hub.peers.get(meta.peer);
        if (!pending || pending.hash !== meta.hash || !peer || pending.peers.get(meta.peer) !== peer.dc) return false;
        this.sent.delete(key);
        this.emit('message', { data: JSON.stringify({ k: 'persist-result', kind: meta.kind, id: meta.id, ok: true }), peerAccepted: true });
        return true;
      }
      close(code = 1000, reason = '') {
        if (this.readyState === 3) return;
        this.readyState = 3; this.hub.sockets.delete(this); this.receipts.clear(); this.ackCandidates.clear(); this.sent.clear();
        this.emit('close', { code, reason, wasClean: code === 1000 });
        if (!this.hub.sockets.size) this.hub.stop();
      }
    }
    class Hub {
      constructor(room) { this.room = room; this.id = random(); this.peers = new Map(); this.sockets = new Set(); this.signal = null; this.attempts = 0; this.timer = null; }
      connected() { return [...this.peers.values()].filter(peer => peer.dc && peer.dc.readyState === 'open'); }
      // v594: Chromium serves RTCDataChannel.bufferedAmount from a cached copy of the SCTP queue that it
      // refreshes only on send() and via a threshold callback. In real Chromium runs (CPU x6) the copy froze
      // at the total bytes sent (527889) while the receiver already held every byte, so both Socket.send and
      // deliver stayed blocked until the 5 s / 10 s deadlines. A frozen non-zero counter is refreshed with a
      // 2-byte '{}' frame: receive() already drops it (piece.v !== 1), also in older receivers. Counters that
      // move, or sit at 0, are never touched. No timer on purpose: nudge() runs only while somebody is waiting on the counter
      // (Socket.bufferedAmount, read by the sync-yjs pump every 100 ms, and the deliver() wait loop), so tests that count
      // pending timers and idle channels are unaffected. Tune NUDGE_AFTER only with a Chromium A/B run, not by guess.
      nudge() {
        const now = Date.now();
        for (const peer of this.peers.values()) {
          const dc = peer.dc; if (!dc || dc.readyState !== 'open') continue;
          const value = dc.bufferedAmount || 0, mark = peer.mark;
          if (!value || !mark || mark.channel !== dc || mark.value !== value) { peer.mark = { channel: dc, value, since: now, at: 0 }; continue; }
          if (now - mark.since >= NUDGE_AFTER && now - mark.at >= NUDGE_AFTER) { mark.at = now; try { dc.send('{}'); } catch (_) {} }
        }
      }
      start() {
        if (this.signal && this.signal.readyState < 2 || this.timer || this.attempts >= 5 || !this.sockets.size) return;
        this.attempts++;
        let ws; try { ws = new WS(signalURL + this.room + '?peer=' + this.id); } catch (_) { this.retry(); return; }
        this.signal = ws;
        let openedAt = 0;
        ws.onopen = () => { openedAt = Date.now(); };
        ws.onmessage = event => {
          let message; try { if (typeof event.data !== 'string' || event.data.length > 20000) return; message = JSON.parse(event.data); } catch (_) { return; }
          this.receiveSignal(message).catch(() => {});
        };
        ws.onclose = () => { if (this.signal === ws) { if (!ws.initialRTCFailed && openedAt && Date.now() - openedAt >= 30000) this.attempts = 0; this.signal = null; this.retry(); } };
        ws.onerror = () => { try { ws.close(); } catch (_) {} };
      }
      retry() { if (this.timer || this.attempts >= 5 || !this.sockets.size) return; this.timer = setTimeout(() => { this.timer = null; this.start(); }, Math.min(30000, 1000 * 2 ** (this.attempts - 1))); }
      signalTo(kind, to, data) { if (this.signal && this.signal.readyState === 1) this.signal.send(JSON.stringify({ v: 1, k: kind, to, data })); }
      clock(t0) { if (Number.isFinite(t0) && this.signal && this.signal.readyState === 1) this.signal.send(JSON.stringify({ v: 1, k: 'clock', t0 })); }
      peer(id) {
        if (!ID.test(id) || id === this.id) return null;
        if (this.peers.has(id)) return this.peers.get(id);
        if (this.peers.size >= 11) return null;
        const pc = new RTC({ iceServers }), peer = { id, pc, dc: null, ice: [], groups: new Map(), serial: Promise.resolve() };
        this.peers.set(id, peer);
        pc.onicecandidate = event => { if (event.candidate && event.candidate.type !== 'relay') this.signalTo('ice', id, event.candidate.toJSON()); };
        pc.ondatachannel = event => this.attach(peer, event.channel);
        pc.onconnectionstatechange = () => { if (['failed', 'closed'].includes(pc.connectionState)) this.remove(peer, pc.connectionState === 'failed'); };
        return peer;
      }
      attach(peer, dc) {
        if (dc.label !== 'friendly-direct-v1') { dc.close(); return; }
        peer.dc = dc; dc.binaryType = 'arraybuffer';
        dc.onmessage = event => { peer.serial = peer.serial.then(() => this.receive(peer, event.data)).catch(() => {}); };
        dc.onopen = () => {
          this.attempts = 0;
          for (const socket of this.sockets) {
            const wasOpen = socket.readyState === 1; socket.open(); socket.presence();
            if (wasOpen) socket.emit('message', { data: JSON.stringify({ k: 'peer-ready', peer: peer.id }) });
          }
        };
        dc.onclose = () => this.remove(peer, true);
      }
      remove(peer, retryInitial = false) {
        if (this.peers.get(peer.id) !== peer) return;
        this.peers.delete(peer.id); try { peer.pc.close(); } catch (_) {}
        for (const socket of [...this.sockets]) { socket.presence(); if (!this.connected().length && socket.readyState === 1) socket.close(1013, 'direct peer disconnected; local changes retained'); }
        // Restart a failed first negotiation within the existing finite signaling budget.
        if (retryInitial && this.sockets.size && !this.connected().length && this.signal && this.signal.readyState < 2) {
          this.signal.initialRTCFailed = true;
          try { this.signal.close(); } catch (_) {}
        }
      }
      async receiveSignal(message) {
        if (!message || message.v !== 1) return;
        if (message.k === 'clock') {
          if ([message.t0, message.t1, message.t2].every(Number.isFinite)) for (const socket of this.sockets) socket.emit('message', { data: JSON.stringify({ k: 'tsr', t0: message.t0, t1: message.t1, t2: message.t2 }) });
          return;
        }
        if (message.k === 'peers' && Array.isArray(message.peers) && message.peers.length <= 12) {
          for (const peer of [...this.peers.values()]) if (!message.peers.includes(peer.id) && (!peer.dc || peer.dc.readyState !== 'open')) this.remove(peer);
          for (const id of message.peers) {
            const peer = this.peer(id); if (!peer || this.id > id || peer.dc || peer.pc.signalingState !== 'stable') continue;
            this.attach(peer, peer.pc.createDataChannel('friendly-direct-v1'));
            await peer.pc.setLocalDescription(await peer.pc.createOffer());
            this.signalTo('offer', id, peer.pc.localDescription.toJSON());
          }
          return;
        }
        const peer = this.peer(message.from); if (!peer || message.to !== this.id) return;
        if (message.k === 'offer' && message.from < this.id) {
          await peer.pc.setRemoteDescription(message.data); for (const ice of peer.ice.splice(0)) await peer.pc.addIceCandidate(ice);
          await peer.pc.setLocalDescription(await peer.pc.createAnswer()); this.signalTo('answer', peer.id, peer.pc.localDescription.toJSON());
        } else if (message.k === 'answer' && peer.pc.signalingState === 'have-local-offer') {
          await peer.pc.setRemoteDescription(message.data); for (const ice of peer.ice.splice(0)) await peer.pc.addIceCandidate(ice);
        } else if (message.k === 'ice') {
          if (peer.pc.remoteDescription) await peer.pc.addIceCandidate(message.data); else if (peer.ice.length < 64) peer.ice.push(message.data);
        }
      }
      async deliver(peer, packet) {
        const text = JSON.stringify(packet); if (text.length > MAX_PACKET || !peer.dc || peer.dc.readyState !== 'open') return false;
        const id = random(), count = Math.max(1, Math.ceil(text.length / CHUNK));
        for (let i = 0; i < count; i++) {
          const until = Date.now() + 5000;
          while (peer.dc.readyState === 'open' && peer.dc.bufferedAmount > MAX_BUFFER) {
            if (Date.now() > until) return false; this.nudge(); await new Promise(resolve => setTimeout(resolve, 20));
          }
          if (peer.dc.readyState !== 'open') return false;
          peer.dc.send(JSON.stringify({ v: 1, id, i, count, data: text.slice(i * CHUNK, (i + 1) * CHUNK) }));
        }
        return true;
      }
      async receive(peer, raw) {
        // JSON wrapping may escape each data character; validate decoded size separately below.
        if (typeof raw !== 'string' || raw.length > CHUNK * 6 + 256) return;
        let piece; try { piece = JSON.parse(raw); } catch (_) { return; }
        if (piece.v !== 1 || !ID.test(piece.id) || !Number.isSafeInteger(piece.i) || !Number.isSafeInteger(piece.count) || piece.count < 1 || piece.count > 34 || piece.i < 0 || piece.i >= piece.count || typeof piece.data !== 'string' || piece.data.length > CHUNK) return;
        const now = Date.now(); for (const [id, group] of peer.groups) if (now - group.time > 120000) peer.groups.delete(id);
        let group = peer.groups.get(piece.id);
        if (!group) { if (peer.groups.size >= 64) return; group = { time: now, count: piece.count, parts: new Map(), bytes: 0 }; peer.groups.set(piece.id, group); }
        if (piece.count !== group.count || group.parts.has(piece.i)) return;
        group.parts.set(piece.i, piece.data); group.bytes += piece.data.length;
        if (group.bytes > MAX_PACKET) { peer.groups.delete(piece.id); return; }
        if (group.parts.size !== group.count) return;
        peer.groups.delete(piece.id);
        let packet; try { packet = JSON.parse(Array.from({ length: group.count }, (_, i) => group.parts.get(i)).join('')); } catch (_) { return; }
        if (!packet || packet.v !== 1 || !['', '-y', '-ops', '-fotos'].includes(packet.topic)) return;
        for (const socket of this.sockets) {
          if (socket.topic !== packet.topic || socket.readyState !== 1) continue;
          if (packet.type === 'text' && typeof packet.data === 'string') socket.emit('message', { data: packet.data, relaySource: 'peer' });
          else if (packet.type === 'binary') socket.emit('message', { data: decode(packet.data).buffer, relaySource: 'peer' });
          else if (['durable', 'ack'].includes(packet.type) && ['op', 'ckpt'].includes(packet.kind) && typeof packet.id === 'string' && packet.id.length <= 160 && HASH.test(packet.hash)) {
            const bytes = decode(packet.data);
            if (packet.type === 'durable') {
              if (await hash(bytes) !== packet.hash) continue;
              for (const old of socket.receipts) if (old.peer === peer.id && old.id === packet.id && old.kind === packet.kind) socket.receipts.delete(old);
              if (socket.receipts.size >= 4096) continue;
              const receipt = { id: packet.id, kind: packet.kind, hash: packet.hash, peer: peer.id, channel: peer.dc };
              socket.receipts.add(receipt); socket.emit('message', { data: bytes.buffer, relaySource: 'peer', peerReceipt: receipt });
            } else {
              const pending = socket.sent.get(packet.kind + ':' + packet.id);
              if (!pending || pending.hash !== packet.hash || pending.peers.get(peer.id) !== peer.dc || bytes.length > 4096 || socket.ackCandidates.size >= 4096) continue;
              for (const old of socket.ackCandidates) if (old.peer === peer.id && old.id === packet.id && old.kind === packet.kind) socket.ackCandidates.delete(old);
              const meta = { id: packet.id, kind: packet.kind, hash: packet.hash, peer: peer.id };
              socket.ackCandidates.add(meta); socket.emit('message', { data: bytes.buffer, relaySource: 'peer-ack', peerAck: meta });
            }
          }
        }
      }
      stop() { clearTimeout(this.timer); this.timer = null; this.attempts = 0; const ws = this.signal; this.signal = null; if (ws) try { ws.close(); } catch (_) {} for (const peer of this.peers.values()) try { peer.pc.close(); } catch (_) {} this.peers.clear(); }
    }
    const resume = () => { if (document.hidden) return; for (const hub of hubs.values()) { hub.attempts = 0; hub.start(); } };
    window.addEventListener('online', resume); document.addEventListener('visibilitychange', resume);
    return { connect(url) {
      if (typeof RTC !== 'function') throw new Error('Direct peer connections are unavailable in this browser');
      const match = String(url).match(/^wss:\/\/friendly123-sync-relay\.jfcarpio\.workers\.dev\/sala\/([a-f0-9]{40})(-y|-ops|-fotos)?$/);
      if (!match) throw new TypeError('Unsupported notebook locator');
      let hub = hubs.get(match[1]); if (!hub) { if (hubs.size >= 32) throw Error('Too many notebook connections'); hub = new Hub(match[1]); hubs.set(match[1], hub); }
      return new Socket(hub, match[2] || '', String(url));
    }, closeAll() { window.removeEventListener('online', resume); document.removeEventListener('visibilitychange', resume); for (const hub of hubs.values()) for (const socket of [...hub.sockets]) socket.close(); } };
  }
  window.F123Peer = { create };
  window.F123Relay = create();
})();
