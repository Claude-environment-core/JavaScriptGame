/**
 * Shared test worlds.
 *
 * Fixtures A and B exercise chokepoint traversal; C, D and E exercise the
 * deformation layer directly — squeezing into a corridor, widening out of one,
 * and holding shape through a turn.
 */

import { GridMap, TILE_BLOCKED, TILE_WALKABLE } from "../src/sim/gridMap.js";

/** Agents spawn a little more than personal space apart. */
function cluster(count, origin, step = 0.7) {
  return Array.from({ length: count }, (_, i) => ({ x: origin.x + i * step, y: origin.y }));
}

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
    startPositions: cluster(5, { x: 1.0, y: 1.5 }),
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
    startPositions: cluster(5, { x: 1.0, y: 3.5 }),
    goal: { x: 11, y: 12 },
    dt: 0.1,
    maxTicks: 2000,
    arrivalRadius: 2.0,
  };
}

/**
 * Fixture C: a long corridor between two open rooms.
 *
 * 40 x 20. Rooms at either end, joined by a `corridorWidth`-tile corridor along
 * the middle rows. The formation must narrow to enter and may open up again in
 * the far room.
 */
export function buildFixtureC({ corridorWidth = 1 } = {}) {
  const width = 40;
  const height = 20;
  const map = new GridMap(width, height, TILE_WALKABLE);

  const corridorTop = Math.floor((height - corridorWidth) / 2);
  const corridorBottom = corridorTop + corridorWidth - 1;

  // Solid divider between the rooms, with a corridor punched through it.
  for (let x = 14; x <= 26; x += 1) {
    for (let y = 0; y < height; y += 1) {
      map.set(x, y, TILE_BLOCKED);
    }

    for (let y = corridorTop; y <= corridorBottom; y += 1) {
      map.set(x, y, TILE_WALKABLE);
    }
  }

  border(map);

  return {
    map,
    corridor: { fromX: 14, toX: 26, top: corridorTop, bottom: corridorBottom, width: corridorWidth },
    startPositions: cluster(5, { x: 4.5, y: corridorTop + 0.5 }),
    goal: { x: 34, y: corridorTop + 0.5 },
    dt: 0.1,
    maxTicks: 1500,
    arrivalRadius: 2.0,
  };
}

/**
 * Fixture D: a corridor that widens in steps, 1 → 2 → 4 tiles.
 *
 * The formation should recover width monotonically as room appears.
 */
export function buildFixtureD() {
  const width = 44;
  const height = 16;
  const map = new GridMap(width, height, TILE_BLOCKED);

  const centre = 7;
  const segments = [
    { fromX: 1, toX: 14, halfWidth: 0 },
    { fromX: 15, toX: 27, halfWidth: 1 },
    { fromX: 28, toX: 42, halfWidth: 2 },
  ];

  for (const segment of segments) {
    for (let x = segment.fromX; x <= segment.toX; x += 1) {
      for (let y = centre - segment.halfWidth; y <= centre + segment.halfWidth; y += 1) {
        map.set(x, y, TILE_WALKABLE);
      }
    }
  }

  return {
    map,
    segments,
    centre,
    startPositions: cluster(5, { x: 2.5, y: centre + 0.5 }, 0.7),
    goal: { x: 41, y: centre + 0.5 },
    dt: 0.1,
    maxTicks: 1500,
    arrivalRadius: 2.0,
  };
}

/**
 * Fixture E: an L-shaped corridor, for formations turning a corner.
 */
export function buildFixtureE({ corridorWidth = 3 } = {}) {
  const size = 30;
  const map = new GridMap(size, size, TILE_BLOCKED);

  for (let x = 2; x < 20; x += 1) {
    for (let y = 4; y < 4 + corridorWidth; y += 1) {
      map.set(x, y, TILE_WALKABLE);
    }
  }

  for (let y = 4; y < 26; y += 1) {
    for (let x = 17; x < 17 + corridorWidth; x += 1) {
      map.set(x, y, TILE_WALKABLE);
    }
  }

  return {
    map,
    startPositions: cluster(5, { x: 3.5, y: 5.5 }, 0.7),
    goal: { x: 18.5, y: 24.5 },
    dt: 0.1,
    maxTicks: 1500,
    arrivalRadius: 2.0,
  };
}

/** An open map with no interior walls. */
export function buildOpenMap(width = 10, height = 10) {
  return new GridMap(width, height, TILE_WALKABLE);
}

/** A walled arena, so agents cannot wander off the edge of the world. */
export function buildArena(width = 30, height = 30) {
  const map = new GridMap(width, height, TILE_WALKABLE);
  border(map);
  return map;
}

function border(map) {
  for (let x = 0; x < map.width; x += 1) {
    map.set(x, 0, TILE_BLOCKED);
    map.set(x, map.height - 1, TILE_BLOCKED);
  }

  for (let y = 0; y < map.height; y += 1) {
    map.set(0, y, TILE_BLOCKED);
    map.set(map.width - 1, y, TILE_BLOCKED);
  }
}
