// Whether the tongue can reach the candy: a lick only scores when the mouth is within tongue's reach
// of the candy's edge on screen. The candy stays still; the player brings their mouth to it.
// Pure: screen pixel coordinates in, verdict out.

export const REACH = Object.freeze({
  /** How far a tongue sticks out past the lips on screen, in eye spans (eye corner to eye corner). */
  tongueEyeSpans: 0.7,
});

/**
 * `mouth` = centre of the gap between the lips, `eyeSpan` = eye corner distance (both screen px),
 * `candy` = { x, y, r } in screen px. Returns { inReach, gap } where gap is how far the mouth is
 * beyond reach (0 when in reach), in px.
 */
export function candyReach(mouth, eyeSpan, candy, o = REACH) {
  const d = Math.hypot(mouth.x - candy.x, mouth.y - candy.y);
  const limit = candy.r + o.tongueEyeSpans * eyeSpan;
  return { inReach: d <= limit, gap: Math.max(0, d - limit) };
}
