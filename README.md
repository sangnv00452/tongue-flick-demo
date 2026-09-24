# Tongue Flick

A front-camera party-game prototype: flick your tongue at a 3D lollipop as fast as you can for 20 seconds. Built with MediaPipe Face Landmarker and Three.js as a static page, no build step.

- **Play:** open `index.html` over HTTPS (or `npm run serve` → http://127.0.0.1:4731), allow the camera, keep your tongue in for a moment while it calibrates, then go.
- **No camera?** add `?sim=1`: hold the button or Space for "tongue out".
- **Tracking is always drawn:** face landmarks, the lip outline, the search grid and the verdict. Each sample dot is pink for tongue, white for skin, grey for shade or too dark; the label shows both cues and the z-score.
- **See the signal:** press **Signal** (or add `?debug=1`) for the live threshold graph.
- **Check on a photo:** `dev/face-check.html?img=<face photo URL>` runs the real tracker on a portrait, once with the tongue in and once with a painted tongue.

## How flicks are counted

MediaPipe's face blendshapes have **no tongue output**, so the tongue is measured directly, in the head's own frame (`src/tongue-signal.js`):

1. **Calibrate the lip line.** While the tongue is in, record where the lower lip sits relative to the chin, in head-local units (eye line = *right*, perpendicular = *down*). Lip and chin both ride on the jaw, so this offset still holds when the mouth opens.
2. **Colour cue.** Each frame, sample an 8×7 grid from the upper lip down past that lip line.
   - A tongue pointing at the camera mostly covers the mouth and lower lip in the picture; a longer one also covers the chin.
   - The cue is the **tongue-coloured share** of that area; samples below the lip line count double.
   - Tongue-coloured = redder and less green than the **cheeks in the same frame** (chromaticity, so warm or dim light cancels out) and not much darker than them. The open mouth with no tongue is a dark red cavity; a tongue sticking out is lit.
   - The lips are red too, but they are part of the calibrated baseline.
3. **Lip-drag cue.** How far the tracked lower lip sits below its calibrated place, measured from the chin. The tracker pushes the lower-lip landmarks onto a protruding tongue, so this catches a tongue pointed straight at the camera that adds little new colour. Opening the mouth moves lip and chin together and leaves it at zero.
4. **Counter** (`src/flick-counter.js`, pure and unit-tested). It takes the stronger of the two cues:
   - per-person, per-light calibration while the tongue is in; everything after runs on z-scores against that baseline;
   - **hysteresis:** a flick starts above ON (4σ) and ends only below OFF (2σ), so noise near a threshold can't burst-count;
   - counts on the **rising edge only**, so a held tongue scores once;
   - 2-frame confirmation, so single-frame spikes don't count (on a slow phone, one frame longer than 70 ms is enough);
   - 110 ms **refractory** window;
   - a **motion gate**: head rotation faster than 120°/s (from the facial transformation matrix) freezes counting, so head bobs don't score;
   - the baseline drifts slowly while the tongue is in, following lighting changes during play.

## Lollipop reactions

A dent at the contact point that springs back, a damped wobble, a clearcoat "wetness" that dries over time, and the candy wearing down with each lick. All of it is dt-based with no per-frame allocation (`src/lollipop.js`).

## Tests

`npm test` runs 23 tests:

- fast trains (4 flicks/s, also at 10 fps), slow licks, a held tongue;
- hovering near the threshold, single-frame spikes;
- head movement, lost face, slow lighting drift, identical restarts;
- the pixel cue with the mouth open and no tongue, with the tongue resting inside the mouth, and with the lip landmark dragged onto the tongue;
- the pixel cue under neutral, warm, dim and too-dark light, and with a tilted head.

The page also exposes `render_game_to_text()` and `advanceTime(ms)` for deterministic browser checks in sim mode.

## Limits

- Tuned against synthetic signals and sim mode; the thresholds still need a pass on real iPhones in bright, dim and dark rooms.
- The colour cue assumes the tongue is redder than the cheeks, which holds for most people and light but not all. The lip cue is the fallback when it can't decide.
