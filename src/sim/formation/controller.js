/**
 * The deformable virtual structure, assembled.
 *
 * Per tick, in strict order:
 *
 *   1. sense clearance ahead (feedforward) and around the agents (feedback)
 *   2. deform the formation to fit what was sensed
 *   3. advance the anchor, at a speed gated by how well the squad is holding
 *      formation, and centre it in the space available
 *   4. place slots, and measure how fast they are moving
 *   5. assign agents to slots
 *   6. track slots, then project the result onto what the world permits
 *
 * Each step consumes the one above it. Nothing is summed, so nothing competes.
 */

import { hasLineOfSight } from "../gridMap.js";
import {
  add,
  clone,
  distance,
  magnitude,
  moveTowards,
  normalize,
  rightOf,
  scale,
  subtract,
  vec2,
} from "../vec2.js";
import { assignSlots, countReassignments } from "./assignment.js";
import { probeAgents, probeRoute } from "./clearance.js";
import { neighborConstraints, projectVelocity, wallConstraints } from "./constraints.js";
import { FormationDeformation, FormationMode } from "./deformation.js";
import { makeFormationParams, personalSpace } from "./params.js";
import { RejoinRoute, rejoinTarget } from "./rejoin.js";
import { FormationType } from "./shape.js";
import { AnchorTrail } from "./spine.js";
import { accelerationLimited, desiredVelocity } from "./tracking.js";

/** Smooth 0→1 ramp between two thresholds. */
function smoothstep(edge0, edge1, value) {
  if (edge1 <= edge0) {
    return value >= edge1 ? 1 : 0;
  }

  const t = Math.min(Math.max((value - edge0) / (edge1 - edge0), 0), 1);
  return t * t * (3 - 2 * t);
}

export class FormationController {
  constructor({ agents, plan, map = null, params = {}, formation = FormationType.Wedge, anchor = null }) {
    this.agents = agents;
    this.plan = plan;
    this.map = map;
    this.params = makeFormationParams(params);
    this.formationType = formation;

    this.deformation = new FormationDeformation(formation, agents.length, this.params);

    this.anchor = anchor ? clone(anchor) : this.computeCentroid();
    this.forward = normalize(subtract(plan.currentTarget, this.anchor));
    if (this.forward.x === 0 && this.forward.y === 0) {
      this.forward = vec2(0, 1);
    }

    this.trail = new AnchorTrail(this.anchor, this.trailLength(), map);
    this.slots = this.deformation.slots(this.trail, this.forward);
    this.previousSlots = this.slots.map(clone);
    this.assignment = this.agents.map((_, index) => index);
    this.rejoinRoutes = this.agents.map(() => new RejoinRoute());

    this.centroid = this.computeCentroid();
    this.coherence = this.measureCoherence();
    this.clearance = { width: Infinity, samples: [] };
    this.reassignments = 0;
    this.ticks = 0;
  }

  get mode() {
    return this.deformation.mode;
  }

  /** True while the squad is holding station to let stragglers rejoin. */
  get isRegrouping() {
    return this.coherence < this.params.coherenceStop;
  }

  computeCentroid() {
    if (this.agents.length === 0) {
      return vec2();
    }

    const total = this.agents.reduce((sum, agent) => add(sum, agent.position), vec2());
    return scale(total, 1 / this.agents.length);
  }

  /** Slot an agent currently holds. */
  slotFor(index) {
    return this.slots[this.assignment[index]];
  }

  /** How far each agent is from its slot, normalised into [0, 1]. */
  measureCoherence() {
    if (this.agents.length === 0) {
      return 1;
    }

    let total = 0;
    for (let i = 0; i < this.agents.length; i += 1) {
      total += distance(this.agents[i].position, this.slotFor(i));
    }

    const mean = total / this.agents.length;
    return 1 - Math.min(Math.max(mean / this.params.maxSlotError, 0), 1);
  }

  farthestAgentDistance(target) {
    return this.agents.reduce(
      (farthest, agent) => Math.max(farthest, distance(agent.position, target)),
      0,
    );
  }

  /**
   * A squad in formation arrives as a formation: its anchor reaches the
   * objective and it is still holding shape. Asking every agent to stand on the
   * objective would be asking the formation to collapse.
   */
  hasArrived(radius = this.params.waypointCaptureRadius) {
    return (
      !this.plan.hasWaypoints &&
      distance(this.anchor, this.plan.objective) <= radius &&
      this.coherence >= this.params.coherenceGo
    );
  }

  /** How far the formation extends from its anchor, at the current deformation. */
  formationExtent() {
    const lattice = this.deformation.active;
    const isBase = lattice === this.deformation.base;
    const scaleX = isBase ? this.deformation.scaleX : 1;
    const scaleY = isBase ? this.deformation.scaleY : 1;

    return lattice.offsets.reduce(
      (extent, offset) =>
        Math.max(
          extent,
          Math.hypot(offset.x * scaleX, offset.y * scaleY) * this.params.spacing,
        ),
      0,
    );
  }

  tick(dt) {
    const { params } = this;

    // 1. Sense.
    this.clearance = this.senseClearance();

    // 2. Deform.
    const shapeBefore = this.deformation.active;
    this.deformation.update(dt, this.clearance.availableHalfWidth);
    const shapeChanged = this.deformation.active !== shapeBefore;

    // 3. Advance the anchor, gated by last tick's coherence, and extend the
    //    spine it drags behind it.
    this.advanceAnchor(dt);
    this.trail.maxLength = this.trailLength();
    this.trail.push(this.anchor);

    // 4. Place slots and measure their motion.
    this.previousSlots = this.slots;
    this.slots = this.placeSlots();
    const slotVelocities = this.measureSlotVelocities(dt, shapeChanged);

    // 5. Assign.
    const next = assignSlots(
      this.agents.map((agent) => agent.position),
      this.slots,
      this.assignment,
      params.switchingCost,
    );
    this.reassignments += countReassignments(this.assignment, next);
    this.assignment = next;

    // 6. Track, then project onto what the world permits.
    const velocities = this.agents.map((agent, index) => {
      const slotIndex = this.assignment[index];
      const { target, velocity } = rejoinTarget({
        map: this.map,
        position: agent.position,
        slot: this.slots[slotIndex],
        slotVelocity: slotVelocities[slotIndex],
        route: this.rejoinRoutes[index],
        params,
      });

      const desired = desiredVelocity(agent.position, target, velocity, params);

      const limited = accelerationLimited(agent.velocity, desired, dt, params);
      const constraints = [
        ...wallConstraints(agent.position, this.map, dt, params),
        ...neighborConstraints(index, this.agents, dt, params),
      ];

      return projectVelocity(limited, constraints, params);
    });

    this.agents.forEach((agent, index) => {
      agent.velocity = velocities[index];
      agent.position = add(agent.position, scale(agent.velocity, dt));
    });

    this.centroid = this.computeCentroid();
    this.coherence = this.measureCoherence();
    this.ticks += 1;

    return this.state();
  }

  /**
   * Free half-width for slot centres: the tightest crossing found ahead, less
   * the room an agent's own body needs.
   *
   * The binding number is `min(left, right)` rather than half the total width —
   * a formation centred on the anchor extends both ways, so the nearer wall is
   * what limits it.
   */
  senseClearance() {
    const { params } = this;
    const route = probeRoute(this.map, {
      anchor: this.anchor,
      forward: this.forward,
      waypoints: this.plan.waypoints,
      horizon: params.clearanceHorizon,
      range: params.clearanceProbeRange,
    });

    let halfWidth = Infinity;
    for (const sample of route.samples) {
      halfWidth = Math.min(halfWidth, Math.min(sample.left, sample.right));
    }

    // Agents that have fallen out of formation do not get to reshape it: one
    // wedged in an alcove would otherwise pin the squad narrow while it rejoins.
    const samples = [];
    for (let i = 0; i < this.agents.length; i += 1) {
      const slotIndex = this.assignment[i];

      if (distance(this.agents[i].position, this.slots[slotIndex]) < params.maxSlotError * 0.5) {
        samples.push({
          position: this.agents[i].position,
          spine: this.spineReference(slotIndex),
        });
      }
    }

    halfWidth = Math.min(halfWidth, probeAgents(this.map, samples, params.clearanceProbeRange));

    return {
      ...route,
      availableHalfWidth: halfWidth - params.bodyRadius - params.clearanceMargin,
    };
  }

  /**
   * Moves the anchor along the route, at a speed gated by how well the squad is
   * holding formation.
   *
   * Steering at a look-ahead point rather than the next waypoint keeps the
   * heading smooth: aiming at a waypoint one step away makes the heading — and
   * therefore every slot — swing wildly as the anchor passes it.
   */
  advanceAnchor(dt) {
    const { params } = this;
    // The gate slows the squad for its stragglers; it never stops it. A squad
    // that cannot form up — boxed in, or split by geometry — must still make
    // progress, because moving is usually what resolves the situation.
    const gate =
      params.minimumGate +
      (1 - params.minimumGate) *
        smoothstep(params.coherenceStop, params.coherenceGo, this.coherence);
    const carrot = this.lookAheadPoint(params.anchorLookahead);

    this.anchor = moveTowards(this.anchor, carrot, params.anchorSpeed * gate * dt);

    this.consumeReachedWaypoints();

    const toCarrot = subtract(this.lookAheadPoint(params.anchorLookahead), this.anchor);
    if (magnitude(toCarrot) > 1e-6) {
      const desired = normalize(toCarrot);
      const blend = Math.min(1, params.forwardSmoothing * dt);
      const blended = add(scale(this.forward, 1 - blend), scale(desired, blend));
      this.forward = magnitude(blended) > 1e-6 ? normalize(blended) : desired;
    }
  }

  /**
   * Drops route waypoints the anchor has passed.
   *
   * A capture radius alone is not enough: steering at a look-ahead point makes
   * the anchor cut corners, so it can sweep past a waypoint outside the radius
   * and leave it in the list forever, dragging the carrot backwards. Advancing
   * while the *next* waypoint is closer than the current one is the standard
   * closest-point progression, and it cannot be outrun.
   */
  consumeReachedWaypoints() {
    const { waypoints } = this.plan;

    while (
      waypoints.length > 1 &&
      distance(this.anchor, waypoints[1]) <= distance(this.anchor, waypoints[0])
    ) {
      this.plan.consumeNextWaypoint();
    }

    while (
      this.plan.hasWaypoints &&
      distance(this.anchor, this.plan.currentTarget) < this.params.waypointCaptureRadius
    ) {
      this.plan.consumeNextWaypoint();
    }
  }

  /**
   * Furthest point on the route within `maxDistance` that the anchor can see.
   *
   * The line-of-sight test is what keeps the look-ahead from cutting a corner
   * through a wall: the carrot stops at the last waypoint in clear view.
   */
  lookAheadPoint(maxDistance) {
    const waypoints = this.plan.waypoints;

    if (waypoints.length === 0) {
      return this.plan.objective;
    }

    let carrot = waypoints[0];
    let travelled = distance(this.anchor, waypoints[0]);

    for (let i = 1; i < waypoints.length && travelled <= maxDistance; i += 1) {
      if (this.map && !hasLineOfSight(this.map, this.anchor, waypoints[i])) {
        break;
      }

      carrot = waypoints[i];
      travelled += distance(waypoints[i - 1], waypoints[i]);
    }

    return carrot;
  }

  /** Trail long enough to carry the whole formation, however far it stretches. */
  trailLength() {
    const lattice = this.deformation.base;
    const longest = this.degradedDepth();
    return Math.max(lattice.depth, longest) * this.params.spacing * this.params.maxSlotError;
  }

  degradedDepth() {
    return this.deformation.degraded ? this.deformation.degraded.depth : 0;
  }

  /**
   * Slots on the spine, with any slot behind a wall pulled in along its own
   * lateral offset until it reaches open space.
   *
   * Collapsing a blocked slot onto the anchor — the obvious fallback — stacks
   * the whole squad on one point, which no formation can hold and no personal
   * space allows. Shortening the offset keeps the formation's order intact.
   */
  placeSlots() {
    const slots = this.deformation.slots(this.trail, this.forward);

    if (!this.map) {
      return slots;
    }

    return slots.map((slot, index) => this.clampSlot(slot, index));
  }

  /** Point and heading on the spine that a slot hangs off. */
  spineReference(slotIndex) {
    const lattice = this.deformation.active;
    const scaleY = lattice === this.deformation.base ? this.deformation.scaleY : 1;
    const back = -lattice.offsets[slotIndex].y * scaleY * this.params.spacing;

    return this.trail.sample(Math.max(0, back), this.forward);
  }

  clampSlot(slot, index) {
    const { point } = this.spineReference(index);

    if (hasLineOfSight(this.map, point, slot)) {
      return slot;
    }

    // Walk the lateral offset back toward the spine until the slot is reachable.
    for (let fraction = 0.75; fraction >= 0.25; fraction -= 0.25) {
      const pulled = add(point, scale(subtract(slot, point), fraction));

      if (hasLineOfSight(this.map, point, pulled)) {
        return pulled;
      }
    }

    return point;
  }

  /**
   * Slot velocity, fed forward into tracking. Suppressed on the tick the shape
   * changes, when slots jump rather than move.
   */
  measureSlotVelocities(dt, shapeChanged) {
    if (shapeChanged || dt <= 0) {
      return this.slots.map(() => vec2());
    }

    return this.slots.map((slot, index) =>
      scale(subtract(slot, this.previousSlots[index] ?? slot), 1 / dt),
    );
  }

  /** Read-only view of the formation, for renderers, tests and snapshots. */
  state() {
    return Object.freeze({
      anchor: Object.freeze(clone(this.anchor)),
      forward: Object.freeze(clone(this.forward)),
      centroid: Object.freeze(clone(this.centroid)),
      target: Object.freeze(clone(this.plan.currentTarget)),
      slots: Object.freeze(this.slots.map((slot) => Object.freeze(clone(slot)))),
      assignment: Object.freeze([...this.assignment]),
      coherence: this.coherence,
      regrouping: this.isRegrouping,
      rejoining: Object.freeze(this.rejoinRoutes.map((route) => route.isActive)),
      deformation: Object.freeze(this.deformation.toJSON()),
      clearance: this.clearance.availableHalfWidth,
      personalSpace: personalSpace(this.params),
    });
  }
}

export { FormationMode, FormationType };
