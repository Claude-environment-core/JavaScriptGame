/**
 * Tunables for the deformable virtual structure.
 *
 * `bodyRadius` is the primary constant: agents have physical size, and personal
 * space, wall clearance, corridor margins and the deformation floor are all
 * derived from it rather than tuned independently.
 */
export const DEFAULT_FORMATION_PARAMS = Object.freeze({
  // Bodies and motion
  bodyRadius: 0.25,
  maxSpeed: 3,
  maxAcceleration: 8,

  // Personal space: two bodies plus a sliver, so contact is avoided rather than
  // merely detected. Every deformation floor is derived from this.
  personalSpaceMargin: 0.05,

  // Formation
  spacing: 1.2,
  trackingGain: 4.0,

  // Anchor and progression
  anchorSpeed: 2,
  anchorLookahead: 2.0,
  waypointCaptureRadius: 0.6,
  forwardSmoothing: 4.0,

  // Deformation
  clearanceHorizon: 5,
  clearanceProbeRange: 6,
  clearanceMargin: 0.1,
  clearanceSmoothing: 0.25,
  contractRate: 2.5,
  expandRate: 0.7,
  modeHysteresis: 0.2,

  // Coherence gate: the anchor slows for its own stragglers.
  maxSlotError: 2.5,
  coherenceStop: 0.3,
  coherenceGo: 0.75,
  minimumGate: 0.25,

  // Assignment
  switchingCost: 0.6,

  // Rejoining: how far a slot may drift before a straggler replans its route.
  rejoinReplanDistance: 1.5,

  // Constraints
  wallLookahead: 0.4,
  constraintIterations: 3,
});

export function makeFormationParams(overrides = {}) {
  return { ...DEFAULT_FORMATION_PARAMS, ...overrides };
}

/** Centre-to-centre distance two agents must keep. */
export function personalSpace(params) {
  return 2 * params.bodyRadius + params.personalSpaceMargin;
}
