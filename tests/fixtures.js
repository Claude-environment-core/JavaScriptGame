/**
 * Self-contained parity fixtures from the simulation specification.
 *
 * These build their maps by hand rather than through world generation, so they
 * stay valid for any port regardless of RNG differences.
 */

import { GridMap, TILE_BLOCKED, TILE_WALKABLE } from "../src/sim/gridMap.js";

/**
 * Fixture A: a single chokepoint.
 *
 * 12 x 12 grid, a full horizontal wall on row 6 with one opening at (5, 6).
 */
export function buildFixtureA() {
  const map = new GridMap(12, 12, TILE_WALKABLE);

  for (let x = 0; x < 12; x += 1) {
    map.set(x, 6, TILE_BLOCKED);
  }
  map.set(5, 6, TILE_WALKABLE);

  return {
    map,
    opening: { x: 5, y: 6 },
    startPositions: Array.from({ length: 5 }, (_, i) => ({ x: 1.0 + i * 0.3, y: 1.0 })),
    goal: { x: 10, y: 10 },
    dt: 0.1,
    maxTicks: 1000,
    arrivalRadius: 2.0,
  };
}

/**
 * Fixture B: two sequential chokepoints.
 *
 * 14 x 16 grid, a vertical wall on column 5 with a door at (5, 3) and a
 * horizontal wall on row 8 with a door at (8, 8).
 */
export function buildFixtureB() {
  const map = new GridMap(14, 16, TILE_WALKABLE);

  for (let y = 0; y < 16; y += 1) {
    map.set(5, y, TILE_BLOCKED);
  }
  map.set(5, 3, TILE_WALKABLE);

  for (let x = 0; x < 14; x += 1) {
    map.set(x, 8, TILE_BLOCKED);
  }
  map.set(8, 8, TILE_WALKABLE);

  return {
    map,
    doorways: [
      { x: 5, y: 3 },
      { x: 8, y: 8 },
    ],
    startPositions: Array.from({ length: 5 }, (_, i) => ({ x: 1.0 + i * 0.3, y: 3.0 })),
    goal: { x: 11, y: 12 },
    dt: 0.1,
    maxTicks: 2000,
    arrivalRadius: 2.0,
  };
}

/** An open map with no interior walls, used by the avoidance sanity cases. */
export function buildOpenMap(width = 10, height = 10) {
  return new GridMap(width, height, TILE_WALKABLE);
}
