import assert from 'node:assert/strict';
import { test } from 'node:test';
import { extensionCue, headAngles, headFrame, lipChinCue, LM } from '../src/tongue-signal.js';

// A frontal face in pixel coordinates: eyes 100 px apart, chin 75 px below the lower inner lip.
function face({ lipPush = 0, rotateDeg = 0 } = {}) {
  const base = {
    [LM.eyeOuterR]: [100, 100],
    [LM.eyeOuterL]: [200, 100],
    [LM.forehead]: [150, 40],
    [LM.nose]: [150, 160],
    [LM.upperInner]: [150, 200],
    [LM.lowerInner]: [150, 205],
    [LM.lowerOuter]: [150, 220 + lipPush],
    [LM.chin]: [150, 280],
    [LM.cheekR]: [110, 180],
    [LM.cheekL]: [190, 180],
  };
  const a = (rotateDeg * Math.PI) / 180;
  const pts = Array.from({ length: 478 }, () => ({ x: 0, y: 0 }));
  for (const [i, [x, y]] of Object.entries(base)) {
    const dx = x - 150;
    const dy = y - 160;
    pts[Number(i)] = { x: 150 + dx * Math.cos(a) - dy * Math.sin(a), y: 160 + dx * Math.sin(a) + dy * Math.cos(a) };
  }
  return pts;
}

/** Skin everywhere, red lips, and a tongue down to `tongueTo` px (face frame); `light` scales channels. */
function image({ tongueTo = 0, light = [1, 1, 1], rotateDeg = 0 } = {}) {
  const a = (-rotateDeg * Math.PI) / 180;
  return (x, y) => {
    // Undo the face rotation so the painted regions follow the face.
    const dx = x - 150;
    const dy = y - 160;
    const fx = 150 + dx * Math.cos(a) - dy * Math.sin(a);
    const fy = 160 + dx * Math.sin(a) + dy * Math.cos(a);
    let c = [200, 150, 130];
    if (fy >= 203 && fy <= 222 && Math.abs(fx - 150) < 30) c = [190, 90, 90];
    if (tongueTo && fy >= 203 && fy <= tongueTo && Math.abs(fx - 150) < 20) c = [205, 95, 105];
    return c.map((v, i) => Math.min(255, v * light[i]));
  };
}

test('head frame follows the eyes and points down toward the chin', () => {
  const f = headFrame(face());
  assert.ok(Math.abs(f.right.x - 1) < 1e-9 && Math.abs(f.down.y - 1) < 1e-9);
  assert.equal(f.scale, 100);
});

test('tongue in reads near zero, tongue out past the lip reads high', () => {
  assert.ok(extensionCue(face(), image()) < 0.1);
  assert.ok(extensionCue(face(), image({ tongueTo: 262 })) > 0.6);
});

test('warm light and dim light keep the same verdict (colour is judged against the cheeks)', () => {
  const warm = [1.25, 1, 0.8];
  const dim = [0.35, 0.35, 0.35];
  for (const light of [warm, dim]) {
    assert.ok(extensionCue(face(), image({ light })) < 0.1, `in, light ${light}`);
    assert.ok(extensionCue(face(), image({ tongueTo: 262, light })) > 0.6, `out, light ${light}`);
  }
});

test('too dark to judge colour reports unknown instead of guessing', () => {
  assert.equal(extensionCue(face(), image({ tongueTo: 262, light: [0.1, 0.1, 0.1] })), null);
});

test('a tilted head gives the same reading (measured along the head, not the screen)', () => {
  const tilted = extensionCue(face({ rotateDeg: 25 }), image({ tongueTo: 262, rotateDeg: 25 }));
  const straight = extensionCue(face(), image({ tongueTo: 262 }));
  assert.ok(Math.abs(tilted - straight) < 0.15, `tilted ${tilted} vs straight ${straight}`);
});

test('lip pushed toward the chin raises the lip-chin cue', () => {
  assert.ok(lipChinCue(face({ lipPush: 25 })) > lipChinCue(face()));
});

test('head angles come out of the transformation matrix', () => {
  const yaw30 = [Math.cos(Math.PI / 6), 0, -Math.sin(Math.PI / 6), 0, 0, 1, 0, 0, Math.sin(Math.PI / 6), 0, Math.cos(Math.PI / 6), 0, 0, 0, 0, 1];
  assert.ok(Math.abs(headAngles(yaw30).yaw - 30) < 1e-6);
});
