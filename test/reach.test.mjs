import assert from 'node:assert/strict';
import { test } from 'node:test';
import { tongueVsCandy } from '../src/reach.js';

const candy = { x: 200, y: 600, r: 50 };

test('counts the tongue points inside the candy, and where they touch it in candy radii', () => {
  const tongue = [{ x: 200, y: 520 }, { x: 200, y: 555 }, { x: 200, y: 575 }];
  assert.deepEqual(tongueVsCandy(tongue, candy), { inside: 2, contact: { x: 0, y: -0.7 }, distance: 0 });
});

test('the contact point is the same on a bigger screen', () => {
  const big = { x: 400, y: 1200, r: 100 };
  const tongue = [{ x: 400, y: 1040 }, { x: 400, y: 1110 }, { x: 400, y: 1150 }];
  assert.deepEqual(tongueVsCandy(tongue, big).contact, { x: 0, y: -0.7 });
});

test('a tongue that stops short has none inside, and says how far it is', () => {
  const tongue = [{ x: 200, y: 500 }, { x: 200, y: 520 }];
  assert.deepEqual(tongueVsCandy(tongue, candy), { inside: 0, contact: null, distance: 30 });
});

test('no tongue: nothing inside, infinitely far', () => {
  assert.deepEqual(tongueVsCandy([], candy), { inside: 0, contact: null, distance: Infinity });
});
