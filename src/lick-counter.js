// Counts licks. Three ways to lick, all natural:
// 1. Flick: the tongue coming out of the mouth (from in) and touching the candy while it is out.
// 2. Touch: the tongue, still out, coming back onto the candy after being off it for `releaseMs`
//    (for example licking from inside the candy out past its edge, again and again).
// 3. Stroke: the tongue moving across the candy while touching it.
// Pure and deterministic, so every rule below is unit-tested.
//
// Inputs per frame: how many tongue-shape points are seen (tongue out or in), how many of them lie
// inside the candy (touching), and where on the candy they are (`contact`, in candy radii from its
// centre, so a stroke is the same length on any screen size).
// - Out/in follows the tongue shape itself: out = at least `minTongue` points on two frames in a row;
//   in = fewer than that for `inMs` in a row, so the shape flickering for a frame or two while the
//   tongue is out does not split one lick into two.
// - A flick scores at most once per time the tongue is out, the first time it touches the candy.
// - A touch that drops for less than `releaseMs` (the tongue shape flickering at the candy's edge) is
//   the same touch, not a new lick.
// - A stroke scores when the contact point has moved `strokeLen` across the candy. One long sweep in
//   one direction is one stroke; wiping back and forth scores each way. Holding the tongue still on
//   the candy scores nothing more. A sweep straight on from a landing that scored is part of that lick.
// - Just after the tongue lands on the candy (`settleMs`) the contact point shifts while the tongue
//   pushes in; that is part of landing, not a stroke.
// - Licks are at least `minGapMs` apart, so tracking jitter can never run up the score.
// - A tongue already out and on the candy when counting starts does not score: it has to leave the
//   candy or go in first. (Counting starts "out" and "touching" without the right to score.) Stroking
//   still scores.
// - Touching needs at least `minInside` points inside the candy on two frames in a row, so a stray
//   point is not a touch.

export const LICK = Object.freeze({
  minTongue: 3,
  minInside: 3,
  confirmMs: 30, // "out" and "touching" must still hold on the next frame (at 30 fps)
  inMs: 90, // longer than a 2-frame dropout of the tongue shape (66 ms at 30 fps), shorter than a real lick gap
  releaseMs: 150, // off the candy this long before touching it again is a new lick
  strokeLen: 0.4, // candy radii the contact point moves for one stroke
  settleMs: 150, // after landing on the candy, before strokes are measured
  landingSweepMs: 500, // a sweep starting this soon after a scored landing belongs to that lick
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
      // touches: counting starts as if already touching, so a tongue resting on the candy must leave first
      wasTouching: true, offSince: null, pendingTouch: null,
      // stroke: smoothed contact point, where the current stroke started, its direction, when the
      // tongue landed on the candy and when it last touched it
      pos: null, anchor: null, dir: null, landedAt: null, lastTouchAt: null, lastT: null,
    };
  }
  reset();

  function score(t, reason) {
    s.count += 1;
    s.lastLickAt = t;
    return reason;
  }

  /**
   * One frame. Returns { out, touching, count, lick, reason }: `lick` is true on the frame a lick
   * scores, and `reason` says which kind ('flick', 'touch' or 'stroke').
   */
  function update({ t, tonguePoints, pointsInside, contact = null }) {
    let reason = null;
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

    // A touch begins: it scores if the tongue just came out (flick) or had been off the candy long
    // enough (touch). It waits while licks are too close together, for as long as the touch lasts.
    if (s.touching && !s.wasTouching) {
      const offMs = s.offSince === null ? 0 : t - s.offSince;
      s.pendingTouch = s.canScore && !s.scored ? 'flick' : offMs >= o.releaseMs ? 'touch' : null;
    }
    if (s.touching) {
      s.wasTouching = true;
      s.offSince = null;
      if (s.pendingTouch && canLick) {
        if (s.pendingTouch === 'flick') s.scored = true;
        reason = score(t, s.pendingTouch);
        s.pendingTouch = null;
      }
    } else {
      if (s.wasTouching) s.offSince = t;
      s.wasTouching = false;
      s.pendingTouch = null;
    }

    // Strokes. A touch that drops for less than `releaseMs` keeps its stroke; a longer gap is a new landing.
    if (s.touching && contact) {
      if (s.lastTouchAt === null || t - s.lastTouchAt > o.releaseMs) {
        s.pos = { ...contact };
        s.anchor = null;
        s.dir = null;
        s.landedAt = t;
        s.landingScored = false;
      } else {
        const k = dt > 0 ? 1 - Math.exp(-dt / o.smoothMs) : 1;
        s.pos = { x: s.pos.x + (contact.x - s.pos.x) * k, y: s.pos.y + (contact.y - s.pos.y) * k };
      }
      s.lastTouchAt = t;
      if (reason) s.landingScored = true;
      if (t - s.landedAt < o.settleMs) s.anchor = { ...s.pos }; // still landing: follow it
      else {
        s.anchor ??= { ...s.pos };
        const d = { x: s.pos.x - s.anchor.x, y: s.pos.y - s.anchor.y };
        if (s.dir && d.x * s.dir.x + d.y * s.dir.y > 0) s.anchor = { ...s.pos }; // same sweep going on
        else if (dist(s.pos, s.anchor) >= o.strokeLen && canLick && !reason) {
          const len = dist(s.pos, s.anchor);
          // A touch that scored on landing and sweeps straight on is one lick: that first sweep only
          // sets the direction. Sweeping back, or starting to move after resting, is a new stroke.
          const landingSweep = s.dir === null && s.landingScored && t - s.landedAt < o.landingSweepMs;
          s.dir = { x: d.x / len, y: d.y / len };
          s.anchor = { ...s.pos };
          if (!landingSweep) reason = score(t, 'stroke');
        }
      }
    }
    return { out: s.out, touching: s.touching, count: s.count, lick: reason !== null, reason };
  }

  return { update, reset, snapshot: () => ({ out: s.out, touching: s.touching, count: s.count }), config: o };
}
