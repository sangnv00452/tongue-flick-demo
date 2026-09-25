import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createTestLog, parseTestLog } from '../src/test-log.js';

test('a recorded round reads back the same, with empty cells as null', () => {
  const log = createTestLog();
  log.begin({ screen: { w: 375, h: 812 } });
  log.frame({ t: 0, face: true, pts: 12, in: 4, cx: 0.123456, cy: -0.5, out: true, touch: false, lick: null });
  log.frame({ t: 33.3333, face: false, lick: 'stroke' });
  const { meta, frames } = parseTestLog(log.text());
  assert.deepEqual(meta, { screen: { w: 375, h: 812 } });
  assert.equal(frames.length, 2);
  assert.deepEqual(frames[0], { t: 0, face: 1, pts: 12, in: 4, cx: 0.12, cy: -0.5, mx: null, my: null, tx: null, ty: null, r: null, fill: null, out: 1, touch: 0, lick: null });
  assert.equal(frames[1].t, 33.33);
  assert.equal(frames[1].lick, 'stroke');
});

test('a log pasted with Windows line ends or text around it still reads', () => {
  const log = createTestLog();
  log.begin({ v: 1 });
  log.frame({ t: 5, pts: 3 });
  const pasted = `here is my log:\r\n${log.text().replace(/\n/g, '\r\n')}`;
  assert.equal(parseTestLog(pasted).frames[0].pts, 3);
});

test('nothing is recorded before a round begins, and a new round starts empty', () => {
  const log = createTestLog();
  log.frame({ t: 1 });
  assert.equal(log.text(), '');
  log.begin({});
  log.frame({ t: 1 });
  log.begin({});
  assert.equal(log.frames, 0);
});
