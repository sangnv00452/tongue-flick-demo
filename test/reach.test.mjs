import assert from 'node:assert/strict';
import { test } from 'node:test';
import { tongueVsCandy } from '../src/reach.js';

const candy = { x: 200, y: 600, r: 50 };

test('counts the tongue points inside the candy', () => {
  const tongue = [{ x: 200, y: 520 }, { x: 200, y: 555 }, { x: 200, y: 570 }];
  assert.deepEqual(tongueVsCandy(tongue, candy), { inside: 2, distance: 0 });
});

test('a tongue that stops short has none inside, and says how far it is', () => {
  const tongue = [{ x: 200, y: 500 }, { x: 200, y: 520 }];
  assert.deepEqual(tongueVsCandy(tongue, candy), { inside: 0, distance: 30 });
});

test('no tongue: nothing inside, infinitely far', () => {
  assert.deepEqual(tongueVsCandy([], candy), { inside: 0, distance: Infinity });
});
