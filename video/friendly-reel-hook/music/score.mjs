// music/score.mjs: the reel's original score, synthesized from scratch (no samples) and locked to reel/cues.js.
//   node music/score.mjs → music/score.wav, then:
//   ffmpeg -y -i music/score.wav -af "highpass=f=30,equalizer=f=250:t=q:w=1:g=-2,loudnorm=I=-14:TP=-1.2:LRA=8" -c:a aac -b:a 192k assets/score.m4a
// 120 BPM, A minor-ish, electronic: 808-style kick, clap, hats, a saw-ish bass, pluck arps, pads, in-key stabs/blips.
// SOUND RULE: no noise whooshes on transitions (they tire the ear fast). Chapter changes: swell(); cuts inside a chapter:
// bloom / glide / harp / hatRoll, or nothing. See references/sound.md in the kinetic-reel skill.
import { createRequire } from 'module';
import { writeFileSync } from 'fs';
const require = createRequire(import.meta.url);
const C = require('../reel/cues.js'), S = C.S, Hh = C.hits;
const SR = 44100, DUR = C.dur + 1, N = Math.ceil(SR * DUR), BEAT = .5, TAU = Math.PI * 2;
const L = new Float32Array(N), R = new Float32Array(N), sendL = new Float32Array(N), sendR = new Float32Array(N);
const duck = new Float32Array(N).fill(1);   // sidechain: kick ducks the music bus
const musL = new Float32Array(N), musR = new Float32Array(N);
let seed = 7; const rnd = () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
const mtof = m => 440 * Math.pow(2, (m - 69) / 12);

function put(t0, len, gen, { gain = 1, pan = 0, rev = 0, bus = 'drum' } = {}) {
  const i0 = Math.max(0, Math.floor(t0 * SR)), i1 = Math.min(N, Math.floor((t0 + len) * SR));
  const gl = gain * Math.cos((pan + 1) * Math.PI / 4), gr = gain * Math.sin((pan + 1) * Math.PI / 4);
  const BL = bus === 'mus' ? musL : L, BR = bus === 'mus' ? musR : R;
  // float rounding can make the first sample's local time -1e-16, and pow() of a negative is NaN: clamp it
  for (let i = i0; i < i1; i++) { const v = gen(Math.max(0, (i - t0 * SR) / SR)); BL[i] += v * gl; BR[i] += v * gr; sendL[i] += v * gl * rev; sendR[i] += v * gr * rev; }
}
function noise(t0, len, env, filt, o = {}) {
  let lp = 0, bp = 0;
  put(t0, len, tt => { const n = rnd() * 2 - 1, [fc, q0] = filt(tt), q = Math.max(q0, .45), f = Math.min(.85, 2 * Math.sin(Math.PI * Math.min(fc, SR / 7) / SR)); lp += f * bp; const hp = n - lp - q * bp; bp += f * hp; return env(tt) * (o.hp ? hp : o.lp ? lp : bp); }, o);   // f/q clamped: the SVF blows up near f = 1
}
// ---------- drums ----------
const kick = (t, v = 1) => {
  put(t, .55, tt => v * Math.sin(TAU * (48 * tt + 110 * (1 - Math.exp(-tt * 32)) / 32)) * Math.exp(-tt * 6.5) * (tt < .003 ? tt / .003 : 1), { gain: .95 });
  noise(t, .02, tt => v * .5 * Math.exp(-tt * 300), () => [3000, .5], { gain: .5 });
  const i0 = Math.floor(t * SR); for (let i = 0; i < SR * .3 && i0 + i < N; i++) duck[i0 + i] = Math.min(duck[i0 + i], 1 - .65 * Math.exp(-i / SR * 11));
};
const clap = (t, v = 1) => { for (let k = 0; k < 3; k++) noise(t + k * .012, .25, tt => v * (k === 2 ? .8 * Math.exp(-tt * 14) : .6 * Math.exp(-tt * 70)), () => [1400, .5], { gain: .75, rev: .25 }); put(t, .12, tt => v * .25 * Math.sin(TAU * 190 * tt) * Math.exp(-tt * 30), { gain: .6 }); };
const hat = (t, v = 1, open = false) => noise(t, open ? .3 : .06, tt => v * .45 * Math.exp(-tt * (open ? 12 : 70)), () => [9000, .6], { gain: .5, pan: .25, hp: true });
const tick = (t, v = 1) => put(t, .03, tt => v * .3 * Math.sin(TAU * 2600 * tt) * Math.exp(-tt * 180), { gain: .5, pan: -.3 });
// ---------- fx ----------
const impact = (t, v = 1) => { kick(t, v); noise(t, 1.4, tt => v * .9 * Math.exp(-tt * 3.2), tt => [1800 * Math.exp(-tt * 2) + 200, .7], { gain: .7, rev: .6, lp: true }); put(t, 1.6, tt => v * .5 * Math.sin(TAU * (38 * tt + 30 * (1 - Math.exp(-tt * 8)) / 8)) * Math.exp(-tt * 2.2), { gain: .8 }); };
const whoosh = (t, len, v = 1, up = true, pan = 0) => noise(t, len, tt => v * Math.pow(Math.sin(Math.PI * Math.min(1, tt / len)), 2), tt => [up ? 300 * Math.pow(25, tt / len) : 7000 * Math.pow(1 / 25, tt / len), .35], { gain: .7, pan, rev: .4 });
const riser = (t, len, v = 1) => { noise(t, len, tt => v * .35 * Math.pow(tt / len, 2.2), tt => [400 * Math.pow(12, tt / len), .6], { gain: .55, rev: .5, lp: true }); put(t, len, tt => v * .12 * Math.sin(TAU * (220 * tt + 440 * tt * tt / len)) * Math.pow(tt / len, 2), { gain: .6, rev: .4, bus: 'mus' }); };
const glitch = (t, len, v = 1) => { for (let k = 0; k < Math.floor(len / .035); k++) { const tt = t + k * .035, f = 300 + 3000 * rnd(); put(tt, .03, x => v * .22 * Math.sign(Math.sin(TAU * f * x)) * (rnd() < .5 ? 1 : .3), { gain: .6, pan: rnd() * 2 - 1 }); } };
const blip = (t, m = 93, v = 1, pan = 0) => put(t, .14, tt => v * .28 * Math.sin(TAU * mtof(m) * tt) * Math.exp(-tt * 28), { gain: .7, pan, rev: .35, bus: 'mus' });
const stab = (t, notes, v = 1) => notes.forEach((m, i) => put(t, .7, tt => v * .12 * (Math.sin(TAU * mtof(m) * tt) + .5 * Math.sin(TAU * mtof(m) * 2.001 * tt) + .25 * Math.sin(TAU * mtof(m) * 3 * tt)) * Math.exp(-tt * 5), { gain: .8, pan: (i - 1) * .4, rev: .45, bus: 'mus' }));
const odo = (t, len, v = 1) => { for (let k = 0; k < len / .045; k++) tick(t + k * .045 * (1 + k * .02), v * (.5 + .5 * rnd())); };
// ---------- synths ----------
const bass = (t, m, len, v = 1) => { let ph = 0; put(t, len + .05, tt => { ph += mtof(m) / SR; const saw = 2 * (ph % 1) - 1, sq = (ph % 1) < .5 ? 1 : -1, env = Math.min(1, tt / .005) * (tt < len ? 1 : Math.exp(-(tt - len) * 60)); return v * .32 * env * (Math.tanh(1.8 * (saw * .6 + sq * .25 + Math.sin(TAU * ph * .5) * .8))); }, { gain: .75, bus: 'mus' }); };
const pluck = (t, m, v = 1, pan = 0) => put(t, .5, tt => v * .16 * (Math.sin(TAU * mtof(m) * tt) + .35 * Math.sin(TAU * mtof(m) * 2 * tt) * Math.exp(-tt * 12) + .15 * Math.sin(TAU * mtof(m) * 3.01 * tt) * Math.exp(-tt * 20)) * Math.exp(-tt * 9), { gain: .8, pan, rev: .3, bus: 'mus' });
const pad = (t, notes, len, v = 1) => notes.forEach((m, i) => { const d = [1, 1.004, .996]; put(t, len + .8, tt => { let s = 0; for (const k of d) for (let h = 1; h <= 4; h++) s += Math.sin(TAU * mtof(m) * k * h * tt + h) / (h * h); return v * .025 * s * Math.min(1, tt / .4) * (tt > len ? Math.exp(-(tt - len) * 4) : 1); }, { gain: .8, pan: (i - 1) * .5, rev: .6, bus: 'mus' }); });

// ---------- arrangement (bars of 2 s) ----------
// JAZZ (JFC 2026-10-01: "jazzy music cool"). Turnaround ii-V-I-VI en Do: Dm9 G13 Cmaj9 A7(b9).
// Swing: la corchea de "y" cae al 2/3 del pulso. Ride swing, escobillas en 2 y 4, bombo suave en 1,
// contrabajo caminando en negras y comping de Rhodes en anticipaciones.
const CH = [[53, 57, 60, 64], [53, 57, 59, 64], [52, 55, 59, 62], [55, 58, 61, 64]];
const WALK = [[38, 41, 45, 43], [43, 47, 50, 44], [36, 40, 43, 42], [45, 49, 52, 37]];
const barOf = t => Math.floor(t / 2);
const rhodes = (t, notes, len, v = 1) => notes.forEach((m, i) => put(t + i * .012, len + .4, tt => {
  const f = mtof(m), trem = 1 + .18 * Math.sin(TAU * 5.5 * tt), env = Math.min(1, tt / .008) * Math.exp(-tt * 1.6);
  return v * .075 * env * trem * (Math.sin(TAU * f * tt) + .45 * Math.sin(TAU * f * 2 * tt) * Math.exp(-tt * 5) + .12 * Math.sin(TAU * f * 3.01 * tt) * Math.exp(-tt * 9));
}, { gain: .85, pan: -.35 + .7 * i / Math.max(1, notes.length - 1), rev: .35, bus: 'mus' }));
const upright = (t, m, len, v = 1) => put(t, len + .08, tt => {
  const f = mtof(m), env = Math.min(1, tt / .006) * Math.exp(-tt * 3.2) * (tt > len ? Math.max(0, 1 - (tt - len) / .08) : 1);
  return v * .5 * env * (Math.sin(TAU * f * tt) + .3 * Math.sin(TAU * f * 2 * tt) * Math.exp(-tt * 6));
}, { gain: .9, pan: .05, bus: 'mus' });
const brush = (t, v = 1) => noise(t, .22, tt => v * .35 * Math.exp(-tt * 18), () => [2600, .5], { gain: .55, pan: -.1, rev: .2 });

for (let t = 0; t < Hh.glitch; t += BEAT) {
  const b = Math.round(t / BEAT), beatIn = b % 4, ch = barOf(t) % 4, calm = t >= S.quote && t < S.end, sw = BEAT * 2 / 3;
  if (beatIn === 0) kick(t, calm ? .35 : .5);
  if (beatIn === 1 || beatIn === 3) brush(t, calm ? .5 : .8);
  hat(t, .55); if (beatIn === 1 || beatIn === 3) hat(t + sw, .4);          // ride: ding, ding-a
  upright(t, WALK[ch][beatIn], BEAT * .9, calm ? .7 : .95);
  if (!calm && (beatIn === 1 || beatIn === 3)) rhodes(t + sw, CH[ch].map(m => m + 12), .35, .9);   // comping anticipado
  if (beatIn === 0) rhodes(t, CH[ch].map(m => m + 12), 1.2, calm ? 1 : .7);
}

// ---- transition sound design (v3.1): no noise whooshes. Transitions are carried by the music: a reversed-pad swell
// into each chapter, and small in-key tonal cues (never the same one twice in a row) for the cuts inside a chapter.
// About half of the in-chapter transitions get no cue at all: the downbeat + the next shot's own sounds carry them.
const swell = (tEnd, notes, len = 1.6, v = 1) => notes.forEach((m, i) => put(tEnd - len, len + .06, tt => {   // reverse pad: grows, then stops dead on the cut
  const q = tt / len, env = q < 1 ? Math.pow(q, 2.6) : Math.max(0, 1 - (tt - len) / .06); let s = 0;
  for (let h = 1; h <= 3; h++) s += Math.sin(TAU * mtof(m) * h * tt + h) / (h * h);
  return v * .07 * s * env;
}, { gain: .8, pan: (i / Math.max(1, notes.length - 1) - .5) * .6, rev: .35, bus: 'mus' }));
const bloom = (t, notes, v = 1) => notes.forEach((m, i) => put(t + i * .03, 1.6, tt => v * .06 * (Math.sin(TAU * mtof(m) * tt) + .3 * Math.sin(TAU * mtof(m) * 2.01 * tt)) * Math.min(1, tt / .08) * Math.exp(-tt * 2.4), { gain: .8, pan: (i - 1) * .4, rev: .6, bus: 'mus' }));
const glide = (t, len, m0, m1, v = 1) => { let ph = 0; put(t, len + .15, tt => { const q = Math.min(1, tt / len), f = mtof(lerpN(m0, m1, q * q * (3 - 2 * q))); ph += f / SR; const tri = 1 - 4 * Math.abs((ph % 1) - .5); return v * .07 * tri * Math.sin(Math.PI * Math.min(1, tt / (len + .15))); }, { gain: .8, rev: .45, bus: 'mus' }); };
const harp = (t, span, notes, v = 1, dir = 1) => notes.forEach((m, i) => pluck(t + (dir > 0 ? i : notes.length - 1 - i) * span / notes.length, m, .32 * v, -.6 + 1.2 * i / Math.max(1, notes.length - 1)));
const hatRoll = (t, n = 4, v = .6) => { for (let k = 0; k < n; k++) hat(t - (n - k) * .0625, v * (.4 + .6 * k / n)); };
const lerpN = (a, b, k) => a + (b - a) * k;
const softImpact = (t, v = 1) => { kick(t, v); put(t, 1.2, tt => v * .4 * Math.sin(TAU * (40 * tt + 24 * (1 - Math.exp(-tt * 8)) / 8)) * Math.exp(-tt * 2.6), { gain: .8 }); };   // no noise tail
const AM = [57, 64, 69, 72], FM = [53, 60, 65, 69], CM = [52, 60, 67, 72], GM = [55, 62, 67, 71];

// ---- hits, one line per shot
bloom(S.title, [69, 76, 81], .9); for (let i = 0; i < 12; i++) tick(Hh.title + i * .035, .7); [0, 1, 2].forEach(i => blip(Hh.chips + i * .15, 88 + i * 3, .6, -.3 + i * .3));
Hh.cards.forEach((t, i) => { bloom(t, [[69, 72, 76], [67, 71, 74], [65, 69, 72], [72, 76, 79], [74, 77, 81], [79, 83, 86]][i], .8); [0, 1, 2].forEach(j => blip(t + 1.4 + j * .15, 84 + j * 3, .5, -.3 + j * .3)); });
Hh.nodes.forEach((t, i) => blip(t, 81 + i * 4, .7, -.4 + i * .4)); Hh.hops.forEach((t, i) => blip(t, [84, 88, 84, 93][i], .8));
swell(S.end, AM, 1.2, 1); impact(S.end, 1.1); stab(S.end, [57, 60, 64, 69], 1);
glitch(Hh.glitch, .5, .7); softImpact(Hh.endDot, .9); put(Hh.endDot, 1.2, tt => .25 * Math.sin(TAU * 1760 * tt) * Math.exp(-tt * 4), { gain: .6, rev: .8, bus: 'mus' });

// ---------- mix: sidechain music bus, reverb, glue, master ----------
function verb(inp, spread) {
  const combs = [1116, 1188, 1277, 1356, 1422, 1491].map(d => ({ b: new Float32Array(d + spread), i: 0, s: 0 })), aps = [556, 441, 341].map(d => ({ b: new Float32Array(d + spread), i: 0 }));
  const o = new Float32Array(N);
  for (let n = 0; n < N; n++) { const x = inp[n] * .02; let y = 0; for (const c of combs) { const v = c.b[c.i]; c.s = v * .7 + c.s * .3; c.b[c.i] = x + c.s * .82; c.i = (c.i + 1) % c.b.length; y += v; } for (const a of aps) { const v = a.b[a.i]; a.b[a.i] = y + v * .5; a.i = (a.i + 1) % a.b.length; y = v - y; } o[n] = y; }
  return o;
}
const wl = verb(sendL, 0), wr = verb(sendR, 23);
const oL = new Float32Array(N), oR = new Float32Array(N); let peak = 0;
for (let n = 0; n < N; n++) {
  let l = L[n] + musL[n] * duck[n] + wl[n] * 4, r = R[n] + musR[n] * duck[n] + wr[n] * 4;
  l = Math.tanh(l * 1.2) / 1.2 * 1.1; r = Math.tanh(r * 1.2) / 1.2 * 1.1;
  oL[n] = l; oR[n] = r; peak = Math.max(peak, Math.abs(l), Math.abs(r));
}
const g = .9 / peak, fadeOut = Math.floor((C.dur - .2) * SR);
const buf = Buffer.alloc(44 + N * 4);
buf.write('RIFF', 0); buf.writeUInt32LE(36 + N * 4, 4); buf.write('WAVE', 8); buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(2, 22);
buf.writeUInt32LE(SR, 24); buf.writeUInt32LE(SR * 4, 28); buf.writeUInt16LE(4, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36); buf.writeUInt32LE(N * 4, 40);
for (let n = 0; n < N; n++) {
  const f = Math.min(1, n / (.02 * SR)) * (n > fadeOut ? Math.max(0, 1 - (n - fadeOut) / (1.2 * SR)) : 1);
  buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, oL[n] * g * f)) * 32767), 44 + n * 4);
  buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, oR[n] * g * f)) * 32767), 46 + n * 4);
}
writeFileSync(new URL('./score.wav', import.meta.url), buf);
console.log(`score.wav: ${DUR} s, peak ${peak.toFixed(2)} → normalized`);
