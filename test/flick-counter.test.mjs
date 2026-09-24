import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createFlickCounter } from '../src/flick-counter.js';

const FRAME = 1000 / 30;

/** Deterministic noise so every run sees the same signal. */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Runs frames through a counter. `ext(ms)` gives the extension cue at time ms; noise is added. */
function run(counter, ms, ext, { seed = 1, start = 0, angular = () => 0, face = () => true, frame = FRAME } = {}) {
  const r = rng(seed);
  let last;
  for (let t = start; t < start + ms; t += frame) {
    const noise = (r() - 0.5) * 0.04;
    last = counter.update({ t, cues: { extension: ext(t) + noise }, angularVel: angular(t), faceFound: face(t) });
  }
  return last;
}

function calibrated(seed = 1) {
  const c = createFlickCounter();
  run(c, 1600, () => 0, { seed });
  assert.equal(c.snapshot().state, 'in');
  return c;
}

/** A flick train: tongue out for `outMs` every `periodMs`, starting at `from`. */
const flicks = (from, count, periodMs, outMs, depth = 0.6) => (t) => {
  const k = Math.floor((t - from) / periodMs);
  return t >= from && k < count && (t - from) % periodMs < outMs ? depth : 0;
};

test('calibrates first, and never counts while calibrating', () => {
  const c = createFlickCounter();
  const s = run(c, 1400, (t) => (t > 500 && t < 700 ? 0.8 : 0));
  assert.equal(s.state, 'calibrating');
  assert.equal(s.count, 0);
});

test('counts every flick of a fast train (4 per second, 130 ms out)', () => {
  const c = calibrated();
  const s = run(c, 3000, flicks(1600, 10, 250, 130), { start: 1600 });
  assert.equal(s.count, 10);
});

test('still counts fast flicks when the phone only manages 10 frames a second', () => {
  const c = createFlickCounter();
  run(c, 1600, () => 0, { frame: 100 });
  const s = run(c, 3000, flicks(1600, 8, 300, 150), { start: 1600, frame: 100 });
  assert.equal(s.count, 8);
});

test('counts slow deliberate licks one each', () => {
  const c = calibrated();
  const s = run(c, 6000, flicks(1600, 4, 1400, 600), { start: 1600 });
  assert.equal(s.count, 4);
});

test('rapid licking that only half-retracts the tongue counts every lick', () => {
  const c = calibrated();
  // Out to 0.7, back only to 0.35 (never near the baseline), 6 times.
  const s = run(c, 2160, (t) => (t < 1700 ? 0 : Math.floor((t - 1700) / 180) % 2 === 0 ? 0.7 : 0.35), { start: 1600 });
  assert.equal(s.count, 6);
});

test('a tongue held out with jitter does not burst-count', () => {
  const c = calibrated();
  const s = run(c, 3000, (t) => (t > 1700 ? 0.6 + 0.05 * Math.sin(t / 30) : 0), { start: 1600 });
  assert.equal(s.count, 1);
});

test('a held tongue scores once, however long it is held', () => {
  const c = calibrated();
  const s = run(c, 4000, (t) => (t > 2000 ? 0.7 : 0), { start: 1600 });
  assert.equal(s.count, 1);
  assert.equal(s.state, 'out');
});

test('a signal hovering around the ON threshold does not produce a burst (hysteresis)', () => {
  const c = calibrated();
  // Baseline sd is floored at 0.05, so ON (3 sd) is ~0.15; hover between 0.17 and 0.23 (swings under DROP).
  const s = run(c, 3000, (t) => (t > 2000 ? 0.2 + 0.03 * Math.sin(t / 40) : 0), { start: 1600 });
  assert.ok(s.count <= 1, `expected at most one count, got ${s.count}`);
});

test('a single-frame spike is not a flick', () => {
  const c = calibrated();
  const s = run(c, 2000, (t) => (Math.abs(t - 2500) < FRAME / 2 ? 0.2 : 0), { start: 1600 });
  assert.equal(s.count, 0);
});

test('a violent head shake freezes counting', () => {
  const c = calibrated();
  const s = run(c, 3000, flicks(1600, 6, 400, 150), { start: 1600, angular: () => 300 });
  assert.equal(s.count, 0);
  assert.equal(s.gated, true);
});

test('losing the face never counts, and the returning face does not either', () => {
  const c = calibrated();
  const s = run(c, 2000, () => 0.7, { start: 1600, face: (t) => t > 3000 && false });
  assert.equal(s.count, 0);
  const back = run(c, 600, () => 0, { start: 3600 });
  assert.equal(back.count, 0);
});

test('light slowly drifting during play does not count, and flicks still count afterwards', () => {
  const c = calibrated();
  const drift = (t) => Math.min(0.1, (t - 1600) / 100_000);
  let s = run(c, 10_000, drift, { start: 1600 });
  assert.equal(s.count, 0);
  s = run(c, 2000, (t) => drift(t) + flicks(11_600, 3, 500, 150)(t), { start: 11_600 });
  assert.equal(s.count, 3);
});

test('restart gives an identical run', () => {
  const c = createFlickCounter();
  const script = (t) => (t < 1600 ? 0 : flicks(1600, 5, 300, 140)(t));
  const a = run(c, 4000, script);
  c.reset();
  const b = run(c, 4000, script);
  assert.deepEqual(a, b);
  assert.equal(a.count, 5);
});
