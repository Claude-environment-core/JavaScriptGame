/**
 * Slot tracking: the squad's only *preference*.
 *
 * One proportional term with feedforward of the slot's own velocity replaces the
 * four flocking behaviours it supersedes. The feedforward matters more than the
 * gain: slots move because the anchor moves and because the formation deforms,
 * and an agent that only chases where its slot *was* trails it permanently.
 */

import { add, scale, subtract, truncate } from "../vec2.js";

export function desiredVelocity(position, slot, slotVelocity, params) {
  const pull = scale(subtract(slot, position), params.trackingGain);
  return truncate(add(slotVelocity, pull), params.maxSpeed);
}

/** Bounds how fast an agent may change velocity. */
export function accelerationLimited(velocity, desired, dt, params) {
  const change = truncate(subtract(desired, velocity), params.maxAcceleration * dt);
  return add(velocity, change);
}
