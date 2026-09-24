# Tongue Flick

A front-camera party-game prototype: flick your tongue at a 3D lollipop as fast as you can for 20 seconds. Built with MediaPipe Face Landmarker and Three.js as a static page, no build step.

- **Play:** open `index.html` over HTTPS (or `npm run serve` → http://127.0.0.1:4731), allow the camera, keep your tongue in for a moment while it calibrates, then go.
- **No camera?** add `?sim=1`: hold the button or Space for "tongue out".
- **See the signal:** press **Signal** (or add `?debug=1`) for the live graph, the thresholds and the landmarks used.

## How flicks are counted

MediaPipe's face blendshapes have **no tongue output**, so the tongue is measured directly, in the head's own frame:

1. **Extension cue.** From the lower inner lip, walk along the head's *down* axis (perpendicular to the eye line) toward the chin and measure how far tongue-coloured pixels continue past the lower lip. Colour is compared as chromaticity against the **cheeks in the same frame**, so warm or dim light shifts both sides and cancels out. Pixels below a darkness floor are ignored. When too few are usable the cue reports *unknown* rather than guessing.
2. **Lip–chin cue.** A protruding tongue drags the tracked lower lip toward the chin. That distance is divided by nose-to-chin length, so head distance and nodding cancel.
3. **Counter** (`src/flick-counter.js`, pure and unit-tested):
   - per-person, per-light calibration while the tongue is in; everything after runs on z-scores against that baseline;
   - **hysteresis:** a flick starts above ON (4σ) and ends only below OFF (2σ), so noise near a threshold can't burst-count;
   - counts on the **rising edge only**, so a held tongue scores once;
   - 2-frame confirmation, so single-frame spikes don't count;
   - 110 ms **refractory** window;
   - a **motion gate**: head rotation faster than 90°/s (from the facial transformation matrix) freezes counting, so head bobs don't score;
   - the baseline drifts slowly while the tongue is in, following lighting changes during play.

## Lollipop reactions

A dent at the contact point that springs back, a damped wobble, a clearcoat "wetness" that dries over time, and the candy wearing down with each lick. All of it is dt-based with no per-frame allocation (`src/lollipop.js`).

## Tests

`npm test` runs 17 tests:

- fast trains (4 flicks/s), slow licks, a held tongue;
- hovering near the threshold, single-frame spikes;
- head movement, lost face, slow lighting drift, identical restarts;
- the pixel cue under neutral, warm, dim and too-dark light, and with a tilted head.

The page also exposes `render_game_to_text()` and `advanceTime(ms)` for deterministic browser checks in sim mode.

## Limits

- Tuned against synthetic signals and sim mode; the thresholds still need a pass on real iPhones in bright, dim and dark rooms.
- The colour cue assumes the tongue is redder than the cheeks, which holds for most people and light but not all. The lip cue is the fallback when it can't decide.
