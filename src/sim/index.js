/**
 * Simple3DPlayground simulation port — public entry point.
 *
 * The simulation is engine agnostic and entirely 2D: a tile map, A* routing,
 * waypoint progression gated on the whole squad arriving, and per-agent
 * steering from a weighted composition of flocking behaviours.
 */

export * from "./vec2.js";
export * from "./rng.js";
export * from "./gridMap.js";
export * from "./priorityQueue.js";
export * from "./pathfinding.js";
export * from "./formations.js";
export * from "./obstacleAvoidance.js";
export * from "./steering.js";
export * from "./agent.js";
export * from "./squad.js";
export * from "./worldGen.js";
export * from "./snapshot.js";
