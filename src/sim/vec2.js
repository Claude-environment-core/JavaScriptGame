/**
 * Minimal 2D vector math used by the whole simulation.
 *
 * All vectors are plain `{ x, y }` objects. Every helper returns a new object,
 * so callers never share mutable state by accident.
 */

export function vec2(x = 0, y = 0) {
  return { x, y };
}

export function clone(v) {
  return { x: v.x, y: v.y };
}

export function add(a, b) {
  return { x: a.x + b.x, y: a.y + b.y };
}

export function subtract(a, b) {
  return { x: a.x - b.x, y: a.y - b.y };
}

export function scale(v, scalar) {
  return { x: v.x * scalar, y: v.y * scalar };
}

export function magnitude(v) {
  return Math.hypot(v.x, v.y);
}

export function sqrMagnitude(v) {
  return v.x * v.x + v.y * v.y;
}

export function normalize(v) {
  const length = Math.hypot(v.x, v.y);
  if (length === 0) {
    return { x: 0, y: 0 };
  }

  return { x: v.x / length, y: v.y / length };
}

export function dot(a, b) {
  return a.x * b.x + a.y * b.y;
}

export function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * Clamps a vector's magnitude without changing its direction.
 */
export function truncate(v, maxMagnitude) {
  const length = Math.hypot(v.x, v.y);
  if (length <= maxMagnitude || length === 0) {
    return { x: v.x, y: v.y };
  }

  const factor = maxMagnitude / length;
  return { x: v.x * factor, y: v.y * factor };
}

/**
 * Right-hand perpendicular of a forward vector.
 *
 * Formation offsets are authored in local space where `+y` is "towards the
 * facing direction" and `+x` is "to the right of the facing direction".
 */
export function rightOf(forward) {
  return { x: forward.y, y: -forward.x };
}

/**
 * 2D local-to-world rotation for formation offsets.
 *
 * `world = origin + right * local.x + forward * local.y`
 */
export function localToWorld(origin, forward, localOffset) {
  const f = normalize(forward);
  const r = rightOf(f);

  return {
    x: origin.x + r.x * localOffset.x + f.x * localOffset.y,
    y: origin.y + r.y * localOffset.x + f.y * localOffset.y,
  };
}

/**
 * Moves `from` towards `to` by at most `maxDistance` units.
 */
export function moveTowards(from, to, maxDistance) {
  const delta = subtract(to, from);
  const length = magnitude(delta);

  if (length <= maxDistance || length === 0) {
    return clone(to);
  }

  return add(from, scale(delta, maxDistance / length));
}
