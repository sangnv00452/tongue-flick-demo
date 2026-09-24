// Tells whether the tongue is out, from face landmarks plus the camera frame.
// MediaPipe's face blendshapes have no tongue output (tasks-vision has no `tongueOut`), so the tongue
// is found directly. Licking only needs the tongue to come out over the lips, and colour alone cannot
// separate a tongue from the lips (both are redder than skin). What does separate them:
//   1. Mouth fill (main cue): the lips part and the gap between them fills with a lit, tongue-coloured
//      surface. Closed lips have no gap; an open mouth without the tongue is a dark cavity or white
//      teeth; a tongue resting inside the mouth is in shade. Only a tongue coming out fills the gap.
//   2. Lip drag (second cue): the tracker pushes the lower-lip landmarks onto a protruding tongue.
//      Measured against where the lower lip sat during calibration relative to the chin (lip and chin
//      both ride on the jaw), so opening the mouth leaves it at zero.
// Colour is judged as chromaticity against the cheeks in the same frame, so warm or dim light shifts
// both sides and cancels out. Pure: points are pixel coordinates, pixels come from a sampler callback.

export const LM = Object.freeze({
  forehead: 10,
  nose: 1,
  upperInner: 13,
  lowerInner: 14,
  lowerOuter: 17,
  innerCornerR: 78,
  innerCornerL: 308,
  chin: 152,
  eyeOuterR: 33,
  eyeOuterL: 263,
  cheekR: 205,
  cheekL: 425,
});

const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
const len = (a) => Math.hypot(a.x, a.y);
const dist = (a, b) => len(sub(a, b));
const norm = (a) => {
  const l = len(a) || 1;
  return { x: a.x / l, y: a.y / l };
};

/** Head-local 2D frame: `right` along the eyes, `down` perpendicular toward the chin, `scale` = eye span. */
export function headFrame(pts) {
  const right = norm(sub(pts[LM.eyeOuterL], pts[LM.eyeOuterR]));
  let down = { x: -right.y, y: right.x };
  const toChin = sub(pts[LM.chin], pts[LM.forehead]);
  if (down.x * toChin.x + down.y * toChin.y < 0) down = { x: -down.x, y: -down.y };
  return { right, down, scale: dist(pts[LM.eyeOuterL], pts[LM.eyeOuterR]) };
}

/** Point -> (u, v) in eye spans, relative to `origin`: u along `right`, v along `down`. */
export function toLocal(p, origin, f) {
  const d = sub(p, origin);
  return { u: (d.x * f.right.x + d.y * f.right.y) / f.scale, v: (d.x * f.down.x + d.y * f.down.y) / f.scale };
}

export function fromLocal(u, v, origin, f) {
  return { x: origin.x + (f.right.x * u + f.down.x * v) * f.scale, y: origin.y + (f.right.y * u + f.down.y * v) * f.scale };
}

/** Chromaticity is brightness-independent: r/(r+g+b), g/(r+g+b), plus luma for a darkness floor. */
export function chroma([r, g, b]) {
  const sum = r + g + b || 1;
  return { r: r / sum, g: g / sum, luma: (0.299 * r + 0.587 * g + 0.114 * b) / 255 };
}

export const SIGNAL_DEFAULTS = Object.freeze({
  rows: 4, // samples across the gap between the inner lips
  cols: 7, // samples along it, corner to corner
  inset: 0.15, // keep this share of the gap and the width clear at each edge (lip edges are red too)
  minGap: 0.04, // lips closer than this (in eye spans) are closed: nothing can be in between
  redDelta: 0.02, // tongue must be this much redder than cheek skin (chromaticity)
  greenDelta: -0.01, // and this much less green
  lumaFloor: 0.07, // darker pixels are sensor noise, not colour
  minRelLuma: 0.5, // and at least this bright relative to the cheeks (rules out the mouth cavity)
  minValidRatio: 0.5, // below this share of usable samples the cue reports unknown
});

function averageChroma(samples) {
  const n = samples.length || 1;
  return samples.reduce((acc, c) => ({ r: acc.r + c.r / n, g: acc.g + c.g / n, luma: acc.luma + c.luma / n }), { r: 0, g: 0, luma: 0 });
}

/** Cheek colour in this frame: the reference the mouth is compared against. */
export function skinReference(pts, sample, f) {
  const out = [];
  for (const i of [LM.cheekR, LM.cheekL])
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) out.push(chroma(sample(pts[i].x + a * 0.05 * f.scale, pts[i].y + b * 0.05 * f.scale)));
  return averageChroma(out);
}

const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

export function createTongueTracker(options = {}) {
  const o = { ...SIGNAL_DEFAULTS, ...options };
  let seen = [];
  let cal = null; // lower-lip positions relative to the chin while the tongue is in, in head-local units

  return {
    reset() {
      seen = [];
      cal = null;
    },
    /** Call on calibration frames (tongue in). */
    calibrate(pts) {
      const f = headFrame(pts);
      const chin = pts[LM.chin];
      seen.push({ outer: toLocal(pts[LM.lowerOuter], chin, f).v, inner: toLocal(pts[LM.lowerInner], chin, f).v });
      cal = { outer: median(seen.map((s) => s.outer)), inner: median(seen.map((s) => s.inner)) };
    },
    get calibrated() {
      return cal !== null;
    },
    /**
     * { extension: 0..1 share of the lip gap filled by a lit tongue (0 when the lips are closed, null
     *   when too dark to tell), lipDrag (eye spans), gap (eye spans), samples: [{x, y, kind}],
     *   region: the gap as 4 corner points, lipLine: calibrated inner lower-lip line }.
     * All points are in the sampler's pixel coordinates.
     */
    measure(pts, sample) {
      const f = headFrame(pts);
      const chin = pts[LM.chin];
      const lipDrag = cal ? toLocal(pts[LM.lowerOuter], chin, f).v - cal.outer : 0;

      // The gap: from the live upper inner lip (it rides on the skull) down to the lower inner lip.
      // If the tracker pulls the lower inner lip up onto the tongue, the calibrated position (it moves
      // with the jaw, like the chin) still marks where the lower lip really is.
      const top = toLocal(pts[LM.upperInner], chin, f).v;
      const bottom = Math.max(toLocal(pts[LM.lowerInner], chin, f).v, cal ? cal.inner : -Infinity);
      const cr = toLocal(pts[LM.innerCornerR], chin, f).u;
      const cl = toLocal(pts[LM.innerCornerL], chin, f).u;
      const u0 = Math.min(cr, cl);
      const u1 = Math.max(cr, cl);
      const gap = bottom - top;
      const region = [fromLocal(u0, top, chin, f), fromLocal(u1, top, chin, f), fromLocal(u1, bottom, chin, f), fromLocal(u0, bottom, chin, f)];
      const lipLine = cal ? [fromLocal(u0, cal.inner, chin, f), fromLocal(u1, cal.inner, chin, f)] : [region[3], region[2]];
      const samples = [];

      const skin = skinReference(pts, sample, f);
      if (skin.luma < o.lumaFloor) return { extension: null, lipDrag, gap, samples, region, lipLine };
      if (gap < o.minGap) return { extension: 0, lipDrag, gap, samples, region, lipLine };

      let usable = 0;
      let tongue = 0;
      const span = (a, b, i, n) => a + (b - a) * (o.inset + ((1 - 2 * o.inset) * (i + 0.5)) / n);
      for (let r = 0; r < o.rows; r++) {
        const v = span(top, bottom, r, o.rows);
        for (let c = 0; c < o.cols; c++) {
          const p = fromLocal(span(u0, u1, c, o.cols), v, chin, f);
          const px = chroma(sample(p.x, p.y));
          let kind = 'dark';
          if (px.luma >= o.lumaFloor) {
            usable++;
            const lit = px.luma >= o.minRelLuma * skin.luma;
            const isTongue = lit && px.r - skin.r >= o.redDelta && px.g - skin.g <= o.greenDelta;
            kind = isTongue ? 'tongue' : lit ? 'skin' : 'shadow';
            if (isTongue) tongue++;
          }
          samples.push({ x: p.x, y: p.y, kind });
        }
      }
      // A mouth this open is mostly shadow when empty: too few lit samples is "no tongue", not "unknown".
      const extension = usable / (o.rows * o.cols) < o.minValidRatio ? 0 : tongue / usable;
      return { extension, lipDrag, gap, samples, region, lipLine };
    },
  };
}

/** Yaw and pitch in degrees from MediaPipe's column-major 4x4 facial transformation matrix. */
export function headAngles(matrixData) {
  const fx = matrixData[8];
  const fy = matrixData[9];
  const fz = matrixData[10];
  return { yaw: (Math.atan2(fx, fz) * 180) / Math.PI, pitch: (Math.asin(Math.max(-1, Math.min(1, -fy))) * 180) / Math.PI };
}
