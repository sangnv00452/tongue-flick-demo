// Counts licks. Two ways to lick, both natural:
// 1. Flick: the tongue coming out of the mouth (from in) and touching the candy while it is out.
// 2. Stroke: the tongue moving across the candy while touching it.
// Pure and deterministic, so every rule below is unit-tested.
//
// Inputs per frame: how many tongue-shape points are seen (tongue out or in), how many of them lie
// inside the candy (touching), and where on the candy they are (`contact`, in candy radii from its
// centre, so a stroke is the same length on any screen size).
// - Out/in follows the tongue shape itself: out = at least `minTongue` points on two frames in a row;
//   in = fewer than that for `inMs` in a row, so the shape flickering for a frame or two while the
//   tongue is out does not split one lick into two.
// - A flick scores at most once per time the tongue is out, the first time it touches the candy.
// - A stroke scores when the contact point has moved `strokeLen` across the candy. One long sweep in
//   one direction is one stroke; wiping back and forth scores each way. Holding the tongue still on
//   the candy scores nothing more.
// - Just after the tongue lands on the candy (`settleMs`) the contact point shifts while the tongue
//   pushes in; that is part of landing, not a stroke.
// - Licks are at least `minGapMs` apart, so tracking jitter can never run up the score.
// - A tongue already out when counting starts does not score a flick: it has to go in and come out
//   again. (Counting starts in the "out" state without the right to flick.) Stroking still scores.
// - Touching needs at least `minInside` points inside the candy on two frames in a row, so a stray
//   point is not a touch.

export const LICK = Object.freeze({
  minTongue: 3,
  minInside: 3,
  confirmMs: 30, // "out" and "touching" must still hold on the next frame (at 30 fps)
  inMs: 90, // longer than a 2-frame dropout of the tongue shape (66 ms at 30 fps), shorter than a real lick gap
  strokeLen: 0.4, // candy radii the contact point moves for one stroke
  settleMs: 150, // after landing on the candy, before strokes are measured
  smoothMs: 60, // time constant smoothing the contact point against tracking jitter
  minGapMs: 200, // at most 5 licks a second
});

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

export function createLickCounter(options = {}) {
  const o = { ...LICK, ...options };
  let s;

  function reset() {
    s = {
      out: true, canScore: false, scored: false, count: 0, outSince: null, inSince: null,
      touchSince: null, touching: false, lastLickAt: -Infinity,
      // stroke: smoothed contact point, where the current stroke started, its direction, when the
      // tongue landed on the candy and when it last touched it
      pos: null, anchor: null, dir: null, landedAt: null, lastTouchAt: null, lastT: null,
    };
  }
  reset();

  function score(t) {
    s.count += 1;
    s.lastLickAt = t;
    return true;
  }

  /** One frame. Returns { out, touching, count, lick } where `lick` is true on the frame a lick scores. */
  function update({ t, tonguePoints, pointsInside, contact = null }) {
    let lick = false;
    const seen = tonguePoints >= o.minTongue;
    const dt = s.lastT === null ? 0 : t - s.lastT;
    s.lastT = t;

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
        s.canScore = true; // came out from in: this one may flick
        s.scored = false;
      }
    } else s.outSince = null;

    // Confirm the touch from the first frame the points are inside, in parallel with confirming "out",
    // so the two confirmations do not stack up (at 10 fps that would need three frames of tongue).
    if (pointsInside >= o.minInside) s.touchSince ??= t;
    else s.touchSince = null;
    s.touching = s.out && s.touchSince !== null && t - s.touchSince >= o.confirmMs;
    const canLick = t - s.lastLickAt >= o.minGapMs;

    if (s.touching && s.canScore && !s.scored && canLick) {
      s.scored = true;
      lick = score(t);
    }

    // Strokes. A touch that drops for a frame or two keeps its stroke; a longer gap is a new landing.
    if (s.touching && contact) {
      if (s.lastTouchAt === null || t - s.lastTouchAt > o.inMs) {
        s.pos = { ...contact };
        s.anchor = null;
        s.dir = null;
        s.landedAt = t;
      } else {
        const k = dt > 0 ? 1 - Math.exp(-dt / o.smoothMs) : 1;
        s.pos = { x: s.pos.x + (contact.x - s.pos.x) * k, y: s.pos.y + (contact.y - s.pos.y) * k };
      }
      s.lastTouchAt = t;
      if (t - s.landedAt < o.settleMs) s.anchor = { ...s.pos }; // still landing: follow it
      else {
        s.anchor ??= { ...s.pos };
        const d = { x: s.pos.x - s.anchor.x, y: s.pos.y - s.anchor.y };
        if (s.dir && d.x * s.dir.x + d.y * s.dir.y > 0) s.anchor = { ...s.pos }; // same sweep going on
        else if (dist(s.pos, s.anchor) >= o.strokeLen && canLick && !lick) {
          const len = dist(s.pos, s.anchor);
          s.dir = { x: d.x / len, y: d.y / len };
          s.anchor = { ...s.pos };
          lick = score(t);
        }
      }
    }
    return { out: s.out, touching: s.touching, count: s.count, lick };
  }

  return { update, reset, snapshot: () => ({ out: s.out, touching: s.touching, count: s.count }), config: o };
}
