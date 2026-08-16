/**
 * Run recordings: a machine-comparable record of a simulation run, plus the
 * metrics that say whether the formation actually held.
 */

const DEFAULT_PRECISION = 6;

function round(value, precision) {
  const factor = 10 ** precision;
  return Math.round(value * factor) / factor;
}

function roundPoint(point, precision) {
  return { x: round(point.x, precision), y: round(point.y, precision) };
}

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
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

    this.metrics = {
      slotErrorTotal: 0,
      slotErrorSamples: 0,
      minimumAgentGap: Infinity,
      blockedTileEntries: 0,
      minimumScaleX: 1,
      fileTicks: 0,
      regroupTicks: 0,
    };
  }

  /** Records the current state. Call once per tick, after `tick(dt)`. */
  record(dt) {
    const index = this.tickIndex;
    this.tickIndex += 1;

    this.accumulateMetrics();

    if (index % this.everyNthTick !== 0) {
      return;
    }

    const controller = this.controller;
    const state = controller.state();

    this.ticks.push({
      tick: index,
      time: round(index * dt, this.precision),
      anchor: roundPoint(state.anchor, this.precision),
      centroid: roundPoint(state.centroid, this.precision),
      target: roundPoint(state.target, this.precision),
      coherence: round(state.coherence, this.precision),
      deformation: {
        shape: state.deformation.shape,
        mode: state.deformation.mode,
        scaleX: round(state.deformation.scaleX, this.precision),
        scaleY: round(state.deformation.scaleY, this.precision),
      },
      slots: state.slots.map((slot) => roundPoint(slot, this.precision)),
      assignment: [...state.assignment],
      agents: controller.agents.map((agent) => ({
        id: agent.id,
        position: roundPoint(agent.position, this.precision),
        velocity: roundPoint(agent.velocity, this.precision),
      })),
    });
  }

  accumulateMetrics() {
    const controller = this.controller;
    const agents = controller.agents;
    const metrics = this.metrics;

    for (let i = 0; i < agents.length; i += 1) {
      metrics.slotErrorTotal += distance(agents[i].position, controller.slotFor(i));
      metrics.slotErrorSamples += 1;

      if (controller.map && !controller.map.isWalkableWorld(agents[i].position)) {
        metrics.blockedTileEntries += 1;
      }

      for (let j = i + 1; j < agents.length; j += 1) {
        metrics.minimumAgentGap = Math.min(
          metrics.minimumAgentGap,
          distance(agents[i].position, agents[j].position),
        );
      }
    }

    metrics.minimumScaleX = Math.min(metrics.minimumScaleX, controller.deformation.scaleX);

    if (controller.deformation.mode === "File") {
      metrics.fileTicks += 1;
    }

    if (controller.isRegrouping) {
      metrics.regroupTicks += 1;
    }
  }

  /** Metrics for the run so far. */
  summary() {
    const metrics = this.metrics;
    const controller = this.controller;

    return {
      ticks: this.tickIndex,
      meanSlotError: metrics.slotErrorSamples
        ? round(metrics.slotErrorTotal / metrics.slotErrorSamples, 4)
        : 0,
      minimumAgentGap: Number.isFinite(metrics.minimumAgentGap)
        ? round(metrics.minimumAgentGap, 4)
        : null,
      blockedTileEntries: metrics.blockedTileEntries,
      minimumScaleX: round(metrics.minimumScaleX, 4),
      fileTicks: metrics.fileTicks,
      regroupTicks: metrics.regroupTicks,
      reassignments: controller.reassignments,
      finalCoherence: round(controller.coherence, 4),
    };
  }

  /** The full recording, ready to serialise with `JSON.stringify`. */
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
      metrics: this.summary(),
      ticks: this.ticks,
    };
  }
}

/**
 * Runs a controller for up to `maxTicks`, recording every tick.
 *
 * @returns {{snapshot: object, metrics: object, ticks: number, arrived: boolean}}
 */
export function runAndRecord(
  controller,
  { dt = 0.1, maxTicks = 1000, arrivalRadius = 2.0, ...options } = {},
) {
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

  return { snapshot: recorder.toJSON(), metrics: recorder.summary(), ticks, arrived };
}
