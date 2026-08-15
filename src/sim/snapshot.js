/**
 * Parity snapshots: a machine-comparable record of a simulation run.
 *
 * A port is behaviour-compatible when it produces the same map tiles, the same
 * waypoint list, and per-tick agent positions/velocities within tolerance.
 */

const DEFAULT_PRECISION = 6;

function round(value, precision) {
  const factor = 10 ** precision;
  return Math.round(value * factor) / factor;
}

function roundPoint(point, precision) {
  return { x: round(point.x, precision), y: round(point.y, precision) };
}

export class SnapshotRecorder {
  constructor(controller, { precision = DEFAULT_PRECISION, everyNthTick = 1, label = "run" } = {}) {
    this.controller = controller;
    this.precision = precision;
    this.everyNthTick = Math.max(1, everyNthTick);
    this.label = label;
    this.tickIndex = 0;
    this.ticks = [];

    this.map = controller.map ? controller.map.toRows() : null;
    this.waypoints = controller.plan.waypoints.map((point) => roundPoint(point, precision));
    this.objective = roundPoint(controller.plan.objective, precision);
    this.path = controller.path ? controller.path.map((cell) => ({ x: cell.x, y: cell.y })) : null;
  }

  /** Records the current agent state. Call once per tick, after `tick(dt)`. */
  record(dt) {
    const index = this.tickIndex;
    this.tickIndex += 1;

    if (index % this.everyNthTick !== 0) {
      return;
    }

    this.ticks.push({
      tick: index,
      time: round(index * dt, this.precision),
      anchor: roundPoint(this.controller.anchor, this.precision),
      centroid: roundPoint(this.controller.centroid, this.precision),
      target: roundPoint(this.controller.plan.currentTarget, this.precision),
      agents: this.controller.agents.map((agent) => ({
        id: agent.id,
        position: roundPoint(agent.position, this.precision),
        velocity: roundPoint(agent.velocity, this.precision),
      })),
    });
  }

  /** The full snapshot, ready to serialise with `JSON.stringify`. */
  toJSON() {
    return {
      label: this.label,
      precision: this.precision,
      everyNthTick: this.everyNthTick,
      map: this.map,
      path: this.path,
      objective: this.objective,
      waypoints: this.waypoints,
      tickCount: this.tickIndex,
      ticks: this.ticks,
    };
  }
}

/**
 * Runs a controller for up to `maxTicks`, recording every tick.
 *
 * @returns {{snapshot: object, ticks: number, arrived: boolean}}
 */
export function runAndRecord(controller, { dt = 0.1, maxTicks = 1000, arrivalRadius = 2.0, ...options } = {}) {
  const recorder = new SnapshotRecorder(controller, options);
  let arrived = false;
  let ticks = 0;

  for (let i = 0; i < maxTicks; i += 1) {
    controller.tick(dt);
    recorder.record(dt);
    ticks = i + 1;

    if (controller.hasArrived(arrivalRadius)) {
      arrived = true;
      break;
    }
  }

  return { snapshot: recorder.toJSON(), ticks, arrived };
}
