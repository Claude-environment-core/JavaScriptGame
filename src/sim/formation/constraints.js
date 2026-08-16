/**
 * Constraints filter the desired velocity; they never compete with it.
 *
 * Each constraint is a half-plane: an outward normal `n` and the fastest the
 * agent may still approach along it. Violations are removed by projection —
 * subtract only the offending component — so an agent keeps every part of its
 * intended motion that the constraint permits. Sliding along a wall toward a
 * doorway falls out of that for free.
 *
 * The difference from a repulsion force is categorical: a force can be outvoted
 * by a larger force, and a projection cannot be outvoted at all.
 */

import { CELL_SIZE, nearestPointOnTile } from "../gridMap.js";
import { personalSpace } from "./params.js";
import { add, dot, magnitude, normalize, scale, subtract, truncate } from "../vec2.js";

/** Direction out of a tile an agent has ended up inside of. */
function escapeNormal(position, cellX, cellY) {
  const away = normalize(subtract(position, { x: cellX + 0.5, y: cellY + 0.5 }));
  return away.x === 0 && away.y === 0 ? { x: 0, y: -1 } : away;
}

/**
 * Wall constraints: one per nearby blocked tile, including out-of-bounds tiles.
 *
 * The permitted approach speed is exactly the speed that would close the
 * remaining gap in one tick, so an agent may skim a wall but not enter it.
 */
export function wallConstraints(position, map, dt, params) {
  const constraints = [];

  if (!map) {
    return constraints;
  }

  const influence = params.bodyRadius + params.wallLookahead + params.maxSpeed * dt;
  const reach = Math.ceil(influence / CELL_SIZE) + 1;
  const cellX = Math.floor(position.x / CELL_SIZE);
  const cellY = Math.floor(position.y / CELL_SIZE);

  for (let y = cellY - reach; y <= cellY + reach; y += 1) {
    for (let x = cellX - reach; x <= cellX + reach; x += 1) {
      if (map.isWalkable(x, y)) {
        continue;
      }

      const nearest = nearestPointOnTile({ x, y }, position);
      const away = subtract(position, nearest);
      const gap = magnitude(away);

      if (gap > influence) {
        continue;
      }

      // Dead centre of a tile the agent should not be in: escape along the
      // shortest way out rather than dividing by zero.
      const normal = gap > 1e-6 ? scale(away, 1 / gap) : escapeNormal(position, x, y);

      constraints.push({
        normal,
        // Negative when already too close: the agent is then required to retreat.
        maxApproach: (gap - params.bodyRadius) / dt,
      });
    }
  }

  return constraints;
}

/**
 * Personal-space constraints against other agents.
 *
 * Responsibility is shared: each agent gives up half of the closing speed, which
 * keeps a pair symmetric without either needing to know the other's intent.
 */
export function neighborConstraints(index, agents, dt, params) {
  const constraints = [];
  const minimumGap = personalSpace(params);
  const influence = minimumGap + params.maxSpeed * dt;
  const position = agents[index].position;

  for (let i = 0; i < agents.length; i += 1) {
    if (i === index) {
      continue;
    }

    const away = subtract(position, agents[i].position);
    const gap = magnitude(away);

    if (gap > influence) {
      continue;
    }

    // Perfectly coincident agents get an arbitrary but stable split direction.
    const normal =
      gap > 1e-6 ? scale(away, 1 / gap) : normalize({ x: index - i, y: 1 });

    constraints.push({
      normal,
      maxApproach: (gap - minimumGap) / (2 * dt),
    });
  }

  return constraints;
}

/**
 * Nearest velocity to `velocity` that satisfies every constraint.
 *
 * Constraints are enforced by repeated projection rather than solved exactly;
 * a few passes converge for the small, mostly non-conflicting sets seen here,
 * and the result degrades gracefully when they do conflict.
 */
export function projectVelocity(velocity, constraints, params) {
  let result = velocity;

  for (let pass = 0; pass < params.constraintIterations; pass += 1) {
    let adjusted = false;

    for (const constraint of constraints) {
      const approach = -dot(result, constraint.normal);

      if (approach > constraint.maxApproach) {
        result = add(result, scale(constraint.normal, approach - constraint.maxApproach));
        adjusted = true;
      }
    }

    if (!adjusted) {
      break;
    }
  }

  return truncate(result, params.maxSpeed);
}
