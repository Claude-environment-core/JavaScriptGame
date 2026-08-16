import { computeObstacleAvoidance } from "./obstacleAvoidance.js";
import {
  add,
  distance,
  magnitude,
  normalize,
  scale,
  subtract,
  truncate,
} from "./vec2.js";

/**
 * Default steering parameters. These values are parity critical — behaviour
 * composition is a weighted sum, so changing one changes every trajectory.
 */
export const DEFAULT_STEERING_PARAMS = Object.freeze({
  MaxSpeed: 3,
  MaxSteeringForce: 5,

  SeparationRadius: 1.5,
  SeparationWeight: 1.5,

  CohesionRadius: 5,
  CohesionWeight: 0.8,

  AlignmentRadius: 4,
  AlignmentWeight: 0.6,

  FormationSlotWeight: 1.4,
  PathAttractionWeight: 1.8,

  ObstacleAvoidanceRadius: 2,
  ObstacleAvoidanceWeight: 2.5,

  FormationAnchorSpeed: 2,
  PathArrivalRadius: 1,
  GroupArrivalRadius: 2.5,

  // Not part of the published defaults: the centroid push is described in the
  // tick pipeline without a weight, so this implementation picks a light one.
  CentroidPushWeight: 0.5,
});

/**
 * Default behaviour composition order. The sum is order-independent in exact
 * arithmetic but not in floating point, so the order is fixed.
 */
export const DEFAULT_BEHAVIOR_ORDER = Object.freeze([
  "Separation",
  "Cohesion",
  "Alignment",
  "FormationSlot",
  "ObstacleAvoidance",
]);

export function makeSteeringParams(overrides = {}) {
  return { ...DEFAULT_STEERING_PARAMS, ...overrides };
}

/**
 * Classic seek: full-speed desired velocity towards a target, minus current
 * velocity, clamped to the maximum steering force.
 */
export function seek(position, velocity, target, params) {
  const toTarget = subtract(target, position);
  const length = magnitude(toTarget);

  if (length === 0) {
    return { x: 0, y: 0 };
  }

  const desired = scale(toTarget, params.MaxSpeed / length);
  return truncate(subtract(desired, velocity), params.MaxSteeringForce);
}

/**
 * Seek with arrival damping inside `arrivalRadius`.
 */
export function arrive(position, velocity, target, arrivalRadius, params) {
  const toTarget = subtract(target, position);
  const length = magnitude(toTarget);

  if (length === 0) {
    return { x: 0, y: 0 };
  }

  const speed =
    arrivalRadius > 0 && length < arrivalRadius
      ? params.MaxSpeed * (length / arrivalRadius)
      : params.MaxSpeed;

  const desired = scale(toTarget, speed / length);
  return truncate(subtract(desired, velocity), params.MaxSteeringForce);
}

/** Push away from close neighbours, weighted by inverse distance. */
export function computeSeparation(index, context, params) {
  const position = context.positions[index];
  let total = { x: 0, y: 0 };
  let count = 0;

  for (let i = 0; i < context.count; i += 1) {
    if (i === index) {
      continue;
    }

    const other = context.positions[i];
    const gap = distance(position, other);

    if (gap > 0 && gap < params.SeparationRadius) {
      total = add(total, scale(subtract(position, other), 1 / (gap * gap)));
      count += 1;
    }
  }

  if (count === 0 || (total.x === 0 && total.y === 0)) {
    return { x: 0, y: 0 };
  }

  const desired = scale(normalize(total), params.MaxSpeed);
  return truncate(subtract(desired, context.velocities[index]), params.MaxSteeringForce);
}

/** Steer towards the centre of nearby neighbours. */
export function computeCohesion(index, context, params) {
  const position = context.positions[index];
  let total = { x: 0, y: 0 };
  let count = 0;

  for (let i = 0; i < context.count; i += 1) {
    if (i === index) {
      continue;
    }

    const other = context.positions[i];
    if (distance(position, other) < params.CohesionRadius) {
      total = add(total, other);
      count += 1;
    }
  }

  if (count === 0) {
    return { x: 0, y: 0 };
  }

  const center = scale(total, 1 / count);
  return seek(position, context.velocities[index], center, params);
}

/** Match the heading of nearby neighbours. */
export function computeAlignment(index, context, params) {
  const position = context.positions[index];
  let total = { x: 0, y: 0 };
  let count = 0;

  for (let i = 0; i < context.count; i += 1) {
    if (i === index) {
      continue;
    }

    if (distance(position, context.positions[i]) < params.AlignmentRadius) {
      total = add(total, context.velocities[i]);
      count += 1;
    }
  }

  if (count === 0 || (total.x === 0 && total.y === 0)) {
    return { x: 0, y: 0 };
  }

  const desired = scale(normalize(total), params.MaxSpeed);
  return truncate(subtract(desired, context.velocities[index]), params.MaxSteeringForce);
}

/** Hold the assigned formation slot. */
export function computeFormationSlot(index, context, params) {
  const slot = context.slots[index];
  if (!slot) {
    return { x: 0, y: 0 };
  }

  return arrive(
    context.positions[index],
    context.velocities[index],
    slot,
    params.PathArrivalRadius,
    params,
  );
}

/** Cone raycast avoidance against the map. */
export function computeObstacleAvoidanceBehavior(index, context, params) {
  return computeObstacleAvoidance(
    context.positions[index],
    context.velocities[index],
    context.map,
    params,
  );
}

/** Steer straight at the squad's active waypoint. */
export function computePathAttraction(index, context, params) {
  const target = context.target;

  if (!target) {
    return { x: 0, y: 0 };
  }

  return arrive(
    context.positions[index],
    context.velocities[index],
    target,
    params.PathArrivalRadius,
    params,
  );
}

/**
 * Keeps agents from piling onto the flock centroid, which otherwise happens
 * where cohesion and formation pull collide — chokepoints, mostly.
 */
export function computeCentroidPush(index, context, params) {
  const position = context.positions[index];
  const away = subtract(position, context.centroid);
  const gap = magnitude(away);

  if (gap === 0 || gap >= params.SeparationRadius) {
    return { x: 0, y: 0 };
  }

  const strength = 1 - gap / params.SeparationRadius;
  const desired = scale(scale(away, 1 / gap), params.MaxSpeed * strength);
  return truncate(subtract(desired, context.velocities[index]), params.MaxSteeringForce);
}

const BEHAVIORS = Object.freeze({
  Separation: { compute: computeSeparation, weight: "SeparationWeight" },
  Cohesion: { compute: computeCohesion, weight: "CohesionWeight" },
  Alignment: { compute: computeAlignment, weight: "AlignmentWeight" },
  FormationSlot: { compute: computeFormationSlot, weight: "FormationSlotWeight" },
  ObstacleAvoidance: {
    compute: computeObstacleAvoidanceBehavior,
    weight: "ObstacleAvoidanceWeight",
  },
  PathAttraction: { compute: computePathAttraction, weight: "PathAttractionWeight" },
  CentroidPush: { compute: computeCentroidPush, weight: "CentroidPushWeight" },
});

/**
 * Weighted composition of the named behaviours, evaluated in list order and
 * clamped to `MaxSteeringForce`.
 */
export function composeSteering(index, context, params, order = DEFAULT_BEHAVIOR_ORDER) {
  let total = { x: 0, y: 0 };

  for (const name of order) {
    const behavior = BEHAVIORS[name];
    if (!behavior) {
      continue;
    }

    const force = behavior.compute(index, context, params);
    total = add(total, scale(force, params[behavior.weight]));
  }

  return truncate(total, params.MaxSteeringForce);
}
