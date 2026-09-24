// Measures how far the tongue sticks out, from face landmarks plus the camera frame.
// MediaPipe's face blendshapes have no tongue output (tasks-vision has no `tongueOut`), so the tongue
// is found in pixels:
//   - During calibration (tongue in) we record where the lower lip sits relative to the chin, in the
//     head's own frame. Lip and chin both ride on the jaw, so that offset holds when the mouth opens.
//   - Each frame we look at the chin skin just below that expected lip line. Opening the mouth moves
//     the region with the jaw; a tongue resting inside the mouth is above it; only a tongue that sticks
//     out over the lower lip covers it. (The tracked lower-lip landmarks themselves are not trusted
//     while the tongue is out: the tracker drags them onto the tongue.)
//   - Colour is judged as chromaticity against the cheeks in the same frame, so warm or dim light
//     shifts both sides and cancels out; pixels below a darkness floor are ignored.
// Pure: points are pixel coordinates, pixels come from a sampler callback.

export const LM = Object.freeze({
  forehead: 10,
  nose: 1,
  upperInner: 13,
  lowerInner: 14,
  lowerOuter: 17,
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
  rows: 6, // search grid below the expected lip line
  cols: 7,
  halfWidth: 0.22, // in eye spans, each side of the midline
  topMargin: 0.04, // start this far below the expected lip line
  depth: 0.6, // search this share of the lip-to-chin distance
  rowCovered: 0.4, // a row is "tongue" when this share of its samples look like tongue
  redDelta: 0.03, // tongue must be this much redder than cheek skin (chromaticity)
  greenDelta: -0.015, // and this much less green
  lumaFloor: 0.07, // darker pixels are sensor noise, not colour
  minValidRatio: 0.5, // below this share of usable samples the cue reports unknown
});

function averageChroma(samples) {
  const n = samples.length || 1;
  return samples.reduce((acc, c) => ({ r: acc.r + c.r / n, g: acc.g + c.g / n, luma: acc.luma + c.luma / n }), { r: 0, g: 0, luma: 0 });
}

/** Cheek colour in this frame: the reference the chin region is compared against. */
export function skinReference(pts, sample, f) {
  const out = [];
  for (const i of [LM.cheekR, LM.cheekL])
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) out.push(chroma(sample(pts[i].x + a * 0.05 * f.scale, pts[i].y + b * 0.05 * f.scale)));
  return averageChroma(out);
}

export function createTongueTracker(options = {}) {
  const o = { ...SIGNAL_DEFAULTS, ...options };
  let offsets = [];
  let lip = null; // calibrated lower-lip position relative to the chin, in head-local units

  return {
    reset() {
      offsets = [];
      lip = null;
    },
    /** Call on calibration frames (tongue in). */
    calibrate(pts) {
      const f = headFrame(pts);
      offsets.push(toLocal(pts[LM.lowerOuter], pts[LM.chin], f));
      const us = offsets.map((p) => p.u).sort((a, b) => a - b);
      const vs = offsets.map((p) => p.v).sort((a, b) => a - b);
      const mid = Math.floor(offsets.length / 2);
      lip = { u: us[mid], v: vs[mid] };
    },
    get calibrated() {
      return lip !== null;
    },
    /**
     * { extension: 0..1 or null when too dark, rowsCovered, samples: [{x, y, kind}] for drawing,
     *   region: 4 corner points, lipLine: [a, b] } — all points in the sampler's pixel coordinates.
     */
    measure(pts, sample) {
      const f = headFrame(pts);
      const chin = pts[LM.chin];
      const lipAt = lip ?? toLocal(pts[LM.lowerOuter], chin, f);
      const top = lipAt.v + o.topMargin;
      const bottom = lipAt.v + Math.abs(lipAt.v) * o.depth;
      const skin = skinReference(pts, sample, f);
      const samples = [];
      const region = [fromLocal(lipAt.u - o.halfWidth, top, chin, f), fromLocal(lipAt.u + o.halfWidth, top, chin, f), fromLocal(lipAt.u + o.halfWidth, bottom, chin, f), fromLocal(lipAt.u - o.halfWidth, bottom, chin, f)];
      const lipLine = [fromLocal(lipAt.u - o.halfWidth, lipAt.v, chin, f), fromLocal(lipAt.u + o.halfWidth, lipAt.v, chin, f)];
      if (skin.luma < o.lumaFloor) return { extension: null, rowsCovered: 0, samples, region, lipLine };

      let usable = 0;
      let rowsCovered = 0;
      let stillHanging = true; // a sticking-out tongue hangs from the lip: count covered rows from the top only
      for (let r = 0; r < o.rows; r++) {
        const v = top + ((bottom - top) * (r + 0.5)) / o.rows;
        let tongueInRow = 0;
        let usableInRow = 0;
        for (let c = 0; c < o.cols; c++) {
          const u = lipAt.u - o.halfWidth + (2 * o.halfWidth * (c + 0.5)) / o.cols;
          const p = fromLocal(u, v, chin, f);
          const px = chroma(sample(p.x, p.y));
          let kind = 'dark';
          if (px.luma >= o.lumaFloor) {
            usableInRow++;
            const isTongue = px.r - skin.r >= o.redDelta && px.g - skin.g <= o.greenDelta;
            kind = isTongue ? 'tongue' : 'skin';
            if (isTongue) tongueInRow++;
          }
          samples.push({ x: p.x, y: p.y, kind });
        }
        usable += usableInRow;
        if (stillHanging && usableInRow && tongueInRow / usableInRow >= o.rowCovered) rowsCovered++;
        else stillHanging = false;
      }
      const extension = usable / (o.rows * o.cols) < o.minValidRatio ? null : rowsCovered / o.rows;
      return { extension, rowsCovered, samples, region, lipLine };
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
