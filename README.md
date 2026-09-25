# Tongue Flick

A front-camera party-game prototype: flick your tongue at a 3D lollipop as fast as you can for 20 seconds. Built with MediaPipe Face Landmarker and Three.js as a static page, no build step.

- **Play:** open `index.html` over HTTPS (or `npm run serve` → http://127.0.0.1:4731), allow the camera, close your mouth for a moment while it calibrates, then bring your mouth to the candy and lick it.
- **No camera?** add `?sim=1`: hold the button or Space for "tongue out"; drag sideways across the button, or press the arrow keys, to stroke the candy.
- **Tracking is always drawn:** face landmarks, the lip outline, the box over the gap between the lips, and the verdict. Each sample dot is pink for tongue, white for skin or teeth, grey for shade; the label shows both cues and the z-score.
- **See the signal:** press **Signal** (or add `?debug=1`) for the live threshold graph.
- **Check on a photo:** `dev/face-check.html?img=<face photo URL>` runs the real tracker on a portrait, once with the tongue in and once with a painted tongue.

## How the tongue is detected

MediaPipe's face blendshapes have **no tongue output**, so the tongue is measured directly, in the head's own frame (`src/tongue-signal.js`):

Licking only needs the tongue to come out over the lips. Two cues:

1. **Mouth fill (main cue).** Sample a 4×7 grid in the gap between the inner lips, corner to corner, and measure the share that is a **lit, tongue-coloured** surface.
   - Tongue-coloured is tuned on real phone frames (warm light, tan skin). The tongue is pink-grey: blue about as strong as green. Skin and lips are warm: blue clearly below green. By plain redness the tongue is *less* red than tan cheeks, so the test is:
     - **pinker than the cheeks in the same frame**: chromaticity b−g at least 0.035 above theirs, so warm or dim light cancels out;
     - still reddish (r−g ≥ 0.05), which rules out white teeth;
     - not much darker than the cheeks.
   - Closed lips: no gap, so the cue is 0 however red the lips are.
   - Mouth open with no tongue: a dark cavity or white teeth, so 0.
   - Tongue resting in the mouth: in shade, so 0.
   - Tongue out between or over the lips: the gap fills.
   - The gap's lower edge is the calibrated lower-lip position (measured from the chin, so it follows the jaw), because the tracker can pull the lower-lip landmark up onto the tongue.
2. **Lip drag (second cue).** How far the tracked lower lip sits below its calibrated place, measured from the chin: the tracker pushes the lower-lip landmarks onto a protruding tongue. Opening the mouth moves lip and chin together and leaves it at 0.
3. **Calibration.** With the mouth closed, record where the lower lip sits relative to the chin, in head-local units (eye line = *right*, perpendicular = *down*), and how far apart the tracked inner-lip points sit.
   - Closed lips still leave a small gap between those points, and the inner lip is as pink as a tongue. So the mouth only counts as open once the gap is wider than that closed gap.
   - The closed gap only ever narrows during play.
4. **Tongue in/out** (`src/flick-counter.js`, pure and unit-tested). It drives calibration and the "TONGUE OUT" label, **not the score** (see below). It takes the stronger of the two cues:
   - per-person, per-light calibration while the tongue is in; everything after runs on z-scores against that baseline;
   - **peak/trough hysteresis:** a lick is a rise of 3σ from the lowest point since the last lick (and at least 3σ out); it ends at a 2.5σ fall from its peak, so a half-retracted tongue is enough for the next lick and jitter smaller than that cannot burst-count;
   - counts on the **rising edge only**, so a held tongue scores once;
   - 2-frame confirmation, so single-frame spikes don't count (on a slow phone, one frame longer than 70 ms is enough);
   - 110 ms **refractory** window;
   - a **motion gate**: head rotation faster than 250°/s (from the facial transformation matrix) freezes counting, so head bobs don't score;
   - the baseline drifts slowly while the tongue is in, following lighting changes during play.

## Touching the candy

The candy stays still; the player brings their mouth to it and licks. A lick scores only if **the tongue itself touches the candy**:
- **Tongue shape.** Flood-fill tongue-coloured pixels outward from the tongue samples found between the lips, on a grid of 0.04 eye spans, up to 1.3 eye spans from the mouth (`tongueBlob` in `src/tongue-signal.js`). A tongue out over the lips is one connected pink area, so the fill follows it to its tip wherever it points, and stops at the skin and lips around it.
- **Touch.** Count the tongue-shape points inside the candy's circle on screen (`src/reach.js`). The tongue and the candy are compared in the same screen pixels, so this holds on any screen size.
- **Scoring: two kinds of lick** (`src/lick-counter.js`, pure and unit-tested):
  - **Flick:** the tongue comes out and touches the candy. Each time the tongue comes out it flicks at most once, the first time it touches the candy. Pulling it back in and out again with the mouth right at the candy scores again every time.
  - **Stroke:** the tongue moves across the candy while touching it. The touch point is the centre of the tongue points inside the candy, in candy radii, so a stroke is the same on any screen size. A stroke scores when that point has moved 0.4 candy radii. One long sweep in one direction is one stroke; wiping back and forth scores each way.
  - Holding the tongue still on the candy scores nothing more. The touch point is smoothed (60 ms) against tracking jitter.
  - The first 150 ms after the tongue lands on the candy are not measured for strokes, because the touch point shifts while the tongue pushes in.
  - Licks are at least 200 ms apart (5 a second at most), so jitter can never run up the score.
  - Out and in follow the tongue shape itself: out = at least 3 tongue points on two frames in a row; in = no tongue shape for 90 ms. The shape dropping out for a frame or two does not split a lick, but fast licking (4 per second) still counts every one.
  - A tongue already out when the round starts does not flick; it has to go in and come out again. Its strokes still count.
  - Touching needs at least 3 tongue points inside the candy on two frames in a row, so a stray point or a one-frame flicker is not a lick.
  - While the face is lost the state is held, so a face that reappears with the tongue still out is not a new lick.
- **On screen.** The tongue shape is drawn as pink dots. The ring around the candy is green while the tongue touches it, yellow while the tongue is out but not touching, and dashed grey when the tongue is in. A white dot marks where the tongue touches the candy. Each lick shows "+1".

**Why scoring does not use the in/out cue counter.** An earlier version scored rises and falls of the mouth-fill cue with a touch during them. A tongue resting on the candy that moved slightly then scored again and again. A version that scored each new contact missed the opposite case: with the mouth right at the candy, the tongue never leaves the candy circle, so out-in-out was one contact. Counting out-episodes of the tongue shape that touch the candy covers both, and strokes add the licking that happens without the tongue going back in.

Calibration waits 1.2 s after Start or Play again so the mouth can settle, and the calibrated closed-lip gap only ever narrows, so a replay that starts mid-laugh corrects itself the first time the lips close.

## Lollipop reactions

A dent at the contact point that springs back, a damped wobble, a clearcoat "wetness" that dries over time, and the candy wearing down with each lick. All of it is dt-based with no per-frame allocation (`src/lollipop.js`).

## Tests

`npm test` runs 54 tests:

- lick scoring: every out-and-touch counts, including out and in with the mouth at the candy; a held tongue counts once, even with jitter; each stroke of a back-and-forth wipe counts, a long one-way sweep counts once, the tongue pushing in as it lands does not; a tongue already out at the start scores strokes but not a flick; a tongue that does not reach, stray points and one-frame blips do not count; never more than 5 a second; fast licking, 10 fps, reset;
- tongue points inside the candy on screen and where they touch it, the same on any screen size;

- fast trains (4 flicks/s, also at 10 fps), slow licks, licking that only half-retracts the tongue, a held tongue with jitter;
- hovering near the threshold, single-frame spikes;
- head movement, lost face, slow lighting drift, identical restarts;
- the mouth-fill cue with closed red lips, a tongue just covering the lips, the mouth open with no tongue, a tongue resting inside the mouth, and the lip landmark dragged onto the tongue;
- the same cue under neutral, warm, dim and too-dark light, and with a tilted head.

The page also exposes `render_game_to_text()` and `advanceTime(ms)` for deterministic browser checks in sim mode.

## Limits

- The counting rules are tested on synthetic signals; the colour rule on pixels measured from real phone frames. Bright and dark rooms, and other phones, still need their own frames checked.
- The colour thresholds come from one person and one phone (iPhone 11 Pro, warm indoor light). Other skin tones and light need their own frames checked; the lip-drag cue is the fallback.
