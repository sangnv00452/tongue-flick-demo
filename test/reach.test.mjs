import assert from 'node:assert/strict';
import { test } from 'node:test';
import { candyReach } from '../src/reach.js';

const candy = { x: 200, y: 600, r: 50 };

test('a mouth right above the candy is in reach', () => {
  // 80 px above the centre: 30 px past the candy edge, tongue reaches 0.7 x 100 = 70 px.
  assert.deepEqual(candyReach({ x: 200, y: 520 }, 100, candy), { inReach: true, gap: 0 });
});

test('a mouth far above the candy is out of reach, and says by how much', () => {
  const r = candyReach({ x: 200, y: 400 }, 100, candy);
  assert.equal(r.inReach, false);
  assert.equal(r.gap, 200 - 50 - 70);
});

test('reach scales with the face: a face closer to the camera reaches further on screen', () => {
  const mouth = { x: 200, y: 450 };
  assert.equal(candyReach(mouth, 100, candy).inReach, false);
  assert.equal(candyReach(mouth, 150, candy).inReach, true);
});
