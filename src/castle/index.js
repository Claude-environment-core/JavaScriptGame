/**
 * Castle level — public entry point.
 *
 * A procedurally generated castle that can be infiltrated or stormed: four
 * wards joined by chokepoints, a handful of justified weak points of which
 * only some are live, a garrison that reacts as a chain you can interrupt, and
 * a mission over the top of it. See `docs/castle-generation.md`.
 */

export * from "./wards.js";
export * from "./layout.js";
export * from "./vectors.js";
export * from "./patrol.js";
export * from "./garrison.js";
export * from "./mission.js";
export * from "./generate.js";
