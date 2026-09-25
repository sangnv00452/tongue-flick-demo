import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createLickCounter } from '../src/lick-counter.js';

const FRAME = 1000 / 30;

/**
 * Runs `ms` of frames. `tongue(t)` = tongue points seen, `inside(t)` = of those, points inside the
 * candy (defaults to all of them: the mouth is at the candy).
 */
function run(c, ms, tongue, { inside = tongue, start = 0, frame = FRAME } = {}) {
  let last;
  for (let t = start; t < start + ms; t += frame) last = c.update({ t, tonguePoints: tongue(t), pointsInside: inside(t) });
  return last;
}

/** The tongue out for `outMs`, in for `inMs`, `n` times, starting at `from`. */
const cycles = (from, n, outMs, inMs, points = 20) => (t) => {
  const k = Math.floor((t - from) / (outMs + inMs));
  return t >= from && k < n && (t - from) % (outMs + inMs) < outMs ? points : 0;
};

test('each time the tongue comes out and touches the candy is one lick', () => {
  const c = createLickCounter();
  assert.equal(run(c, 4000, cycles(300, 5, 250, 400)).count, 5);
});

test('out and in with the mouth right at the candy counts every time (the tongue never has to leave the candy circle)', () => {
  const c = createLickCounter();
  // The lip gap itself sits inside the candy: whenever the tongue is out, it is "inside".
  assert.equal(run(c, 3000, cycles(300, 6, 150, 250)).count, 6);
});

test('holding the tongue on the candy scores once', () => {
  const c = createLickCounter();
  const s = run(c, 5000, (t) => (t > 300 ? 20 : 0));
  assert.equal(s.count, 1);
  assert.equal(s.touching, true);
});

test('sliding the tongue off and back onto the candy without pulling it in is still one lick', () => {
  const c = createLickCounter();
  const tongue = (t) => (t > 300 ? 20 : 0);
  const inside = (t) => (t > 300 && Math.floor(t / 300) % 2 === 0 ? 20 : 0);
  assert.equal(run(c, 4000, tongue, { inside }).count, 1);
});

test('a tongue already out when counting starts does not score until it goes in and comes out again', () => {
  const c = createLickCounter();
  assert.equal(run(c, 2000, () => 20).count, 0);
  assert.equal(run(c, 1000, (t) => (t < 2300 ? 0 : 20), { start: 2000 }).count, 1);
});

test('the tongue out but not reaching the candy does not score', () => {
  const c = createLickCounter();
  assert.equal(run(c, 3000, cycles(300, 4, 250, 400), { inside: () => 0 }).count, 0);
});

test('the tongue shape flickering out for a frame or two does not split one lick', () => {
  const c = createLickCounter();
  const s = run(c, 3000, (t) => (t < 300 ? 0 : (t - 300) % 400 < 2 * FRAME ? 0 : 20));
  assert.equal(s.count, 1);
});

test('a stray point or a one-frame blip is not a lick', () => {
  const c = createLickCounter();
  run(c, 500, () => 0);
  assert.equal(run(c, 1000, () => 2, { start: 500 }).count, 0, 'below minTongue');
  assert.equal(run(c, 1000, (t) => (Math.abs(t - 2000) < FRAME / 2 ? 20 : 0), { start: 1500 }).count, 0, 'one frame');
});

test('fast licking still counts every lick (4 per second)', () => {
  const c = createLickCounter();
  assert.equal(run(c, 3000, cycles(300, 10, 100, 160)).count, 10);
});

test('a slow phone (10 fps) still counts every lick', () => {
  const c = createLickCounter();
  assert.equal(run(c, 4000, cycles(300, 6, 250, 300), { frame: 100 }).count, 6);
});

test('reset forgets the round, and a tongue out at the new start does not score', () => {
  const c = createLickCounter();
  run(c, 3000, cycles(300, 4, 250, 400));
  c.reset();
  assert.equal(run(c, 1000, () => 20).count, 0);
});
