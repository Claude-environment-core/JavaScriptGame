import { normalize } from "./vec2.js";

/**
 * Tile semantics: `0` is walkable, any non-zero value is blocked.
 */
export const TILE_WALKABLE = 0;
export const TILE_BLOCKED = 1;

/** World units per tile. */
export const CELL_SIZE = 1;

/**
 * 4-neighbour expansion order. Pathfinding tie-breaks depend on the order
 * neighbours are produced, so reordering this array changes every route.
 */
export const NEIGHBOR_OFFSETS = Object.freeze([
  Object.freeze({ x: 1, y: 0 }),
  Object.freeze({ x: -1, y: 0 }),
  Object.freeze({ x: 0, y: 1 }),
  Object.freeze({ x: 0, y: -1 }),
]);

export class GridMap {
  constructor(width, height, fill = TILE_WALKABLE) {
    this.width = width;
    this.height = height;
    this.tiles = new Uint8Array(width * height).fill(fill);
  }

  /** Builds a map from an array of rows (`rows[y][x]`). */
  static fromRows(rows) {
    const height = rows.length;
    const width = height > 0 ? rows[0].length : 0;
    const map = new GridMap(width, height);

    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        map.set(x, y, rows[y][x]);
      }
    }

    return map;
  }

  isInside(x, y) {
    return x >= 0 && y >= 0 && x < this.width && y < this.height;
  }

  get(x, y) {
    if (!this.isInside(x, y)) {
      return TILE_BLOCKED;
    }

    return this.tiles[x + y * this.width];
  }

  set(x, y, value) {
    if (!this.isInside(x, y)) {
      return;
    }

    this.tiles[x + y * this.width] = value;
  }

  /** Out-of-bounds is never walkable. */
  isWalkable(x, y) {
    return this.isInside(x, y) && this.tiles[x + y * this.width] === TILE_WALKABLE;
  }

  isWalkableWorld(point) {
    const cell = this.worldToGrid(point);
    return this.isWalkable(cell.x, cell.y);
  }

  /** 4-neighbour iterator in {@link NEIGHBOR_OFFSETS} order, bounds filtered. */
  *neighbors(x, y) {
    for (const offset of NEIGHBOR_OFFSETS) {
      const nx = x + offset.x;
      const ny = y + offset.y;

      if (this.isInside(nx, ny)) {
        yield { x: nx, y: ny };
      }
    }
  }

  /** Grid to world: the cell origin, with unit cell size. */
  gridToWorld(x, y) {
    return { x: x * CELL_SIZE, y: y * CELL_SIZE };
  }

  /** Centre of a cell in world space. */
  gridToWorldCenter(x, y) {
    return { x: (x + 0.5) * CELL_SIZE, y: (y + 0.5) * CELL_SIZE };
  }

  /** World to grid: `floor` on each axis. */
  worldToGrid(point) {
    return {
      x: Math.floor(point.x / CELL_SIZE),
      y: Math.floor(point.y / CELL_SIZE),
    };
  }

  /** Rows of tile values, `rows[y][x]`, for snapshots and debugging. */
  toRows() {
    const rows = [];
    for (let y = 0; y < this.height; y += 1) {
      const row = [];
      for (let x = 0; x < this.width; x += 1) {
        row.push(this.get(x, y));
      }
      rows.push(row);
    }

    return rows;
  }

  clone() {
    const copy = new GridMap(this.width, this.height);
    copy.tiles.set(this.tiles);
    return copy;
  }
}

/**
 * Grid-aware DDA traversal (Amanatides & Woo) from a world-space origin along a
 * direction, stopping at the first blocked tile or after `maxDistance`.
 *
 * Out-of-bounds counts as blocked, so a ray leaving the map reports a hit.
 *
 * @returns {{hit: boolean, cell: {x: number, y: number}, distance: number}}
 */
export function castRay(map, origin, direction, maxDistance) {
  const dir = normalize(direction);
  const miss = { hit: false, cell: null, distance: maxDistance };

  if (!map || (dir.x === 0 && dir.y === 0) || maxDistance <= 0) {
    return miss;
  }

  let cellX = Math.floor(origin.x / CELL_SIZE);
  let cellY = Math.floor(origin.y / CELL_SIZE);

  if (!map.isWalkable(cellX, cellY)) {
    return { hit: true, cell: { x: cellX, y: cellY }, distance: 0 };
  }

  const stepX = dir.x > 0 ? 1 : -1;
  const stepY = dir.y > 0 ? 1 : -1;

  const tDeltaX = dir.x === 0 ? Infinity : Math.abs(CELL_SIZE / dir.x);
  const tDeltaY = dir.y === 0 ? Infinity : Math.abs(CELL_SIZE / dir.y);

  // Distance along the ray to the first vertical / horizontal cell boundary.
  const originOffsetX = origin.x / CELL_SIZE - cellX;
  const originOffsetY = origin.y / CELL_SIZE - cellY;

  let tMaxX = dir.x === 0 ? Infinity : (dir.x > 0 ? 1 - originOffsetX : originOffsetX) * tDeltaX;
  let tMaxY = dir.y === 0 ? Infinity : (dir.y > 0 ? 1 - originOffsetY : originOffsetY) * tDeltaY;

  while (true) {
    let travelled;

    if (tMaxX < tMaxY) {
      cellX += stepX;
      travelled = tMaxX;
      tMaxX += tDeltaX;
    } else {
      cellY += stepY;
      travelled = tMaxY;
      tMaxY += tDeltaY;
    }

    if (travelled > maxDistance) {
      return miss;
    }

    if (!map.isWalkable(cellX, cellY)) {
      return { hit: true, cell: { x: cellX, y: cellY }, distance: travelled };
    }
  }
}

/**
 * True when a straight world-space segment crosses only walkable tiles.
 */
export function hasLineOfSight(map, from, to) {
  if (!map) {
    return true;
  }

  const delta = { x: to.x - from.x, y: to.y - from.y };
  const length = Math.hypot(delta.x, delta.y);

  if (length === 0) {
    return map.isWalkableWorld(from);
  }

  if (!map.isWalkableWorld(from) || !map.isWalkableWorld(to)) {
    return false;
  }

  return !castRay(map, from, delta, length).hit;
}

/** Nearest point of a tile's box to a world position. */
export function nearestPointOnTile(cell, point) {
  const minX = cell.x * CELL_SIZE;
  const minY = cell.y * CELL_SIZE;

  return {
    x: Math.min(Math.max(point.x, minX), minX + CELL_SIZE),
    y: Math.min(Math.max(point.y, minY), minY + CELL_SIZE),
  };
}
