// Counts tongue flicks from per-frame cues. Pure: no DOM, no camera, fully deterministic, so the
// counting rules can be tested with synthetic signals.
//
// Rules (the answer to "count fast flicks without counting a held tongue or head movement"):
// - Calibrate a per-person, per-lighting baseline for each cue while the tongue is in.
// - Work in z-scores against that baseline, so dim or warm light only changes the baseline, not the rule.
// - Peak/trough hysteresis: a lick is a rise of RISE from the lowest point since the last lick (and
//   above ON); it ends at a fall of DROP from its peak (or below OFF). Rapid licking rarely pulls the
//   tongue all the way back in, so a partial retraction must be enough, while noise smaller than
//   RISE/DROP around any level cannot produce a burst of counts.
// - Count on the rising edge only: a held tongue stays "out" and scores once.
// - Refractory window: two counts closer than a real flick can repeat are one flick.
// - Motion gate: while the head turns faster than a person can flick deliberately, freeze transitions.

export const DEFAULTS = Object.freeze({
  calibrationMs: 1500,
  onZ: 3, // a lick needs the signal at least this many baseline deviations out...
  riseZ: 3, // ...and at least this far above the lowest point since the last lick
  offZ: 2, // leave "out" at or below this
  dropZ: 2.5, // or once the signal falls this far below the lick's peak: a partial retraction is enough
  strongZ: 7, // a single frame this far out counts without waiting for confirmation
  confirmFrames: 2, // otherwise it must hold above ON for this many frames (rejects 1-frame spikes)
  slowFrameMs: 70, // ...or a single frame when frames are this far apart (low fps: one frame is a long look)
  refractoryMs: 110,
  // The cues are measured in the mouth's own frame, so ordinary head movement while licking does not
  // fake a lick; only a violent shake (tracking smears) pauses counting.
  maxAngularDegPerSec: 250,
  baselineTauMs: 8000, // slow baseline drift while the tongue is in (lighting changes during play)
  // extension is the filled share of the lip gap (ON at +0.15); lipDrag is in eye spans (ON at +0.075).
  stdFloor: Object.freeze({ extension: 0.05, lipDrag: 0.025 }),
});

const CUES = ['extension', 'lipDrag'];

function createStat() {
  return { n: 0, mean: 0, m2: 0 };
}

function push(stat, x) {
  stat.n += 1;
  const d = x - stat.mean;
  stat.mean += d / stat.n;
  stat.m2 += d * (x - stat.mean);
}

function std(stat, floor) {
  return Math.max(stat.n > 1 ? Math.sqrt(stat.m2 / (stat.n - 1)) : 0, floor);
}

export function createFlickCounter(options = {}) {
  const cfg = { ...DEFAULTS, ...options, stdFloor: { ...DEFAULTS.stdFloor, ...(options.stdFloor ?? {}) } };
  let s;

  function reset() {
    s = {
      state: 'waiting', // waiting (no face yet) | calibrating | in | out
      count: 0,
      calibratedFor: 0,
      lastT: null,
      lastCountT: -Infinity,
      pending: 0,
      signal: 0,
      gated: false,
      trough: 0, // lowest signal since the last lick ended
      peak: 0, // highest signal during the current lick
      stats: { extension: createStat(), lipDrag: createStat() },
    };
  }
  reset();

  /** z-score of the strongest available cue; cues oriented so that larger means "more tongue". */
  function zOf(cues) {
    let z = -Infinity;
    for (const key of CUES) {
      const x = cues[key];
      if (x === null || x === undefined || Number.isNaN(x)) continue;
      const st = s.stats[key];
      z = Math.max(z, (x - st.mean) / std(st, cfg.stdFloor[key]));
    }
    return Number.isFinite(z) ? z : 0;
  }

  function driftBaseline(cues, dt) {
    const a = Math.min(1, dt / cfg.baselineTauMs);
    for (const key of CUES) {
      const x = cues[key];
      if (x === null || x === undefined || Number.isNaN(x)) continue;
      s.stats[key].mean += a * (x - s.stats[key].mean);
    }
  }

  /**
   * One frame. `t` in ms, `cues` = { extension, lipDrag } (null or missing when unmeasurable),
   * `angularVel` in deg/s, `faceFound` false when the tracker lost the face.
   * Returns { state, count, signal, gated, flick } where `flick` is true on the frame a flick is counted.
   */
  function update({ t, cues, angularVel = 0, faceFound = true }) {
    const dt = s.lastT === null ? 0 : Math.max(0, t - s.lastT);
    s.lastT = t;
    let flick = false;

    if (!faceFound) {
      // Never count without a face; a lost track must not look like a flick when it comes back.
      s.pending = 0;
      return snapshot(flick);
    }

    if (s.state === 'waiting') s.state = 'calibrating';

    if (s.state === 'calibrating') {
      for (const key of CUES) {
        const x = cues[key];
        if (x !== null && x !== undefined && !Number.isNaN(x)) push(s.stats[key], x);
      }
      s.calibratedFor += dt;
      if (s.calibratedFor >= cfg.calibrationMs) s.state = 'in';
      s.signal = 0;
      return snapshot(flick);
    }

    s.signal = zOf(cues);
    s.gated = angularVel > cfg.maxAngularDegPerSec;
    if (s.gated) {
      s.pending = 0;
      return snapshot(flick);
    }

    if (s.state === 'in') {
      s.trough = Math.min(s.trough, s.signal);
      if (s.signal >= cfg.onZ && s.signal - s.trough >= cfg.riseZ) {
        s.pending += 1;
        const confirmed = s.pending >= cfg.confirmFrames || dt >= cfg.slowFrameMs || s.signal >= cfg.strongZ;
        if (confirmed && t - s.lastCountT >= cfg.refractoryMs) {
          s.state = 'out';
          s.peak = s.signal;
          s.count += 1;
          s.lastCountT = t;
          s.pending = 0;
          flick = true;
        }
      } else {
        s.pending = 0;
        if (s.signal < cfg.offZ) driftBaseline(cues, dt);
      }
    } else if (s.state === 'out') {
      s.peak = Math.max(s.peak, s.signal);
      if (s.signal <= cfg.offZ || s.peak - s.signal >= cfg.dropZ) {
        s.state = 'in';
        s.trough = s.signal;
      }
    }
    return snapshot(flick);
  }

  function snapshot(flick = false) {
    return { state: s.state, count: s.count, signal: s.signal, gated: s.gated, flick, calibration: Math.min(1, s.calibratedFor / cfg.calibrationMs) };
  }

  return { update, reset, snapshot, config: cfg };
}
