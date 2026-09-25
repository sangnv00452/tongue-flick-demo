// Where the tongue is relative to the candy, on screen: how many tongue-shape points lie inside the
// candy's circle, where on the candy they are, and how far the nearest one is from its edge. All are
// measured in the same screen pixels, and the contact point in candy radii, so this holds on any
// screen size. Scoring is in lick-counter.js.
// Pure: screen pixel coordinates in, measurement out.

/**
 * `tongue` = tongue-shape points on screen, `candy` = { x, y, r } on screen.
 * Returns { inside, contact, distance }: points inside the candy; their centre relative to the candy's
 * centre in candy radii (null when none is inside); and the distance from the candy's edge to the
 * nearest tongue point (0 when any point is inside, Infinity when there is no tongue).
 */
export function tongueVsCandy(tongue, candy) {
  let inside = 0;
  let sx = 0;
  let sy = 0;
  let nearest = Infinity;
  for (const p of tongue) {
    const d = Math.hypot(p.x - candy.x, p.y - candy.y) - candy.r;
    if (d <= 0) {
      inside++;
      sx += p.x;
      sy += p.y;
    }
    nearest = Math.min(nearest, d);
  }
  const contact = inside ? { x: (sx / inside - candy.x) / candy.r, y: (sy / inside - candy.y) / candy.r } : null;
  return { inside, contact, distance: Math.max(0, nearest) };
}
