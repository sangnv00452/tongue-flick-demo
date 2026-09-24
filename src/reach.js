// Whether the tongue touches the candy: some point of the detected tongue shape lies inside the
// candy's circle on screen. Both are in the same screen pixels, so it holds on any screen size.
// The candy stays still; the player brings their mouth to it and licks.
// Pure: screen pixel coordinates in, verdict out.

/**
 * `tongue` = tongue-shape points on screen, `candy` = { x, y, r } on screen.
 * Returns { touching, distance }: distance is from the candy's edge to the nearest tongue point
 * (0 when touching, Infinity when there is no tongue).
 */
export function touchesCandy(tongue, candy) {
  let nearest = Infinity;
  for (const p of tongue) nearest = Math.min(nearest, Math.hypot(p.x - candy.x, p.y - candy.y) - candy.r);
  return { touching: nearest <= 0, distance: Math.max(0, nearest) };
}
