// Turns face landmarks plus the camera frame into the two cues the flick counter reads.
// MediaPipe's face blendshapes have no tongue output (there is no `tongueOut` in tasks-vision), so the
// tongue is measured directly:
//   extension: how far tongue-coloured pixels run past the lower lip toward the chin, measured along
//              the head's own down axis and relative to the cheek colour in the same frame (so warm
//              or dim light shifts both and cancels out);
//   lipChin:   how far the tracked lower lip is pushed toward the chin, relative to the nose-to-chin
//              length (a protruding tongue drags the lower-lip landmarks down; nodding scales both).
// Pure functions: points are pixel coordinates, pixels come from a sampler callback.

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
const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y });
const mul = (a, k) => ({ x: a.x * k, y: a.y * k });
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
  if (down.x * toChin.x + down.y * toChin.y < 0) down = mul(down, -1);
  return { right, down, scale: dist(pts[LM.eyeOuterL], pts[LM.eyeOuterR]) };
}

/** Chromaticity is brightness-independent: r/(r+g+b), g/(r+g+b), plus luma for a darkness floor. */
export function chroma([r, g, b]) {
  const sum = r + g + b || 1;
  return { r: r / sum, g: g / sum, luma: (0.299 * r + 0.587 * g + 0.114 * b) / 255 };
}

export const SIGNAL_DEFAULTS = Object.freeze({
  steps: 24, // samples along the down axis from the lower inner lip toward the chin
  bandPoints: 5, // samples across each step, averaged
  bandSpacing: 0.06, // across-step spacing, in eye spans
  reachOfChin: 0.9, // how far toward the chin to look
  redDelta: 0.03, // tongue must be this much redder than cheek skin (chromaticity)
  greenDelta: -0.015, // and this much less green
  lumaFloor: 0.07, // darker pixels are sensor noise, not colour
  minValidRatio: 0.5, // below this share of usable pixels the extension cue is reported as unknown
});

function average(samples) {
  const n = samples.length || 1;
  return samples.reduce((acc, c) => ({ r: acc.r + c.r / n, g: acc.g + c.g / n, luma: acc.luma + c.luma / n }), { r: 0, g: 0, luma: 0 });
}

function patch(sample, center, frame, radius) {
  const out = [];
  for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) out.push(chroma(sample(center.x + i * radius * frame.scale, center.y + j * radius * frame.scale)));
  return out;
}

/** Cheek colour in this frame: the reference the mouth region is compared against. */
export function skinReference(pts, sample, frame) {
  return average([...patch(sample, pts[LM.cheekR], frame, 0.05), ...patch(sample, pts[LM.cheekL], frame, 0.05)]);
}

/**
 * 0 (tongue in) .. 1 (tongue reaches the chin), or null when the light is too poor to tell.
 * `sample(x, y)` returns [r, g, b] 0..255 for a pixel coordinate.
 */
export function extensionCue(pts, sample, opts = {}) {
  const o = { ...SIGNAL_DEFAULTS, ...opts };
  const frame = headFrame(pts);
  const skin = skinReference(pts, sample, frame);
  if (skin.luma < o.lumaFloor) return null;

  const start = pts[LM.lowerInner];
  const reach = dist(start, pts[LM.chin]) * o.reachOfChin;
  if (reach <= 0) return null;
  const lipEnd = Math.min(0.95, dist(start, pts[LM.lowerOuter]) / reach);

  let run = 0;
  let misses = 0;
  let usable = 0;
  for (let i = 0; i < o.steps; i++) {
    const at = add(start, mul(frame.down, (reach * (i + 0.5)) / o.steps));
    const band = [];
    for (let k = 0; k < o.bandPoints; k++) {
      const offset = (k - (o.bandPoints - 1) / 2) * o.bandSpacing * frame.scale;
      const c = chroma(sample(at.x + frame.right.x * offset, at.y + frame.right.y * offset));
      if (c.luma >= o.lumaFloor) band.push(c);
    }
    if (band.length) usable++;
    const c = average(band);
    const tongueLike = band.length > 0 && c.r - skin.r >= o.redDelta && c.g - skin.g <= o.greenDelta;
    if (misses < 2) {
      if (tongueLike) {
        run = i + 1;
        misses = 0;
      } else misses++;
    }
  }
  if (usable / o.steps < o.minValidRatio) return null;
  const reached = run / o.steps;
  return Math.max(0, Math.min(1, (reached - lipEnd) / (1 - lipEnd)));
}

/** Larger when the lower lip is pushed toward the chin; unit-free, so head distance and nodding cancel. */
export function lipChinCue(pts) {
  const noseChin = dist(pts[LM.nose], pts[LM.chin]);
  return noseChin > 0 ? -dist(pts[LM.lowerOuter], pts[LM.chin]) / noseChin : null;
}

/** Yaw and pitch in degrees from MediaPipe's column-major 4x4 facial transformation matrix. */
export function headAngles(matrixData) {
  const fx = matrixData[8];
  const fy = matrixData[9];
  const fz = matrixData[10];
  return { yaw: (Math.atan2(fx, fz) * 180) / Math.PI, pitch: (Math.asin(Math.max(-1, Math.min(1, -fy))) * 180) / Math.PI };
}
