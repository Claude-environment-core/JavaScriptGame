import { castRay, nearestPointOnTile } from "./gridMap.js";
import { add, magnitude, normalize, scale, subtract, truncate } from "./vec2.js";

/** Rays cast per evaluation. */
export const RAY_COUNT = 5;

/** Half-angle of the forward ray cone, in radians. */
export const CONE_HALF_ANGLE = 0.52;

/**
 * Even ray spacing across the cone:
 *
 *   t = i / (RAY_COUNT - 1)
 *   angle = CONE_HALF_ANGLE * (2 * t - 1)     // i = 0..4
 */
export function rayAngle(index) {
  const t = index / (RAY_COUNT - 1);
  return CONE_HALF_ANGLE * (2 * t - 1);
}

function rotate(v, angle) {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return { x: v.x * cos - v.y * sin, y: v.x * sin + v.y * cos };
}

/**
 * Obstacle avoidance force for one agent.
 *
 * Casts {@link RAY_COUNT} rays through a forward cone using grid-aware DDA
 * stepping. Every hit contributes a repulsion away from the nearest point of
 * the hit tile, growing as the obstacle gets closer. Out-of-bounds tiles count
 * as blocked, so heading off the map repels too.
 *
 * Returns a zero force when there is no map or the agent is not moving.
 */
export function computeObstacleAvoidance(position, velocity, map, params) {
  const zero = { x: 0, y: 0 };

  if (!map) {
    return zero;
  }

  const forward = normalize(velocity);
  if (forward.x === 0 && forward.y === 0) {
    return zero;
  }

  const radius = params.ObstacleAvoidanceRadius;
  let total = zero;

  for (let i = 0; i < RAY_COUNT; i += 1) {
    const direction = rotate(forward, rayAngle(i));
    const hit = castRay(map, position, direction, radius);

    if (!hit.hit) {
      continue;
    }

    const nearest = nearestPointOnTile(hit.cell, position);
    const away = subtract(position, nearest);
    const gap = magnitude(away);

    // Closer obstacles push harder; a hit at the radius contributes nothing.
    const closeness = Math.max(0, 1 - hit.distance / radius);
    const pushDirection = gap > 0 ? scale(away, 1 / gap) : scale(direction, -1);

    total = add(total, scale(pushDirection, closeness * params.MaxSteeringForce));
  }

  return truncate(total, params.MaxSteeringForce);
}
