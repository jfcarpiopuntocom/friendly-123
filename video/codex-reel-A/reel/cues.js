// reel/cues.js: THE timeline. The page (reel.js) and the score (music/score.mjs) both read it, so every hit in the
// music lands on its frame. 120 BPM: a beat is 0.5 s, a bar 2 s. Put cuts on beats; put chapter changes on bars.
var KCUE = (() => {
  const B = n => +(n * 0.5).toFixed(4);                    // B(n) = time of beat n
  const S = { open: 0, title: 3, price: 6, flow: 9, offline: 12, lang: 15, comm: 18, all: 21, end: 24 };   // scene starts (s)
  return {
    bpm: 120, fps: 30, dur: 27, B, S,
    // chapters: drive the segmented progress bar in the HUD (names starting with a digit count as sections)
    CH: [['OPEN', 0, 3], ['01 SEE', 3, 12], ['02 TRUST', 12, 18], ['03 RUN', 18, 24], ['END', 24, 27]],
    hits: {
      dot: 1, mark: 2,
      title: 3.1, chips: 4.5,
      cards: [6, 12, 15, 18, 21],
      nodes: [9.1, 9.35, 9.6], hops: [10, 10.5, 11, 11.5],
            name: 24, glitch: 26, endDot: 26.5,
    },
  };
})();
if (typeof module !== 'undefined') module.exports = KCUE;
