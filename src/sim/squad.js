import { FormationType, getFormationSlots, DEFAULT_FORMATION_SPACING } from "./formations.js";
import { hasLineOfSight } from "./gridMap.js";
import { findPath, pathToWaypoints } from "./pathfinding.js";
import {
  DEFAULT_BEHAVIOR_ORDER,
  composeSteering,
  makeSteeringParams,
} from "./steering.js";
import {
  add,
  clone,
  distance,
  magnitude,
  moveTowards,
  normalize,
  scale,
  subtract,
  truncate,
  vec2,
} from "./vec2.js";

export const SquadState = Object.freeze({
  Advance: "Advance",
  Hold: "Hold",
  Regroup: "Regroup",
  Engage: "Engage",
});

/**
 * Full per-tick behaviour order: direct path attraction first, then the default
 * composition, then the centroid push.
 */
export const DEFAULT_TICK_BEHAVIOR_ORDER = Object.freeze([
  "PathAttraction",
  ...DEFAULT_BEHAVIOR_ORDER,
  "CentroidPush",
]);

/**
 * The squad's orders: where it is going, in what shape, along which waypoints.
 */
export class SquadPlan {
  constructor({
    state = SquadState.Advance,
    objective = vec2(),
    formation = FormationType.Wedge,
    waypoints = [],
  } = {}) {
    this.state = state;
    this.objective = clone(objective);
    this.formation = formation;
    this.waypoints = waypoints.map(clone);
  }

  /** First waypoint if one remains, otherwise the objective. */
  get currentTarget() {
    return this.waypoints.length > 0 ? this.waypoints[0] : this.objective;
  }

  get hasWaypoints() {
    return this.waypoints.length > 0;
  }

  /** Removes and returns the first waypoint. */
  consumeNextWaypoint() {
    return this.waypoints.shift() ?? null;
  }
}

/**
 * Drives one squad: waypoint progression, formation slots and per-agent
 * steering, in the order defined by the simulation model.
 */
export class SquadController {
  constructor({
    agents,
    plan,
    map = null,
    params = {},
    formationSpacing = DEFAULT_FORMATION_SPACING,
    behaviorOrder = DEFAULT_TICK_BEHAVIOR_ORDER,
    anchor = null,
  }) {
    this.agents = agents;
    this.plan = plan;
    this.map = map;
    this.params = makeSteeringParams(params);
    this.formationSpacing = formationSpacing;
    this.behaviorOrder = behaviorOrder;

    this.anchor = anchor ? clone(anchor) : this.computeCentroid();
    this.forward = normalize(subtract(plan.currentTarget, this.anchor));
    if (this.forward.x === 0 && this.forward.y === 0) {
      this.forward = vec2(0, 1);
    }

    this.slots = [];
    this.centroid = this.computeCentroid();
    this.farthestDistance = 0;
    this.ticks = 0;
  }

  computeCentroid() {
    if (this.agents.length === 0) {
      return vec2();
    }

    let total = vec2();
    for (const agent of this.agents) {
      total = add(total, agent.position);
    }

    return scale(total, 1 / this.agents.length);
  }

  /** Largest distance from any agent to a point. */
  farthestAgentDistance(target) {
    let farthest = 0;

    for (const agent of this.agents) {
      farthest = Math.max(farthest, distance(agent.position, target));
    }

    return farthest;
  }

  /** True when every agent is within `radius` of the objective. */
  hasArrived(radius = this.params.GroupArrivalRadius) {
    return this.farthestAgentDistance(this.plan.objective) <= radius;
  }

  /**
   * Advances the simulation by `dt` seconds.
   */
  tick(dt) {
    // 1. Resolve the active target waypoint.
    const target = this.plan.currentTarget;

    // 2. Move the virtual formation anchor towards it.
    this.anchor = moveTowards(this.anchor, target, this.params.FormationAnchorSpeed * dt);

    const toTarget = subtract(target, this.anchor);
    if (magnitude(toTarget) > 1e-6) {
      this.forward = normalize(toTarget);
    }

    // 3. Flock centroid and farthest-agent distance to the target.
    this.centroid = this.computeCentroid();
    this.farthestDistance = this.farthestAgentDistance(target);

    // 4. Advance the waypoint only when the whole squad is inside the radius.
    if (this.plan.hasWaypoints && this.farthestDistance < this.params.GroupArrivalRadius) {
      this.plan.consumeNextWaypoint();
    }

    // 5. Formation slots, rotated into world space.
    this.slots = getFormationSlots(
      this.plan.formation,
      this.agents.length,
      this.anchor,
      this.forward,
      this.formationSpacing,
    );

    // 6. A slot behind a wall is unreachable: fall back to the anchor.
    if (this.map) {
      this.slots = this.slots.map((slot) =>
        hasLineOfSight(this.map, this.anchor, slot) ? slot : clone(this.anchor),
      );
    }

    // 7. Read-only flock context shared by every behaviour.
    const context = this.buildContext(target);

    if (this.plan.state === SquadState.Hold) {
      return context;
    }

    // 8. Steering per agent, from the weighted behaviour composition.
    const steering = this.agents.map((_, index) =>
      composeSteering(index, context, this.params, this.behaviorOrder),
    );

    // 9. Integrate velocity and position, clamping speed.
    this.agents.forEach((agent, index) => {
      const velocity = truncate(
        add(agent.velocity, scale(steering[index], dt)),
        this.params.MaxSpeed,
      );

      agent.velocity = velocity;
      agent.position = add(agent.position, scale(velocity, dt));
    });

    this.ticks += 1;
    return context;
  }

  buildContext(target) {
    const context = {
      count: this.agents.length,
      positions: Object.freeze(this.agents.map((agent) => Object.freeze(clone(agent.position)))),
      velocities: Object.freeze(this.agents.map((agent) => Object.freeze(clone(agent.velocity)))),
      slots: Object.freeze(this.slots.map((slot) => Object.freeze(clone(slot)))),
      centroid: Object.freeze(clone(this.centroid)),
      anchor: Object.freeze(clone(this.anchor)),
      forward: Object.freeze(clone(this.forward)),
      target: Object.freeze(clone(target)),
      map: this.map,
    };

    return Object.freeze(context);
  }
}

/**
 * Plans a route with A* and returns a controller ready to tick.
 *
 * Returns `null` when no route exists between start and goal.
 */
export function createSquadController({
  agents,
  map,
  goal,
  start = null,
  formation = FormationType.Wedge,
  params = {},
  formationSpacing = DEFAULT_FORMATION_SPACING,
  behaviorOrder = DEFAULT_TICK_BEHAVIOR_ORDER,
}) {
  const controllerParams = makeSteeringParams(params);
  const startPoint =
    start ??
    scale(
      agents.reduce((total, agent) => add(total, agent.position), vec2()),
      1 / Math.max(1, agents.length),
    );

  const path = findPath(map, map.worldToGrid(startPoint), map.worldToGrid(goal));
  if (!path) {
    return null;
  }

  const waypoints = pathToWaypoints(map, path);
  const plan = new SquadPlan({
    state: SquadState.Advance,
    objective: clone(goal),
    formation,
    waypoints,
  });

  const controller = new SquadController({
    agents,
    plan,
    map,
    params: controllerParams,
    formationSpacing,
    behaviorOrder,
    anchor: startPoint,
  });

  controller.path = path;
  return controller;
}
