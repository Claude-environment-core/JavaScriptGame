/**
 * Squad simulation — public entry point.
 *
 * A tile world, A* routing, and a squad that holds a formation which deforms to
 * fit the space it is moving through. See `docs/deformable-virtual-structure.md`
 * for the design.
 */

export * from "./vec2.js";
export * from "./rng.js";
export * from "./gridMap.js";
export * from "./priorityQueue.js";
export * from "./pathfinding.js";
export * from "./worldGen.js";
export * from "./agent.js";
export * from "./player.js";
export * from "./squad.js";
export * from "./snapshot.js";

export * from "./formation/shape.js";
export * from "./formation/params.js";
export * from "./formation/clearance.js";
export * from "./formation/deformation.js";
export * from "./formation/assignment.js";
export * from "./formation/tracking.js";
export * from "./formation/constraints.js";
export * from "./formation/rejoin.js";
export * from "./formation/spine.js";
export * from "./formation/controller.js";
