/**
 * RTS prototype — public entry point.
 *
 * A strategic map of territories, four factions, and a commander per faction
 * that hands its strategic calls to a decision model (Jev, or the local
 * heuristic). See `docs/rts-decision-models.md` for the design.
 */

export * from "./config.js";
export * from "./mapGen.js";
export * from "./world.js";
export * from "./match.js";
export * from "./decisions/decisionsApi.js";
export * from "./decisions/heuristic.js";
export * from "./decisions/commander.js";
