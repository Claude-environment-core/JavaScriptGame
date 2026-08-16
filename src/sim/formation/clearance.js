/**
 * How much room the group has, now and shortly.
 *
 * Two readings feed the deformation layer, and they do different jobs:
 *
 * - **Feedforward** — the route probe samples the path ahead, so the formation
 *   is already narrow when it reaches a doorway instead of discovering the wall
 *   on contact.
 * - **Feedback** — agents report the room they personally have, which catches
 *   what a centreline probe misses: pillars beside the route, the outside of a
 *   turn, anything that is not on the path itself.
 */

import { castRay, hasLineOfSight } from "../gridMap.js";
import { add, dot, normalize, rightOf, scale, subtract } from "../vec2.js";

/**
 * Shifts each waypoint to the middle of its corridor.
 *
 * A* returns *a* shortest path, which routinely hugs one wall of a corridor —
 * and a formation centred on a wall-hugging route reads half the room it
 * actually has, so it squeezes when it did not need to. Centring the route once,
 * at plan time, makes every later clearance reading honest.
 *
 * A shift is only accepted if the moved waypoint is still walkable and still
 * visible from where it started, so centring can never cut a corner.
 */
export function centreWaypoints(map, waypoints, { range = 6, maxShift = 1.5, skipAbove = 2.5 } = {}) {
  if (!map || waypoints.length === 0) {
    return waypoints;
  }

  return waypoints.map((waypoint, i) => {
    const previous = waypoints[i - 1] ?? waypoint;
    const next = waypoints[i + 1] ?? waypoint;
    const tangent = subtract(next, previous);

    if (tangent.x === 0 && tangent.y === 0) {
      return waypoint;
    }

    const reading = lateralClearance(map, waypoint, tangent, range);

    // Open ground has no centre worth finding, and nudging a route around a room
    // only makes it wander. Centring is for corridors.
    if (Math.min(reading.left, reading.right) >= skipAbove) {
      return waypoint;
    }

    const offset = (reading.right - reading.left) / 2;
    const shift = Math.max(-maxShift, Math.min(maxShift, offset));

    if (Math.abs(shift) < 1e-3) {
      return waypoint;
    }

    const moved = add(waypoint, scale(rightOf(normalize(tangent)), shift));
    return map.isWalkableWorld(moved) && hasLineOfSight(map, waypoint, moved) ? moved : waypoint;
  });
}

/** Free distance to either side of a point, measured across `tangent`. */
export function lateralClearance(map, point, tangent, range) {
  const direction = normalize(tangent);

  if (!map || (direction.x === 0 && direction.y === 0)) {
    return { left: range, right: range, width: 2 * range };
  }

  const normal = rightOf(direction);
  const rightHit = castRay(map, point, normal, range);
  const leftHit = castRay(map, point, scale(normal, -1), range);

  const right = rightHit.hit ? rightHit.distance : range;
  const left = leftHit.hit ? leftHit.distance : range;

  return { left, right, width: left + right };
}

/**
 * Narrowest crossing of the route within the look-ahead horizon.
 *
 * @returns {{width: number, samples: Array}} width is the tightest free width
 *   found; samples are kept for diagnostics and rendering.
 */
export function probeRoute(map, { anchor, forward, waypoints, horizon, range }) {
  const points = [anchor, ...waypoints.slice(0, horizon)];
  const samples = [];
  let width = Infinity;

  for (let i = 0; i < points.length; i += 1) {
    const next = points[i + 1];
    const tangent = next ? subtract(next, points[i]) : forward;
    const reading = lateralClearance(map, points[i], tangent, range);

    samples.push({ point: points[i], ...reading });
    width = Math.min(width, reading.width);
  }

  return { width, samples };
}

/**
 * Tightest half-width the agents can see, measured about the spine.
 *
 * The correction for each agent's own lateral offset is essential. Reading room
 * straight off an agent's position makes the formation measure its own width: an
 * agent that has spread out to the right sees less room to its right, the group
 * squeezes, the agent comes back in, the reading widens — and the formation
 * pumps between shapes forever. Adding the offset back cancels exactly that.
 *
 * @param {Array<{position: object, spine: {point: object, tangent: object}}>} samples
 */
export function probeAgents(map, samples, range) {
  let halfWidth = Infinity;

  for (const sample of samples) {
    const { point, tangent } = sample.spine;
    const reading = lateralClearance(map, sample.position, tangent, range);

    // Signed lateral offset of the agent from the spine, positive to the right.
    const offset = dot(subtract(sample.position, point), rightOf(normalize(tangent)));

    halfWidth = Math.min(halfWidth, offset + reading.right, reading.left - offset);
  }

  return halfWidth;
}
