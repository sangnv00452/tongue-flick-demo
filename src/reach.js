// Where the tongue is relative to the candy, on screen: how many tongue-shape points lie inside the
// candy's circle, and how far the nearest one is from its edge. Both are in the same screen pixels,
// so this holds on any screen size. Scoring (contacts) is in contact-counter.js.
// Pure: screen pixel coordinates in, measurement out.

/**
 * `tongue` = tongue-shape points on screen, `candy` = { x, y, r } on screen.
 * Returns { inside, distance }: points inside the candy, and the distance from the candy's edge to the
 * nearest tongue point (0 when any point is inside, Infinity when there is no tongue).
 */
export function tongueVsCandy(tongue, candy) {
  let inside = 0;
  let nearest = Infinity;
  for (const p of tongue) {
    const d = Math.hypot(p.x - candy.x, p.y - candy.y) - candy.r;
    if (d <= 0) inside++;
    nearest = Math.min(nearest, d);
  }
  return { inside, distance: Math.max(0, nearest) };
}
