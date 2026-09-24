import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chroma, createTongueTracker, headAngles, headFrame, isTongueColour, LM, SIGNAL_DEFAULTS, toLocal } from '../src/tongue-signal.js';

// A frontal face in pixel coordinates: eyes 100 px apart, lower lip 60 px above the chin.
// `jaw` opens the mouth: lower lip and chin move down together; `lipOnTongue` is how far the tracker
// drags the lower-lip landmark down when the tongue is out.
function face({ jaw = 0, lipOnTongue = 0, rotateDeg = 0 } = {}) {
  const base = {
    [LM.eyeOuterR]: [100, 100],
    [LM.eyeOuterL]: [200, 100],
    [LM.forehead]: [150, 40],
    [LM.nose]: [150, 160],
    [LM.innerCornerR]: [126, 203 + jaw / 2],
    [LM.innerCornerL]: [174, 203 + jaw / 2],
    [LM.upperInner]: [150, 202],
    [LM.lowerInner]: [150, 203 + jaw],
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
function image({ jaw = 0, tongueTo = 0, tongueInside = false, light = [1, 1, 1], rotateDeg = 0, SKIN = [164, 120, 101], LIP = [139, 106, 96], TONGUE = [132, 93, 100], TONGUE_SHADE = [66, 46, 50], CAVITY = [40, 20, 20] } = {}) {
  const a = (-rotateDeg * Math.PI) / 180;
  return (x, y) => {
    const dx = x - 150;
    const dy = y - 160;
    const fx = 150 + dx * Math.cos(a) - dy * Math.sin(a);
    const fy = 160 + dx * Math.sin(a) + dy * Math.cos(a);
    const mid = Math.abs(fx - 150);
    let c = SKIN;
    if (fy >= 194 && fy <= 202 && mid < 28) c = LIP; // upper lip
    if (jaw && fy > 202 && fy < 203 + jaw && mid < 26) c = tongueInside ? TONGUE_SHADE : CAVITY; // open mouth (a tongue at rest in it is in shade)
    if (fy >= 203 + jaw && fy <= 222 + jaw && mid < 30) c = LIP; // lower lip
    if (tongueTo && fy >= 203 && fy <= tongueTo + jaw && mid < 22) c = TONGUE; // tongue out, over the lips
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

test('closed lips read zero: there is no gap for a tongue to fill, however red the lips are', () => {
  const t = calibratedTracker();
  const m = t.measure(face(), image());
  assert.equal(m.extension, 0);
  assert.ok(m.gap < 0.04);
});

test('closed lips whose tracked inner points sit apart over pink inner lip read zero (seen on the phone)', () => {
  // The tracker leaves 7 px (0.07 eye spans) between the inner-lip points with the mouth shut, and the
  // inner lip there is as pink as a tongue: before calibrating the closed gap this read 20-40% fill.
  const shut = (o = {}) => {
    const pts = face(o);
    pts[LM.lowerInner] = { x: pts[LM.lowerInner].x, y: pts[LM.lowerInner].y + 7 };
    return pts;
  };
  const pinkSeam = (o = {}) => {
    const base = image(o);
    return (x, y) => (y > 202 && y < 209 && Math.abs(x - 150) < 24 && !o.jaw ? [132, 93, 100] : base(x, y));
  };
  const t = createTongueTracker();
  for (let i = 0; i < 10; i++) t.calibrate(shut());
  assert.equal(t.measure(shut(), pinkSeam()).extension, 0);
  const out = t.measure(shut({ jaw: 12 }), pinkSeam({ jaw: 12, tongueTo: 230 })).extension;
  assert.ok(out >= ON, `tongue out ${out}`);
});

test('a calibration caught with the mouth half open corrects itself once the lips close', () => {
  const t = createTongueTracker();
  for (let i = 0; i < 10; i++) t.calibrate(face({ jaw: 12 })); // replay started mid-laugh
  // With the mouth half open as the "closed" reference, a lick at the same opening reads nothing...
  assert.equal(t.measure(face({ jaw: 12 }), image({ jaw: 12, tongueTo: 230 })).extension, 0);
  // ...until the lips close once; after that the same lick is seen.
  t.measure(face(), image());
  assert.ok(t.measure(face({ jaw: 12 }), image({ jaw: 12, tongueTo: 230 })).extension >= ON);
});

test('a tongue that just covers the lips (the licking case) crosses ON', () => {
  const t = calibratedTracker();
  const r = rise(t, face({ jaw: 10 }), image({ jaw: 10, tongueTo: 226 }));
  assert.ok(r >= ON, `rise ${r.toFixed(3)}`);
});

test('a tongue hanging further, past the lips, crosses ON by more', () => {
  const t = calibratedTracker();
  const short = rise(t, face({ jaw: 10 }), image({ jaw: 10, tongueTo: 226 }));
  const long = rise(t, face({ jaw: 10 }), image({ jaw: 10, tongueTo: 262 }));
  assert.ok(long >= short && long >= ON, `short ${short.toFixed(3)} long ${long.toFixed(3)}`);
});

test('the lip landmark dragged onto the tongue is a second cue, independent of colour', () => {
  const t = calibratedTracker();
  const m = t.measure(face({ jaw: 12, lipOnTongue: 14 }), image({ jaw: 12, tongueTo: 226 }));
  // The tracker pushed the lower-lip landmark 0.14 eye spans below its calibrated place.
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
  assert.equal(m.samples.length, 28);
  assert.ok(m.samples.some((s) => s.kind === 'tongue'));
  assert.equal(m.region.length, 4);
});

test('pixels measured on a real phone (warm light, tan skin): tongue yes; lips, skin, teeth no', () => {
  // Small-patch averages from frozen screenshots of the owner's iPhone 11 Pro front camera.
  const cheeks = [chroma([164, 120, 101]), chroma([133, 89, 69])];
  const skin = { r: (cheeks[0].r + cheeks[1].r) / 2, g: (cheeks[0].g + cheeks[1].g) / 2, b: (cheeks[0].b + cheeks[1].b) / 2, luma: (cheeks[0].luma + cheeks[1].luma) / 2 };
  const tongue = [[132, 93, 100], [126, 93, 99], [150, 115, 109], [99, 72, 74], [144, 116, 120], [130, 92, 100], [127, 91, 94]];
  const notTongue = { upperLip: [139, 106, 96], lowerLip: [163, 121, 104], cheek: [164, 120, 101], teeth: [205, 195, 190], cavity: [40, 25, 25] };
  for (const px of tongue) assert.ok(isTongueColour(chroma(px), skin, SIGNAL_DEFAULTS), `tongue ${px}`);
  for (const [name, px] of Object.entries(notTongue)) assert.ok(!isTongueColour(chroma(px), skin, SIGNAL_DEFAULTS), `${name} ${px}`);
});

test('teeth showing in the gap do not read as tongue', () => {
  const t = calibratedTracker();
  const r = rise(t, face({ jaw: 12 }), image({ jaw: 12, CAVITY: [205, 195, 190] }));
  assert.ok(r < OFF, `rise ${r.toFixed(3)}`);
});

test('head angles come out of the transformation matrix', () => {
  const yaw30 = [Math.cos(Math.PI / 6), 0, -Math.sin(Math.PI / 6), 0, 0, 1, 0, 0, Math.sin(Math.PI / 6), 0, Math.cos(Math.PI / 6), 0, 0, 0, 0, 1];
  assert.ok(Math.abs(headAngles(yaw30).yaw - 30) < 1e-6);
});
