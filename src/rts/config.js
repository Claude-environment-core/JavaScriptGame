/**
 * Tunables for the RTS prototype, kept in one place so the rules the strategy
 * layer is told about (see `commander.js`) and the rules the world actually
 * runs are the same numbers.
 */

export const RTS_DEFAULTS = Object.freeze({
  /** Map size in tiles. */
  width: 64,
  height: 64,
  /** Territories the passable ground is divided into. */
  regionCount: 26,
  /** Share of tiles that end up as impassable mountain or water. */
  blockedShare: 0.22,

  /** Tiles per second an army marches. */
  armySpeed: 3.2,
  /** Strength each side loses per second, per point of enemy strength. */
  lethality: 0.12,
  /** Damage multiplier for the side that owns the region being fought over. */
  defenderBonus: 1.3,
  /** Seconds an uncontested army needs to take a region. */
  captureSeconds: 3,
  /** Armies below this strength are destroyed. */
  minArmyStrength: 0.5,

  /** Garrison a region rebuilds per second while its owner holds it in peace. */
  garrisonRegen: 0.15,
  /** Garrison cap is `garrisonBase + income`. */
  garrisonBase: 1,

  /** Gold per second per point of income. */
  goldPerIncome: 0.25,
  /** Cost of raising an army, and the strength it is raised at. */
  recruitCost: 12,
  recruitStrength: 6,
  /** Strength a faction starts with at its capital. */
  startingStrength: 8,
  /** Army strength a faction can support per point of income; recruiting stops at the cap. */
  supplyPerIncome: 6,
  /** Most armies one faction may field (keeps a decision request bounded). */
  maxArmies: 6,

  /** Game seconds between strategic decisions for one faction. */
  decisionInterval: 3,
  /** A faction wins outright on holding this share of all regions. */
  dominationShare: 0.75,
});

export const FACTIONS = Object.freeze([
  Object.freeze({ id: "crimson", name: "Crimson", color: "#f87171" }),
  Object.freeze({ id: "azure", name: "Azure", color: "#60a5fa" }),
  Object.freeze({ id: "verdant", name: "Verdant", color: "#4ade80" }),
  Object.freeze({ id: "amber", name: "Amber", color: "#fbbf24" }),
]);
