// Counts licks. One lick = the tongue coming out of the mouth (from in) and touching the candy while it
// is out. Pure and deterministic, so every rule below is unit-tested.
//
// Inputs per frame: how many tongue-shape points are seen (tongue out or in) and how many of them lie
// inside the candy (touching).
// - Out/in follows the tongue shape itself: out = at least `minTongue` points on two frames in a row;
//   in = fewer than that for `inMs` in a row, so the shape flickering for a frame or two while the
//   tongue is out does not split one lick into two.
// - Each time the tongue is out it scores at most once, the first time it touches the candy. Holding
//   it on the candy, or sliding it around on it without pulling it back in, is still one lick.
// - A tongue already out when counting starts does not score: it has to go in and come out again.
//   (Counting starts in the "out" state without the right to score.)
// - Touching needs at least `minInside` points inside the candy on two frames in a row, so a stray
//   point is not a touch.

export const LICK = Object.freeze({
  minTongue: 3,
  minInside: 3,
  confirmMs: 30, // "out" and "touching" must still hold on the next frame (at 30 fps)
  inMs: 90, // longer than a 2-frame dropout of the tongue shape (66 ms at 30 fps), shorter than a real lick gap
});

export function createLickCounter(options = {}) {
  const o = { ...LICK, ...options };
  let s;

  function reset() {
    s = { out: true, canScore: false, scored: false, count: 0, outSince: null, inSince: null, touchSince: null, touching: false };
  }
  reset();

  /** One frame. Returns { out, touching, count, lick } where `lick` is true on the frame a lick scores. */
  function update({ t, tonguePoints, pointsInside }) {
    let lick = false;
    const seen = tonguePoints >= o.minTongue;

    if (s.out) {
      if (seen) s.inSince = null;
      else {
        s.inSince ??= t;
        if (t - s.inSince >= o.inMs) {
          s.out = false;
          s.inSince = null;
          s.outSince = null;
        }
      }
    } else if (seen) {
      s.outSince ??= t;
      if (t - s.outSince >= o.confirmMs) {
        s.out = true;
        s.outSince = null;
        s.canScore = true; // came out from in: this one may score
        s.scored = false;
      }
    } else s.outSince = null;

    // Confirm the touch from the first frame the points are inside, in parallel with confirming "out",
    // so the two confirmations do not stack up (at 10 fps that would need three frames of tongue).
    if (pointsInside >= o.minInside) s.touchSince ??= t;
    else s.touchSince = null;
    s.touching = s.out && s.touchSince !== null && t - s.touchSince >= o.confirmMs;

    if (s.touching && s.canScore && !s.scored) {
      s.scored = true;
      s.count += 1;
      lick = true;
    }
    return { out: s.out, touching: s.touching, count: s.count, lick };
  }

  return { update, reset, snapshot: () => ({ out: s.out, touching: s.touching, count: s.count }), config: o };
}
