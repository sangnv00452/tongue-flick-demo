// Tongue Flick demo: front camera -> MediaPipe Face Landmarker -> tongue cues -> flick counter ->
// a 3D lollipop that reacts. `?sim=1` runs without a camera (space / hold the button = tongue out),
// which is also how the page is tested headlessly through the hooks at the bottom.
import * as THREE from 'three';
import { createFlickCounter } from './flick-counter.js';
import { createLollipop } from './lollipop.js';
import { touchesCandy } from './reach.js';
import { createTongueTracker, headAngles, LM } from './tongue-signal.js';

const MP_VERSION = '1.0.1';
const MP_BASE = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VERSION}`;
const MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';

const CONFIG = Object.freeze({
  roundMs: 20_000,
  sampleWidth: 320, // the camera frame is downscaled to this width for pixel sampling
  simStepMs: 1000 / 30,
  graphSeconds: 5,
  readyMs: 1200, // settle time before calibration starts (start and replay)
  candyY: 0.72, // candy centre, share of screen height
  candySize: 0.3, // lollipop size, share of the smaller screen side
});

const params = new URLSearchParams(location.search);
const SIM = params.has('sim');

const $ = (id) => document.getElementById(id);
const ui = {
  video: $('video'),
  gl: $('gl'),
  overlay: $('overlay'),
  graph: $('graph'),
  start: $('start'),
  restart: $('restart'),
  menu: $('menu'),
  results: $('results'),
  finalScore: $('final-score'),
  count: $('count'),
  timer: $('timer'),
  hint: $('hint'),
  debug: $('debug'),
  debugText: $('debug-text'),
  toggleDebug: $('toggle-debug'),
  freeze: $('freeze'),
  mute: $('mute'),
  simButton: $('sim-lick'),
  status: $('status'),
};

// ---------- game state machine: menu -> loading -> calibrating -> playing -> results -> (restart) calibrating
const game = { state: 'menu', startedAt: 0, now: 0, remainingMs: CONFIG.roundMs, score: 0, faceFound: false, cueMode: 'none', error: null, delegate: null, readyUntil: 0, touch: null, lickOpen: false, lickSawTongue: false, lastLickAt: null, lastMissAt: null };
const counter = createFlickCounter();
let debugOn = params.has('debug') || SIM;
let muted = false;

function setState(next) {
  game.state = next;
  document.body.dataset.state = next;
  if (next === 'calibrating') {
    counter.reset();
    tracker.reset();
    lollipop.reset();
    game.score = 0;
    game.remainingMs = CONFIG.roundMs;
    game.readyUntil = game.now + CONFIG.readyMs;
    game.touch = null;
    game.lickOpen = false;
    history.length = 0;
  }
  if (next === 'playing') game.startedAt = game.now;
  if (next === 'results') ui.finalScore.textContent = String(game.score);
  renderHud();
}

// ---------- three.js overlay
const renderer = new THREE.WebGLRenderer({ canvas: ui.gl, alpha: true, antialias: true });
renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100);
camera.position.set(0, 0, 10);
scene.add(new THREE.HemisphereLight(0xfff4e6, 0x404a66, 1.6));
const key = new THREE.DirectionalLight(0xffffff, 2.2);
key.position.set(2, 3, 5);
scene.add(key);
const lollipop = createLollipop();
scene.add(lollipop.object);

const view = { w: 1, h: 1 };
function resize() {
  view.w = window.innerWidth;
  view.h = window.innerHeight;
  renderer.setSize(view.w, view.h, false);
  camera.aspect = view.w / view.h;
  camera.updateProjectionMatrix();
  // The overlay is drawn in CSS px but backed at device resolution, so dots and text stay sharp on
  // 2x/3x screens.
  const dpr = Math.min(3, window.devicePixelRatio || 1);
  ui.overlay.width = Math.round(view.w * dpr);
  ui.overlay.height = Math.round(view.h * dpr);
  ui.overlay.getContext('2d').setTransform(dpr, 0, 0, dpr, 0, 0);
}
window.addEventListener('resize', resize);
resize();

const worldPerPx = () => (2 * camera.position.z * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))) / view.h;
function placeLollipop(screen, sizePx) {
  const k = worldPerPx();
  const target = new THREE.Vector3((screen.x - view.w / 2) * k, -(screen.y - view.h / 2) * k, 0);
  lollipop.object.position.lerp(target, 0.35);
  const size = Math.max(0.3, sizePx * 0.42 * k);
  lollipop.object.scale.setScalar(THREE.MathUtils.lerp(lollipop.object.scale.x, size, 0.3));
}

// ---------- audio (created on the first gesture)
let audio = null;
function pop() {
  if (!audio || muted) return;
  const t = audio.currentTime;
  const o = audio.createOscillator();
  const g = audio.createGain();
  o.type = 'triangle';
  o.frequency.setValueAtTime(520 + Math.min(game.score, 40) * 12, t);
  o.frequency.exponentialRampToValueAtTime(180, t + 0.12);
  g.gain.setValueAtTime(0.18, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.14);
  o.connect(g).connect(audio.destination);
  o.start(t);
  o.stop(t + 0.15);
}

// ---------- camera + face tracking
let landmarker = null;
const sampleCanvas = document.createElement('canvas');
const sampleCtx = sampleCanvas.getContext('2d', { willReadFrequently: true });
let lastVideoTime = -1;
const head = { yaw: 0, pitch: 0, t: 0, angularVel: 0 };
const tracker = createTongueTracker();
let lipConnections = []; // FaceLandmarker.FACE_LANDMARKS_LIPS, for drawing the lip outline
let lastFace = null; // what the tracker saw last frame, in screen pixels, for the overlay

async function startCamera() {
  ui.status.textContent = 'Starting camera…';
  const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } }, audio: false });
  ui.video.srcObject = stream;
  await ui.video.play();
  ui.status.textContent = 'Loading face tracker…';
  const { FaceLandmarker, FilesetResolver } = await import(`${MP_BASE}/vision_bundle.mjs`);
  lipConnections = FaceLandmarker.FACE_LANDMARKS_LIPS ?? [];
  const fileset = await FilesetResolver.forVisionTasks(`${MP_BASE}/wasm`);
  const options = (delegate) => ({
    baseOptions: { modelAssetPath: MODEL_URL, delegate },
    runningMode: 'VIDEO',
    numFaces: 1,
    outputFaceBlendshapes: false,
    outputFacialTransformationMatrixes: true,
  });
  // The GPU delegate is fastest but not available in every browser (older iOS Safari); CPU always works.
  try {
    landmarker = await FaceLandmarker.createFromOptions(fileset, options('GPU'));
    game.delegate = 'GPU';
  } catch (err) {
    console.warn('GPU delegate unavailable, using CPU', err);
    landmarker = await FaceLandmarker.createFromOptions(fileset, options('CPU'));
    game.delegate = 'CPU';
  }
  ui.status.textContent = '';
}

/** Maps a normalized landmark to screen pixels for a mirrored, object-fit: cover video. */
function toScreen(p) {
  const vw = ui.video.videoWidth || 640;
  const vh = ui.video.videoHeight || 480;
  const s = Math.max(view.w / vw, view.h / vh);
  return { x: (view.w - vw * s) / 2 + (1 - p.x) * vw * s, y: (view.h - vh * s) / 2 + p.y * vh * s };
}

function readCameraCues(t) {
  const video = ui.video;
  if (!landmarker || video.readyState < 2 || video.currentTime === lastVideoTime) return null;
  lastVideoTime = video.currentTime;
  const res = landmarker.detectForVideo(video, t);
  const lms = res.faceLandmarks?.[0];
  if (!lms) {
    lastFace = null;
    return { faceFound: false, cues: {}, angularVel: 0 };
  }

  const w = CONFIG.sampleWidth;
  const h = Math.round((w * video.videoHeight) / video.videoWidth);
  if (sampleCanvas.width !== w || sampleCanvas.height !== h) {
    sampleCanvas.width = w;
    sampleCanvas.height = h;
  }
  sampleCtx.drawImage(video, 0, 0, w, h);
  const img = sampleCtx.getImageData(0, 0, w, h).data;
  const sample = (x, y) => {
    const i = (Math.min(h - 1, Math.max(0, Math.round(y))) * w + Math.min(w - 1, Math.max(0, Math.round(x)))) * 4;
    return [img[i], img[i + 1], img[i + 2]];
  };
  const pts = lms.map((p) => ({ x: p.x * w, y: p.y * h }));
  // While the counter calibrates (tongue in), learn where this person's lower lip sits above the chin.
  const counterState = counter.snapshot().state;
  if (counterState === 'waiting' || counterState === 'calibrating') tracker.calibrate(pts);
  const m0 = tracker.measure(pts, sample);
  const extension = m0.extension;
  game.cueMode = extension === null ? 'too dark to see colour' : 'colour';

  const m = res.facialTransformationMatrixes?.[0]?.data;
  if (m) {
    const a = headAngles(m);
    const dt = Math.max(1, t - head.t) / 1000;
    const v = Math.hypot(a.yaw - head.yaw, a.pitch - head.pitch) / dt;
    head.angularVel = head.t ? 0.6 * head.angularVel + 0.4 * v : 0;
    Object.assign(head, a, { t });
  }

  const fromSample = (p) => toScreen({ x: p.x / w, y: p.y / h });
  lastFace = {
    screenPts: lms.map(toScreen),
    region: m0.region.map(fromSample),
    lipLine: m0.lipLine.map(fromSample),
    samples: m0.samples.map((s) => ({ ...fromSample(s), kind: s.kind })),
    extension,
    lipDrag: m0.lipDrag,
    blob: m0.blob.map(fromSample),
  };
  return { faceFound: true, cues: { extension, lipDrag: m0.lipDrag }, angularVel: head.angularVel };
}

// ---------- simulation input
const sim = { tongueOut: false, headTurning: false, farFromCandy: false };
function readSimCues() {
  game.cueMode = 'simulated';
  const noise = (Math.random() - 0.5) * 0.02;
  return { faceFound: true, cues: { extension: (sim.tongueOut ? 0.7 : 0) + noise }, angularVel: sim.headTurning ? 300 : 0 };
}

// ---------- per-frame step (shared by the real loop and advanceTime)
const history = [];
function step(t, dt) {
  game.now = t;
  // A moment to settle before calibrating, so a replay does not calibrate on a laughing mouth.
  const ready = game.state === 'playing' || (game.state === 'calibrating' && t >= game.readyUntil);
  const frame = ready ? (SIM ? readSimCues() : readCameraCues(t)) : null;
  const candy = candyOnScreen();
  if (frame) {
    game.faceFound = frame.faceFound;
    // In sim mode "touching" is a switch; with a camera it is the detected tongue shape entering the candy.
    game.touch = SIM ? { touching: sim.tongueOut && !sim.farFromCandy, distance: 0 } : touchesCandy(lastFace?.blob ?? [], candy);
    const r = counter.update({ t, cues: frame.cues, angularVel: frame.angularVel, faceFound: frame.faceFound });
    history.push({ t, z: r.signal, flick: r.flick, gated: r.gated });
    while (history.length && history[0].t < t - CONFIG.graphSeconds * 1000) history.shift();
    if (game.state === 'calibrating' && r.state === 'in') setState('playing');
    if (game.state === 'playing') {
      // A lick scores once, if the tongue touches the candy at any moment while it is out; a lick that
      // ends without touching is a miss.
      if (r.flick) {
        game.lickOpen = true;
        game.lickSawTongue = false;
      }
      // "Missed" only for a lick where a tongue was actually seen: the lip-drag cue alone can fire on
      // lip jitter, and that should not nag the player.
      if (game.lickOpen) game.lickSawTongue ||= SIM ? sim.tongueOut : (lastFace?.blob.length ?? 0) > 0;
      if (game.lickOpen && game.touch.touching) {
        game.lickOpen = false;
        game.score += 1;
        game.lastLickAt = t;
        lollipop.lick();
        pop();
      } else if (game.lickOpen && r.state === 'in') {
        game.lickOpen = false;
        if (game.lickSawTongue) game.lastMissAt = t;
      }
    }
  }
  if (game.state === 'playing') {
    game.remainingMs = Math.max(0, CONFIG.roundMs - (t - game.startedAt));
    if (game.remainingMs === 0) setState('results');
  }

  // The candy stays put; the player brings their mouth to it.
  placeLollipop(candy, candy.sizePx);
  lollipop.update(dt / 1000);
}

/** Where the candy is on screen: its centre and radius in px (it wears down as it is licked). */
function candyOnScreen() {
  const sizePx = Math.min(view.w, view.h) * CONFIG.candySize;
  return { x: view.w / 2, y: view.h * CONFIG.candyY, r: sizePx * 0.42 * lollipop.state().size, sizePx };
}

// ---------- drawing
function renderHud() {
  ui.count.textContent = String(game.score);
  ui.timer.textContent = game.state === 'playing' ? (game.remainingMs / 1000).toFixed(1) : '';
  const snap = counter.snapshot();
  ui.hint.textContent =
    game.state === 'calibrating' && game.now < game.readyUntil
      ? 'Get ready: close your mouth'
      : game.state === 'calibrating'
      ? game.faceFound
        ? `Close your mouth… ${Math.round(snap.calibration * 100)}%`
        : 'Face the camera'
      : game.state === 'playing' && !game.faceFound
        ? 'Face lost: counting paused'
        : game.state === 'playing' && game.now - (game.lastMissAt ?? -Infinity) < 1500
          ? 'Touch the candy with your tongue'
          : '';
}

function drawOverlay() {
  const g = ui.overlay.getContext('2d');
  g.clearRect(0, 0, view.w, view.h);
  if (!lastFace) return;
  const { screenPts, region, lipLine, samples, extension, lipDrag } = lastFace;
  const out = counter.snapshot().state === 'out';

  // Face mesh: every landmark as a faint dot.
  g.fillStyle = 'rgba(120,230,255,0.45)';
  for (const p of screenPts) g.fillRect(p.x - 1, p.y - 1, 2, 2);

  // Lip outline.
  g.strokeStyle = 'rgba(255,255,255,0.85)';
  g.lineWidth = 1.5;
  g.beginPath();
  for (const { start, end } of lipConnections) {
    g.moveTo(screenPts[start].x, screenPts[start].y);
    g.lineTo(screenPts[end].x, screenPts[end].y);
  }
  g.stroke();

  // Where the tongue is looked for: below the calibrated lip line, filled when the tongue is out.
  g.beginPath();
  region.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y)));
  g.closePath();
  g.fillStyle = out ? 'rgba(255,60,120,0.28)' : 'rgba(255,255,255,0.06)';
  g.fill();
  g.strokeStyle = out ? '#ff3c78' : 'rgba(255,255,255,0.6)';
  g.lineWidth = 2;
  g.stroke();
  g.setLineDash([6, 4]);
  g.strokeStyle = '#ffd166';
  g.beginPath();
  g.moveTo(lipLine[0].x, lipLine[0].y);
  g.lineTo(lipLine[1].x, lipLine[1].y);
  g.stroke();
  g.setLineDash([]);

  // The detected tongue shape (what has to touch the candy), then each gap sample by what it saw.
  g.fillStyle = 'rgba(255,60,120,0.55)';
  for (const p of lastFace.blob) g.fillRect(p.x - 2, p.y - 2, 4, 4);
  const colour = { tongue: '#ff3c78', skin: 'rgba(255,255,255,0.7)', shadow: '#8a8fa3', dark: '#555' };
  for (const s of samples) {
    g.fillStyle = colour[s.kind];
    g.beginPath();
    g.arc(s.x, s.y, 3, 0, Math.PI * 2);
    g.fill();
  }

  // Verdict under the mouth, clear of the samples (the video is mirrored, so take the box's screen extent).
  const x = Math.min(...region.map((p) => p.x));
  const y = Math.max(...region.map((p) => p.y)) + Math.max(28, (Math.max(...region.map((p) => p.y)) - Math.min(...region.map((p) => p.y))) * 1.6);
  g.font = '600 15px system-ui, sans-serif';
  g.fillStyle = out ? '#ff3c78' : '#fff';
  g.shadowColor = '#000';
  g.shadowBlur = 4;
  g.fillText(out ? 'TONGUE OUT' : 'tongue in', x, y - 9);
  g.font = '500 12px system-ui, sans-serif';
  g.fillText(`fill ${extension === null ? "too dark" : `${Math.round(extension * 100)}%`} · lip drag ${lipDrag.toFixed(2)} · z ${counter.snapshot().signal.toFixed(1)}`, x, y + 9);
  g.shadowBlur = 0;
}

/**
 * Around the candy: a ring that turns green while the tongue touches it, then "+1" rising after a
 * scored lick or "Missed" after a lick that never touched the candy.
 */
function drawLickFeedback() {
  const g = ui.overlay.getContext('2d');
  const candy = candyOnScreen();
  if (game.state === 'playing') {
    const near = game.touch?.touching;
    g.strokeStyle = near ? 'rgba(6,214,160,0.9)' : 'rgba(255,255,255,0.35)';
    g.lineWidth = near ? 4 : 2;
    g.setLineDash(near ? [] : [8, 8]);
    g.beginPath();
    g.arc(candy.x, candy.y, candy.r + 10, 0, Math.PI * 2);
    g.stroke();
    g.setLineDash([]);
  }
  const lickAge = game.now - (game.lastLickAt ?? -Infinity);
  const missAge = game.now - (game.lastMissAt ?? -Infinity);
  const [age, text, colour] = lickAge <= missAge ? [lickAge, '+1', '#ffd166'] : [missAge, 'Missed', '#c8cbe0'];
  if (age > 500) return;
  const k = age / 500;
  g.globalAlpha = 1 - k;
  g.font = `800 ${text === '+1' ? 44 : 28}px system-ui, sans-serif`;
  g.textAlign = 'center';
  g.fillStyle = colour;
  g.shadowColor = '#000';
  g.shadowBlur = 8;
  g.fillText(text, candy.x, candy.y - candy.r - 24 - k * 50);
  g.shadowBlur = 0;
  g.textAlign = 'start';
  g.globalAlpha = 1;
}

function drawGraph() {
  const c = ui.graph;
  const g = c.getContext('2d');
  const { onZ, offZ } = counter.config;
  const maxZ = 10;
  g.clearRect(0, 0, c.width, c.height);
  const y = (z) => c.height - (Math.max(-1, Math.min(maxZ, z)) + 1) * (c.height / (maxZ + 1));
  for (const [z, col] of [[onZ, '#ff5c8a'], [offZ, '#ffd166']]) {
    g.strokeStyle = col;
    g.setLineDash([4, 4]);
    g.beginPath();
    g.moveTo(0, y(z));
    g.lineTo(c.width, y(z));
    g.stroke();
  }
  g.setLineDash([]);
  const t0 = game.now - CONFIG.graphSeconds * 1000;
  const x = (t) => ((t - t0) / (CONFIG.graphSeconds * 1000)) * c.width;
  g.strokeStyle = '#7df9ff';
  g.lineWidth = 2;
  g.beginPath();
  history.forEach((h, i) => (i ? g.lineTo(x(h.t), y(h.z)) : g.moveTo(x(h.t), y(h.z))));
  g.stroke();
  g.fillStyle = '#fff';
  for (const h of history) if (h.flick) g.fillRect(x(h.t) - 1, 0, 2, c.height);
  g.fillStyle = 'rgba(255,160,0,0.25)';
  for (const h of history) if (h.gated) g.fillRect(x(h.t) - 1, c.height - 6, 3, 6);

  const s = counter.snapshot();
  ui.debugText.textContent = `state ${s.state} · z ${s.signal.toFixed(1)} (on ${onZ} / off ${offZ}) · ${s.gated ? 'HEAD MOVING: paused' : `head ${Math.round(head.angularVel)}°/s`} · cues: ${game.cueMode}${game.delegate ? ` · ${game.delegate}` : ''}`;
}

// ---------- main loop
let lastT = null;
let manualClock = false; // set once advanceTime() drives the game, for deterministic tests
// Freeze: a few seconds after the tap, stop on the current frame with its overlay so a screenshot
// catches exactly what the tracker saw (tongue out is hard to screenshot live).
const freeze = { at: null, since: null };
function updateFreeze(now) {
  if (freeze.at !== null && now >= freeze.at) {
    freeze.at = null;
    freeze.since = now;
    ui.video.pause();
    ui.freeze.textContent = 'Resume';
  }
  if (freeze.at !== null) ui.hint.textContent = `Freezing in ${Math.ceil((freeze.at - now) / 1000)}…`;
  else if (freeze.since !== null) ui.hint.textContent = 'Frozen: take a screenshot';
}
ui.freeze.addEventListener('click', () => {
  const now = performance.now();
  if (freeze.since !== null) {
    game.startedAt += now - freeze.since; // the round clock does not run while frozen
    freeze.since = null;
    lastT = now;
    ui.video.play();
    ui.freeze.textContent = 'Freeze 3s';
  } else if (freeze.at === null) freeze.at = now + 3000;
});

function frame(now) {
  if (!manualClock && freeze.since === null) {
    const dt = lastT === null ? 0 : Math.min(100, now - lastT);
    lastT = now;
    step(now, dt);
  }
  renderHud();
  updateFreeze(now);
  drawOverlay();
  drawLickFeedback();
  if (debugOn) drawGraph();
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

// ---------- input
async function begin() {
  try {
    audio ??= new AudioContext();
    setState('loading');
    if (!SIM) await startCamera();
    setState('calibrating');
  } catch (err) {
    game.error = err instanceof Error ? err.message : String(err);
    ui.status.textContent = `Could not start: ${game.error}. Try ?sim=1 to play without a camera.`;
    setState('menu');
  }
}
ui.start.addEventListener('click', begin);
ui.restart.addEventListener('click', () => setState('calibrating'));
ui.toggleDebug.addEventListener('click', () => {
  debugOn = !debugOn;
  document.body.classList.toggle('debug', debugOn);
});
ui.mute.addEventListener('click', () => {
  muted = !muted;
  ui.mute.textContent = muted ? 'Sound off' : 'Sound on';
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden) audio?.suspend();
  else audio?.resume();
});
if (SIM) {
  const set = (v) => () => (sim.tongueOut = v);
  window.addEventListener('keydown', (e) => e.code === 'Space' && !e.repeat && set(true)());
  window.addEventListener('keyup', (e) => e.code === 'Space' && set(false)());
  ui.simButton.addEventListener('pointerdown', set(true));
  ui.simButton.addEventListener('pointerup', set(false));
  ui.simButton.addEventListener('pointerleave', set(false));
  document.body.classList.add('sim');
}
document.body.classList.toggle('debug', debugOn);
setState('menu');
requestAnimationFrame(frame);

// ---------- test hooks (see README): deterministic stepping and a text view of the state
window.render_game_to_text = () =>
  JSON.stringify({ state: game.state, score: game.score, remainingMs: Math.round(game.remainingMs), counter: counter.snapshot(), lollipop: lollipop.state(), sim: SIM, faceFound: game.faceFound, touching: game.touch?.touching ?? null });
window.advanceTime = (ms) => {
  manualClock = true;
  for (let t = 0; t < ms; t += CONFIG.simStepMs) step(game.now + CONFIG.simStepMs, CONFIG.simStepMs);
  return window.render_game_to_text();
};
window.__sim = sim;
window.__GAME_READY__ = true;
