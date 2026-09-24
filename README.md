# Tongue Flick

A front-camera party-game prototype: flick your tongue at a 3D lollipop as fast as you can for 20 seconds. Built with MediaPipe Face Landmarker and Three.js as a static page, no build step.

- **Play:** open `index.html` over HTTPS (or `npm run serve` → http://127.0.0.1:4731), allow the camera, keep your tongue in for a moment while it calibrates, then go.
- **No camera?** add `?sim=1`: hold the button or Space for "tongue out".
- **Tracking is always drawn:** face landmarks, the lip outline, the box over the gap between the lips, and the verdict. Each sample dot is pink for tongue, white for skin or teeth, grey for shade; the label shows both cues and the z-score.
- **See the signal:** press **Signal** (or add `?debug=1`) for the live threshold graph.
- **Check on a photo:** `dev/face-check.html?img=<face photo URL>` runs the real tracker on a portrait, once with the tongue in and once with a painted tongue.

## How flicks are counted

MediaPipe's face blendshapes have **no tongue output**, so the tongue is measured directly, in the head's own frame (`src/tongue-signal.js`):

Licking only needs the tongue to come out over the lips, and colour alone can't tell a tongue from the lips (both are redder than skin). Two cues can:

1. **Mouth fill (main cue).** Sample a 4×7 grid in the gap between the inner lips, corner to corner, and measure the share that is a **lit, tongue-coloured** surface.
   - Tongue-coloured = redder and less green than the **cheeks in the same frame** (chromaticity, so warm or dim light cancels out) and not much darker than them.
   - Closed lips: no gap, so the cue is 0 however red the lips are.
   - Mouth open with no tongue: a dark cavity or white teeth, so 0.
   - Tongue resting in the mouth: in shade, so 0.
   - Tongue out between or over the lips: the gap fills.
   - The gap's lower edge is the calibrated lower-lip position (measured from the chin, so it follows the jaw), because the tracker can pull the lower-lip landmark up onto the tongue.
2. **Lip drag (second cue).** How far the tracked lower lip sits below its calibrated place, measured from the chin: the tracker pushes the lower-lip landmarks onto a protruding tongue. Opening the mouth moves lip and chin together and leaves it at 0.
3. **Calibration.** While the tongue is in, record where the lower lip sits relative to the chin, in head-local units (eye line = *right*, perpendicular = *down*).
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

`npm test` runs 25 tests:

- fast trains (4 flicks/s, also at 10 fps), slow licks, a held tongue;
- hovering near the threshold, single-frame spikes;
- head movement, lost face, slow lighting drift, identical restarts;
- the mouth-fill cue with closed red lips, a tongue just covering the lips, the mouth open with no tongue, a tongue resting inside the mouth, and the lip landmark dragged onto the tongue;
- the same cue under neutral, warm, dim and too-dark light, and with a tilted head.

The page also exposes `render_game_to_text()` and `advanceTime(ms)` for deterministic browser checks in sim mode.

## Limits

- Tuned against synthetic signals and sim mode; the thresholds still need a pass on real iPhones in bright, dim and dark rooms.
- The mouth-fill cue assumes the tongue is redder than the cheeks, which holds for most people and light but not all; the lip-drag cue is the fallback.
