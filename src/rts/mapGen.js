import { GridMap, NEIGHBOR_OFFSETS, TILE_BLOCKED, TILE_WALKABLE } from "../sim/gridMap.js";
import { findPath } from "../sim/pathfinding.js";
import { DeterministicRandom } from "../sim/rng.js";
import { RTS_DEFAULTS } from "./config.js";

/**
 * Strategic map generation.
 *
 * The map is a tile grid (so armies route with the same A* the squad uses)
 * carved into territories. Terrain comes first — value noise thresholded into
 * mountains and water — and territories are grown over what is left by a
 * multi-source flood fill, so a territory never spans a mountain range and two
 * territories are adjacent exactly when an army can walk from one to the other.
 */

export const Terrain = Object.freeze({
  PLAINS: 0,
  MOUNTAIN: 1,
  WATER: 2,
});

const NAME_HEADS = ["Ash", "Bram", "Cold", "Dun", "Ever", "Fen", "Gal", "Holl", "Iron", "Kes", "Lor", "Mar", "North", "Oak", "Pell", "Rook", "Salt", "Thorn", "Umber", "Vel", "West", "Yar"];
const NAME_TAILS = ["ford", "mere", "wick", "hold", "fell", "moor", "gate", "vale", "reach", "stead", "march", "barrow", "haven", "crest"];

/** Smooth value noise over the grid, in `[0, 1)`. */
function valueNoise(width, height, cell, rng) {
  const gw = Math.ceil(width / cell) + 2;
  const gh = Math.ceil(height / cell) + 2;
  const lattice = Array.from({ length: gw * gh }, () => rng.nextFloat());
  const smooth = (t) => t * t * (3 - 2 * t);
  const out = new Float32Array(width * height);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const fx = x / cell;
      const fy = y / cell;
      const ix = Math.floor(fx);
      const iy = Math.floor(fy);
      const tx = smooth(fx - ix);
      const ty = smooth(fy - iy);
      const at = (gx, gy) => lattice[gx + gy * gw];
      const top = at(ix, iy) * (1 - tx) + at(ix + 1, iy) * tx;
      const bottom = at(ix, iy + 1) * (1 - tx) + at(ix + 1, iy + 1) * tx;
      out[x + y * width] = top * (1 - ty) + bottom * ty;
    }
  }

  return out;
}

/** Keeps only the largest 4-connected walkable component; the rest is blocked. */
function keepLargestComponent(map, terrain) {
  const label = new Int32Array(map.width * map.height).fill(-1);
  let best = { id: -1, size: 0 };
  let next = 0;

  for (let start = 0; start < label.length; start += 1) {
    if (label[start] !== -1 || map.tiles[start] !== TILE_WALKABLE) {
      continue;
    }

    const stack = [start];
    label[start] = next;
    let size = 0;

    while (stack.length > 0) {
      const index = stack.pop();
      size += 1;
      const x = index % map.width;
      const y = Math.floor(index / map.width);

      for (const offset of NEIGHBOR_OFFSETS) {
        const nx = x + offset.x;
        const ny = y + offset.y;
        const ni = nx + ny * map.width;
        if (map.isWalkable(nx, ny) && label[ni] === -1) {
          label[ni] = next;
          stack.push(ni);
        }
      }
    }

    if (size > best.size) {
      best = { id: next, size };
    }
    next += 1;
  }

  for (let i = 0; i < label.length; i += 1) {
    if (map.tiles[i] === TILE_WALKABLE && label[i] !== best.id) {
      map.tiles[i] = TILE_BLOCKED;
      terrain[i] = Terrain.MOUNTAIN;
    }
  }
}

/** Picks region seeds spread out over the walkable ground (dart throwing with a shrinking radius). */
function pickSeeds(map, count, rng) {
  const walkable = [];
  for (let y = 0; y < map.height; y += 1) {
    for (let x = 0; x < map.width; x += 1) {
      if (map.isWalkable(x, y)) {
        walkable.push({ x, y });
      }
    }
  }

  const seeds = [];
  let radius = Math.sqrt(walkable.length / count) * 0.95;

  while (seeds.length < count && radius > 1) {
    for (let attempt = 0; attempt < 400 && seeds.length < count; attempt += 1) {
      const candidate = walkable[rng.nextInt(0, walkable.length)];
      const clear = seeds.every((s) => Math.hypot(s.x - candidate.x, s.y - candidate.y) >= radius);
      if (clear) {
        seeds.push(candidate);
      }
    }
    radius *= 0.85;
  }

  return seeds;
}

/** Grows every seed outward one ring at a time; each tile joins the first region to reach it. */
function growRegions(map, seeds) {
  const owner = new Int32Array(map.width * map.height).fill(-1);
  let frontier = seeds.map((seed, id) => {
    owner[seed.x + seed.y * map.width] = id;
    return seed;
  });

  while (frontier.length > 0) {
    const nextFrontier = [];
    for (const cell of frontier) {
      const id = owner[cell.x + cell.y * map.width];
      for (const offset of NEIGHBOR_OFFSETS) {
        const nx = cell.x + offset.x;
        const ny = cell.y + offset.y;
        if (map.isWalkable(nx, ny) && owner[nx + ny * map.width] === -1) {
          owner[nx + ny * map.width] = id;
          nextFrontier.push({ x: nx, y: ny });
        }
      }
    }
    frontier = nextFrontier;
  }

  return owner;
}

/** Hop distances from one region to every other over the adjacency graph. */
export function regionHops(regions, fromId) {
  const hops = new Array(regions.length).fill(Infinity);
  hops[fromId] = 0;
  const queue = [fromId];

  while (queue.length > 0) {
    const id = queue.shift();
    for (const next of regions[id].neighbors) {
      if (hops[next] === Infinity) {
        hops[next] = hops[id] + 1;
        queue.push(next);
      }
    }
  }

  return hops;
}

/** Farthest-point selection over hop distance, so capitals start as far apart as the graph allows. */
function pickCapitals(regions, count, rng) {
  const capitals = [rng.nextInt(0, regions.length)];
  const hopsFrom = new Map([[capitals[0], regionHops(regions, capitals[0])]]);

  // Re-anchor on the region farthest from the random start, so the first capital is on the rim too.
  const first = hopsFrom.get(capitals[0]);
  capitals[0] = first.indexOf(Math.max(...first.filter(Number.isFinite)));
  hopsFrom.clear();
  hopsFrom.set(capitals[0], regionHops(regions, capitals[0]));

  while (capitals.length < count) {
    let best = -1;
    let bestScore = -1;
    for (const region of regions) {
      if (capitals.includes(region.id)) {
        continue;
      }
      const nearest = Math.min(...capitals.map((c) => hopsFrom.get(c)[region.id]));
      if (nearest > bestScore) {
        bestScore = nearest;
        best = region.id;
      }
    }
    capitals.push(best);
    hopsFrom.set(best, regionHops(regions, best));
  }

  return capitals;
}

function regionName(rng, used) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const name = NAME_HEADS[rng.nextInt(0, NAME_HEADS.length)] + NAME_TAILS[rng.nextInt(0, NAME_TAILS.length)];
    if (!used.has(name)) {
      used.add(name);
      return name;
    }
  }
  const fallback = `Region ${used.size + 1}`;
  used.add(fallback);
  return fallback;
}

/**
 * Generates a strategic map.
 *
 * @returns {{
 *   map: GridMap, terrain: Uint8Array, regionOf: Int32Array,
 *   regions: Array<{id: number, name: string, center: {x: number, y: number}, tiles: number,
 *     income: number, neighbors: number[]}>,
 *   capitals: number[], routes: Map<string, Array<{x: number, y: number}>>
 * }}
 */
export function generateStrategicMap({
  width = RTS_DEFAULTS.width,
  height = RTS_DEFAULTS.height,
  regionCount = RTS_DEFAULTS.regionCount,
  blockedShare = RTS_DEFAULTS.blockedShare,
  factionCount = 4,
  seed = 0,
} = {}) {
  const rng = new DeterministicRandom(seed);
  const map = new GridMap(width, height);
  const terrain = new Uint8Array(width * height);

  const relief = valueNoise(width, height, 9, rng);
  const detail = valueNoise(width, height, 4, rng);
  const height01 = relief.map((v, i) => v * 0.75 + detail[i] * 0.25);

  // Blocked ground is split between the low end (water) and the high end (mountains).
  const sorted = Array.from(height01).sort((a, b) => a - b);
  const waterLevel = sorted[Math.floor(sorted.length * blockedShare * 0.5)];
  const peakLevel = sorted[Math.floor(sorted.length * (1 - blockedShare * 0.5))];

  for (let i = 0; i < height01.length; i += 1) {
    const x = i % width;
    const y = Math.floor(i / width);
    const edge = x === 0 || y === 0 || x === width - 1 || y === height - 1;
    if (edge || height01[i] >= peakLevel) {
      terrain[i] = Terrain.MOUNTAIN;
    } else if (height01[i] < waterLevel) {
      terrain[i] = Terrain.WATER;
    }
    map.tiles[i] = terrain[i] === Terrain.PLAINS ? TILE_WALKABLE : TILE_BLOCKED;
  }

  keepLargestComponent(map, terrain);

  const seeds = pickSeeds(map, regionCount, rng);
  const regionOf = growRegions(map, seeds);
  const names = new Set();

  const regions = seeds.map((seedCell, id) => ({
    id,
    name: regionName(rng, names),
    center: { x: seedCell.x, y: seedCell.y },
    tiles: 0,
    income: 1 + rng.nextInt(0, 3),
    neighbors: [],
  }));

  const sums = regions.map(() => ({ x: 0, y: 0 }));
  const adjacency = regions.map(() => new Set());

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const id = regionOf[x + y * width];
      if (id < 0) {
        continue;
      }
      regions[id].tiles += 1;
      sums[id].x += x;
      sums[id].y += y;
      for (const offset of NEIGHBOR_OFFSETS) {
        const other = map.isInside(x + offset.x, y + offset.y) ? regionOf[x + offset.x + (y + offset.y) * width] : -1;
        if (other >= 0 && other !== id) {
          adjacency[id].add(other);
        }
      }
    }
  }

  // The rally point is the region's own tile nearest its centroid, so it is always inside and walkable.
  for (const region of regions) {
    const cx = sums[region.id].x / region.tiles;
    const cy = sums[region.id].y / region.tiles;
    let best = region.center;
    let bestDistance = Math.hypot(best.x - cx, best.y - cy);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        if (regionOf[x + y * width] === region.id) {
          const d = Math.hypot(x - cx, y - cy);
          if (d < bestDistance) {
            bestDistance = d;
            best = { x, y };
          }
        }
      }
    }
    region.center = best;
    region.neighbors = [...adjacency[region.id]].sort((a, b) => a - b);
  }

  const capitals = pickCapitals(regions, factionCount, rng);
  for (const id of capitals) {
    regions[id].income = 3;
  }

  // March routes between adjacent rally points, computed once.
  const routes = new Map();
  for (const region of regions) {
    for (const other of region.neighbors) {
      if (other > region.id) {
        const path = findPath(map, region.center, regions[other].center) ?? [];
        const waypoints = path.map((cell) => map.gridToWorldCenter(cell.x, cell.y));
        routes.set(`${region.id}>${other}`, waypoints);
        routes.set(`${other}>${region.id}`, [...waypoints].reverse());
      }
    }
  }

  return { map, terrain, regionOf, regions, capitals, routes };
}
