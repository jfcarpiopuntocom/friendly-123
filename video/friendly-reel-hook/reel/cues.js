// reel/cues.js: THE timeline. The page (reel.js) and the score (music/score.mjs) both read it, so every hit in the
// music lands on its frame. 120 BPM: a beat is 0.5 s, a bar 2 s. Put cuts on beats; put chapter changes on bars.
var KCUE = (() => {
  const B = n => +(n * 0.5).toFixed(4);                    // B(n) = time of beat n
  const S = { hook: 0, pain1: 3, pain2: 6, title: 9, flow: 12, offline: 15, comm: 18, price: 21, end: 24 };   // scene starts (s)
  return {
    bpm: 120, fps: 30, dur: 27, B, S,
    // chapters: drive the segmented progress bar in the HUD (names starting with a digit count as sections)
    CH: [['01 PAIN', 0, 9], ['02 FRIENDLY', 9, 15], ['03 WHY', 15, 24], ['END', 24, 27]],
    hits: {
      dot: 1, mark: 2,
      title: 9.1, chips: 10.5,
      cards: [0, 3, 6, 15, 18, 21],
      nodes: [12.1, 12.35, 12.6], hops: [13, 13.5, 14, 14.5],
            name: 24, glitch: 26, endDot: 26.5,
    },
  };
})();
if (typeof module !== 'undefined') module.exports = KCUE;
