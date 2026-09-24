import assert from 'node:assert/strict';
import { test } from 'node:test';
import { touchesCandy } from '../src/reach.js';

const candy = { x: 200, y: 600, r: 50 };

test('a tongue whose tip enters the candy circle touches it', () => {
  const tongue = [{ x: 200, y: 520 }, { x: 200, y: 540 }, { x: 200, y: 555 }];
  assert.deepEqual(touchesCandy(tongue, candy), { touching: true, distance: 0 });
});

test('a tongue that stops short does not touch, and says how far it is', () => {
  const tongue = [{ x: 200, y: 500 }, { x: 200, y: 520 }];
  assert.deepEqual(touchesCandy(tongue, candy), { touching: false, distance: 30 });
});

test('a face right at the candy with no tongue out does not touch', () => {
  assert.deepEqual(touchesCandy([], candy), { touching: false, distance: Infinity });
});
