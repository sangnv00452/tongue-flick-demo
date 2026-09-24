import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createTongueTracker, headAngles, headFrame, LM, toLocal } from '../src/tongue-signal.js';

// A frontal face in pixel coordinates: eyes 100 px apart, lower lip 60 px above the chin.
// `jaw` opens the mouth: lower lip and chin move down together; `lipOnTongue` is how far the tracker
// drags the lower-lip landmark down when the tongue is out.
function face({ jaw = 0, lipOnTongue = 0, rotateDeg = 0 } = {}) {
  const base = {
    [LM.eyeOuterR]: [100, 100],
    [LM.eyeOuterL]: [200, 100],
    [LM.forehead]: [150, 40],
    [LM.nose]: [150, 160],
    [LM.upperInner]: [150, 200],
    [LM.lowerInner]: [150, 205 + jaw],
    [LM.lowerOuter]: [150, 220 + jaw + lipOnTongue],
    [LM.chin]: [150, 280 + jaw],
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

/**
 * Skin, red lips, a dark mouth opening when the jaw is open, and optionally a tongue: `tongueInside`
 * paints it inside the open mouth only; `tongueTo` paints it hanging over the lower lip down to that y.
 */
function image({ jaw = 0, tongueTo = 0, tongueInside = false, light = [1, 1, 1], rotateDeg = 0 } = {}) {
  const a = (-rotateDeg * Math.PI) / 180;
  return (x, y) => {
    const dx = x - 150;
    const dy = y - 160;
    const fx = 150 + dx * Math.cos(a) - dy * Math.sin(a);
    const fy = 160 + dx * Math.sin(a) + dy * Math.cos(a);
    const mid = Math.abs(fx - 150);
    let c = [200, 150, 130];
    if (fy >= 196 && fy <= 202 && mid < 30) c = [190, 90, 90]; // upper lip
    if (jaw && fy > 202 && fy < 203 + jaw && mid < 26) c = tongueInside ? [110, 50, 55] : [40, 20, 20]; // open mouth (a tongue at rest in it is in shade)
    if (fy >= 203 + jaw && fy <= 222 + jaw && mid < 30) c = [190, 90, 90]; // lower lip
    if (tongueTo && fy >= 203 && fy <= tongueTo + jaw && mid < 20) c = [205, 95, 105]; // tongue out
    return c.map((v, i) => Math.min(255, v * light[i]));
  };
}

function calibratedTracker(opts = {}) {
  const t = createTongueTracker();
  for (let i = 0; i < 10; i++) t.calibrate(face(opts));
  return t;
}

test('head frame follows the eyes and points down toward the chin', () => {
  const f = headFrame(face());
  assert.ok(Math.abs(f.right.x - 1) < 1e-9 && Math.abs(f.down.y - 1) < 1e-9);
  assert.equal(f.scale, 100);
  assert.deepEqual(toLocal({ x: 150, y: 220 }, { x: 150, y: 280 }, f), { u: 0, v: -0.6 });
});

// The counter works on the change from the calibrated (tongue in) reading: it enters "out" at about
// +0.2 and leaves below about +0.1 (ON/OFF with the 0.05 deviation floor).
const ON = 0.2;
const OFF = 0.1;
const rise = (t, f, img) => t.measure(f, img).extension - t.measure(face(), image()).extension;

test('a tongue hanging over the lip toward the chin rises far above the tongue-in reading', () => {
  const t = calibratedTracker();
  assert.ok(rise(t, face({ jaw: 10, lipOnTongue: 30 }), image({ jaw: 10, tongueTo: 262 })) >= ON + 0.1);
});

test('a short tongue straight out shows little new colour but drags the lip landmark (second cue)', () => {
  const t = calibratedTracker();
  // Pointing at the camera it mostly covers the lips, which were red already: colour alone is weak...
  const m = t.measure(face({ jaw: 12, lipOnTongue: 14 }), image({ jaw: 12, tongueTo: 226 }));
  // ...but the tracker pushes the lower-lip landmark onto the tongue, 0.14 eye spans below its place.
  assert.ok(Math.abs(m.lipDrag - 0.14) < 1e-9, `lipDrag ${m.lipDrag}`);
  assert.ok(m.lipDrag >= 0.1, 'crosses ON for the lip-drag cue (4 x 0.025)');
});

test('opening the mouth does not drag the lip: lip and chin move together', () => {
  const t = calibratedTracker();
  assert.ok(Math.abs(t.measure(face({ jaw: 25 }), image({ jaw: 25 })).lipDrag) < 1e-9);
});

test('opening the mouth without the tongue stays below OFF (the cavity is dark, not tongue)', () => {
  const t = calibratedTracker();
  const r = rise(t, face({ jaw: 25 }), image({ jaw: 25 }));
  assert.ok(r < OFF, `rise ${r.toFixed(3)}`);
});

test('a tongue resting in the shade of the open mouth stays below OFF', () => {
  const t = calibratedTracker();
  const r = rise(t, face({ jaw: 25 }), image({ jaw: 25, tongueInside: true }));
  assert.ok(r < OFF, `rise ${r.toFixed(3)}`);
});

test('the lip landmark dragged onto the tongue does not move the search region', () => {
  const t = calibratedTracker();
  const dragged = t.measure(face({ jaw: 10, lipOnTongue: 40 }), image({ jaw: 10, tongueTo: 262 }));
  const steady = t.measure(face({ jaw: 10 }), image({ jaw: 10, tongueTo: 262 }));
  assert.deepEqual(dragged.region, steady.region);
});

test('warm light and dim light keep the same verdict (colour is judged against the cheeks)', () => {
  const t = calibratedTracker();
  const neutralIn = t.measure(face(), image()).extension;
  for (const light of [[1.25, 1, 0.8], [0.35, 0.35, 0.35]]) {
    const inside = t.measure(face(), image({ light })).extension;
    assert.ok(Math.abs(inside - neutralIn) < 0.05, `in, light ${light}: ${inside} vs ${neutralIn}`);
    assert.ok(t.measure(face({ jaw: 10 }), image({ jaw: 10, tongueTo: 262, light })).extension - inside >= ON + 0.1, `out, light ${light}`);
  }
});

test('too dark to judge colour reports unknown instead of guessing', () => {
  const t = calibratedTracker();
  assert.equal(t.measure(face(), image({ tongueTo: 262, light: [0.1, 0.1, 0.1] })).extension, null);
});

test('a tilted head gives the same reading (measured along the head, not the screen)', () => {
  const t = calibratedTracker();
  const tilted = t.measure(face({ jaw: 10, rotateDeg: 25 }), image({ jaw: 10, tongueTo: 262, rotateDeg: 25 })).extension;
  const straight = t.measure(face({ jaw: 10 }), image({ jaw: 10, tongueTo: 262 })).extension;
  assert.ok(Math.abs(tilted - straight) <= 0.1, `tilted ${tilted} vs straight ${straight}`);
});

test('every sample is reported for drawing, labelled by what it saw', () => {
  const t = calibratedTracker();
  const m = t.measure(face({ jaw: 10 }), image({ jaw: 10, tongueTo: 262 }));
  assert.equal(m.samples.length, 56);
  assert.ok(m.samples.some((s) => s.kind === 'tongue'));
  assert.equal(m.region.length, 4);
});

test('head angles come out of the transformation matrix', () => {
  const yaw30 = [Math.cos(Math.PI / 6), 0, -Math.sin(Math.PI / 6), 0, 0, 1, 0, 0, Math.sin(Math.PI / 6), 0, Math.cos(Math.PI / 6), 0, 0, 0, 0, 1];
  assert.ok(Math.abs(headAngles(yaw30).yaw - 30) < 1e-6);
});
