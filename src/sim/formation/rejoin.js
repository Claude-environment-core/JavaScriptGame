/**
 * Getting back to the formation when it is no longer in sight.
 *
 * Slot tracking pulls an agent straight at its slot, which is the right thing
 * whenever the agent can see it. An agent separated from its slot by a wall —
 * left behind at a doorway, pushed into a side room — would instead press
 * against that wall forever, and the coherence gate would hold the whole squad
 * back waiting for it.
 *
 * Such an agent needs a route, not a pull. This is the only part of the
 * simulation where an individual agent plans for itself, and it plans only
 * until it can see its slot again.
 */

import { findPath, pathToWaypoints } from "../pathfinding.js";
import { hasLineOfSight } from "../gridMap.js";
import { distance } from "../vec2.js";

export class RejoinRoute {
  constructor() {
    this.waypoints = [];
    this.destination = null;
  }

  get isActive() {
    return this.waypoints.length > 0;
  }

  clear() {
    this.waypoints = [];
    this.destination = null;
  }

  /**
   * True when the stored route no longer leads anywhere useful.
   */
  isStale(slot, tolerance) {
    return !this.isActive || !this.destination || distance(this.destination, slot) > tolerance;
  }

  plan(map, from, slot) {
    const path = findPath(map, map.worldToGrid(from), map.worldToGrid(slot));

    if (!path) {
      this.clear();
      return false;
    }

    this.waypoints = pathToWaypoints(map, path);
    this.destination = { x: slot.x, y: slot.y };
    return true;
  }

  /**
   * Drops waypoints already reached and returns the next one to steer at.
   */
  advance(position, captureRadius) {
    while (
      this.waypoints.length > 1 &&
      distance(position, this.waypoints[1]) <= distance(position, this.waypoints[0])
    ) {
      this.waypoints.shift();
    }

    while (this.waypoints.length > 0 && distance(position, this.waypoints[0]) < captureRadius) {
      this.waypoints.shift();
    }

    return this.waypoints[0] ?? null;
  }
}

/**
 * Where an agent should actually steer, and how fast its target is moving.
 *
 * An agent that can see its slot tracks it directly, feedforward and all. One
 * that cannot follows a route until it can.
 */
export function rejoinTarget({ map, position, slot, slotVelocity, route, params }) {
  if (!map || hasLineOfSight(map, position, slot)) {
    route.clear();
    return { target: slot, velocity: slotVelocity };
  }

  if (route.isStale(slot, params.rejoinReplanDistance) && !route.plan(map, position, slot)) {
    // No route at all: fall back to pulling at the slot and let the constraint
    // layer stop the agent from walking into whatever is in the way.
    return { target: slot, velocity: slotVelocity };
  }

  const carrot = route.advance(position, params.waypointCaptureRadius);
  return carrot
    ? { target: carrot, velocity: { x: 0, y: 0 } }
    : { target: slot, velocity: slotVelocity };
}
