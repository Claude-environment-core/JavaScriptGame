import { centreWaypoints } from "./formation/clearance.js";
import { FormationController } from "./formation/controller.js";
import { makeFormationParams } from "./formation/params.js";
import { FormationType } from "./formation/shape.js";
import { findPath, pathToWaypoints } from "./pathfinding.js";
import { add, clone, scale, vec2 } from "./vec2.js";

export const SquadState = Object.freeze({
  Advance: "Advance",
  Hold: "Hold",
  Regroup: "Regroup",
  Engage: "Engage",
});

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
}) {
  const controllerParams = makeFormationParams(params);
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

  const plan = new SquadPlan({
    state: SquadState.Advance,
    objective: clone(goal),
    formation,
    waypoints: centreWaypoints(map, pathToWaypoints(map, path), {
      range: controllerParams.clearanceProbeRange,
    }),
  });

  const controller = new FormationController({
    agents,
    plan,
    map,
    params: controllerParams,
    formation,
    anchor: startPoint,
  });

  controller.path = path;
  return controller;
}
