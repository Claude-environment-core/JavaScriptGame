/**
 * Tile geometry for a castle.
 *
 * The rule this module follows: build a castle that is *defensively coherent*
 * first, and let `vectors.js` cut the weak points into it afterwards. Nothing
 * here leaves a gap for the player. Concretely:
 *
 *   - Curtain walls are continuous rings. The only openings are gates.
 *   - The inner gate is never on the same side as the outer gate, so there is
 *     no straight run from open ground to the keep; an attacker has to cross
 *     a bailey lengthwise, under the walls, to reach the next door.
 *   - The keep door faces away from the inner gate, for the same reason.
 *   - Corner towers hold the approach in view, so open ground is not free.
 *
 * Everything is placed from one deterministic stream, in a fixed call order:
 * the same seed must always produce the same castle.
 */

import { GridMap, TILE_BLOCKED, TILE_WALKABLE } from "../sim/gridMap.js";

/**
 * Tile values. Anything non-zero is blocked as far as movement is concerned;
 * the distinct values exist so the renderer can tell masonry from a building
 * and so a weak section can be found again once it is written into the map.
 */
export const CastleTile = Object.freeze({
  Floor: TILE_WALKABLE,
  Bedrock: TILE_BLOCKED,
  Curtain: 2,
  InnerCurtain: 3,
  KeepWall: 4,
  Tower: 5,
  Structure: 6,
  /** Weathered masonry: blocked, but it can be brought down. */
  WeakMasonry: 7,
  /** A shut door: blocked until it is opened from one side or the other. */
  Door: 8,
});

/** Curtain walls have depth; interior walls are a single course. */
export const OUTER_CURTAIN_THICKNESS = 2;
export const INNER_CURTAIN_THICKNESS = 1;
export const KEEP_WALL_THICKNESS = 1;

export const SIDES = Object.freeze(["north", "east", "south", "west"]);

const OPPOSITE_SIDE = Object.freeze({
  north: "south",
  south: "north",
  east: "west",
  west: "east",
});

/** Unit vector pointing from a side into the enclosure it bounds. */
const INWARD = Object.freeze({
  north: { x: 0, y: 1 },
  south: { x: 0, y: -1 },
  east: { x: -1, y: 0 },
  west: { x: 1, y: 0 },
});

export function oppositeSide(side) {
  return OPPOSITE_SIDE[side];
}

export function inwardOf(side) {
  return INWARD[side];
}

export function rect(minX, minY, maxX, maxY) {
  return { minX, minY, maxX, maxY };
}

export function rectWidth(box) {
  return box.maxX - box.minX + 1;
}

export function rectHeight(box) {
  return box.maxY - box.minY + 1;
}

export function rectContains(box, x, y) {
  return x >= box.minX && x <= box.maxX && y >= box.minY && y <= box.maxY;
}

export function insetRect(box, amount) {
  return rect(box.minX + amount, box.minY + amount, box.maxX - amount, box.maxY - amount);
}

export function rectCenter(box) {
  return {
    x: Math.floor((box.minX + box.maxX) / 2),
    y: Math.floor((box.minY + box.maxY) / 2),
  };
}

/** Two boxes with `padding` tiles of air between them do not overlap. */
function rectsOverlap(a, b, padding = 0) {
  return (
    a.minX - padding <= b.maxX &&
    a.maxX + padding >= b.minX &&
    a.minY - padding <= b.maxY &&
    a.maxY + padding >= b.minY
  );
}

function fillRect(map, box, value) {
  for (let y = box.minY; y <= box.maxY; y += 1) {
    for (let x = box.minX; x <= box.maxX; x += 1) {
      map.set(x, y, value);
    }
  }
}

/** Draws a wall ring of the given thickness on the inside of `box`. */
function drawRing(map, box, thickness, value) {
  for (let t = 0; t < thickness; t += 1) {
    const ring = insetRect(box, t);

    for (let x = ring.minX; x <= ring.maxX; x += 1) {
      map.set(x, ring.minY, value);
      map.set(x, ring.maxY, value);
    }

    for (let y = ring.minY; y <= ring.maxY; y += 1) {
      map.set(ring.minX, y, value);
      map.set(ring.maxX, y, value);
    }
  }
}

/**
 * The tiles of one side of a wall ring, in order along the wall, as columns of
 * `thickness` tiles running from the outer face inwards.
 */
export function wallSideColumns(box, thickness, side) {
  const columns = [];

  if (side === "north" || side === "south") {
    const baseY = side === "north" ? box.minY : box.maxY;
    const step = side === "north" ? 1 : -1;

    for (let x = box.minX; x <= box.maxX; x += 1) {
      const column = [];
      for (let t = 0; t < thickness; t += 1) {
        column.push({ x, y: baseY + t * step });
      }
      columns.push(column);
    }

    return columns;
  }

  const baseX = side === "west" ? box.minX : box.maxX;
  const step = side === "west" ? 1 : -1;

  for (let y = box.minY; y <= box.maxY; y += 1) {
    const column = [];
    for (let t = 0; t < thickness; t += 1) {
      column.push({ x: baseX + t * step, y });
    }
    columns.push(column);
  }

  return columns;
}

/**
 * Cuts an opening `width` columns wide through a wall ring.
 *
 * `offset` indexes the ring's side columns, so callers place a gate by
 * position along the wall without caring which axis that wall runs on.
 */
export function carveOpening(map, box, thickness, side, offset, width, value = CastleTile.Floor) {
  const columns = wallSideColumns(box, thickness, side);
  const start = Math.min(Math.max(offset, 1), Math.max(1, columns.length - width - 1));
  const tiles = [];

  for (let i = start; i < start + width && i < columns.length; i += 1) {
    for (const cell of columns[i]) {
      map.set(cell.x, cell.y, value);
      tiles.push(cell);
    }
  }

  return tiles;
}

/** The tile just outside a set of opening tiles, on the approach side. */
function outsideOf(tiles, side) {
  const inward = INWARD[side];
  let extreme = tiles[0];

  for (const tile of tiles) {
    const projection = tile.x * -inward.x + tile.y * -inward.y;
    const best = extreme.x * -inward.x + extreme.y * -inward.y;
    if (projection > best) {
      extreme = tile;
    }
  }

  return { x: extreme.x - inward.x, y: extreme.y - inward.y };
}

/** The tile just inside a set of opening tiles. */
function insideOf(tiles, side) {
  const inward = INWARD[side];
  let extreme = tiles[0];

  for (const tile of tiles) {
    const projection = tile.x * inward.x + tile.y * inward.y;
    const best = extreme.x * inward.x + extreme.y * inward.y;
    if (projection > best) {
      extreme = tile;
    }
  }

  return { x: extreme.x + inward.x, y: extreme.y + inward.y };
}

/**
 * Buildings a working castle needs. Each one is here because it justifies
 * something: the cistern justifies a postern, the kitchen justifies a delivery
 * door, the barracks justifies the inner ward's garrison density.
 */
const STRUCTURE_PLAN = Object.freeze([
  { name: "barracks", ward: "inner", width: [7, 10], height: [5, 7], againstWall: false },
  { name: "kitchen", ward: "outer", width: [6, 8], height: [4, 6], againstWall: true },
  { name: "cistern", ward: "outer", width: [3, 4], height: [3, 4], againstWall: true },
  { name: "stables", ward: "outer", width: [7, 10], height: [4, 6], againstWall: false },
  { name: "workshop", ward: "outer", width: [5, 7], height: [4, 5], againstWall: false },
  { name: "granary", ward: "outer", width: [4, 6], height: [4, 6], againstWall: false },
  { name: "armoury", ward: "inner", width: [4, 6], height: [4, 5], againstWall: false },
  { name: "mill", ward: "approach", width: [4, 6], height: [3, 5], againstWall: false },
  { name: "woodpile", ward: "approach", width: [3, 5], height: [3, 4], againstWall: false },
  { name: "orchard-wall", ward: "approach", width: [5, 8], height: [2, 3], againstWall: false },
]);

/**
 * Generates the tile geometry.
 *
 * @returns the map, the rings it was built from, the sides the gates ended up
 *   on, the structures placed, and the landmarks later stages hang off.
 */
export function generateLayout({ width, height, random }) {
  const map = new GridMap(width, height, CastleTile.Floor);
  drawBorder(map);

  const bounds = rect(0, 0, width - 1, height - 1);

  // Ring depths scale with the map, so the same generator produces a readable
  // castle at test size and at play size.
  const span = Math.min(width, height);
  const approachDepth = Math.max(8, Math.round(span * random.nextRange(0.11, 0.16)));
  const outerRing = insetRect(bounds, approachDepth);
  const baileyDepth = Math.max(8, Math.round(span * random.nextRange(0.1, 0.15)));
  const innerRing = insetRect(outerRing, baileyDepth);

  drawRing(map, outerRing, OUTER_CURTAIN_THICKNESS, CastleTile.Curtain);
  drawRing(map, innerRing, INNER_CURTAIN_THICKNESS, CastleTile.InnerCurtain);

  const keepRing = placeKeep(random, innerRing);
  drawRing(map, keepRing, KEEP_WALL_THICKNESS, CastleTile.KeepWall);

  // Gates. The inner gate is drawn from the sides the outer gate is not on:
  // an attacker who takes the front door still has to cross the outer bailey.
  const outerGateSide = SIDES[random.nextInt(0, SIDES.length)];
  const innerGateSide = pickOtherSide(random, outerGateSide);
  const keepDoorSide = oppositeSide(innerGateSide);

  const outerGate = placeGate(map, random, outerRing, OUTER_CURTAIN_THICKNESS, outerGateSide, 2);
  const innerGate = placeGate(map, random, innerRing, INNER_CURTAIN_THICKNESS, innerGateSide, 2);
  const keepDoor = placeGate(map, random, keepRing, KEEP_WALL_THICKNESS, keepDoorSide, 1);

  const towers = placeTowers(map, outerRing);
  buildGatehouse(map, outerRing, outerGateSide, outerGate.tiles);

  const wardIndex = indexWards(map, { outerRing, innerRing, keepRing });
  const reservedTiles = [
    ...[outerGate, innerGate, keepDoor].flatMap((gate) => [...gate.tiles, gate.inside, gate.outside]),
    ...towers.map((tower) => tower.post),
  ];
  const structures = placeStructures(map, random, {
    wardIndex,
    bounds,
    outerRing,
    innerRing,
    keepRing,
    reservedTiles,
  });

  const princess = placePrincess(map, random, keepRing, keepDoor);
  const rally = pickRallyPoint(map, outerGate, outerGateSide, bounds);

  return {
    map,
    bounds,
    rings: { outer: outerRing, inner: innerRing, keep: keepRing },
    sides: { outerGate: outerGateSide, innerGate: innerGateSide, keepDoor: keepDoorSide },
    gates: { outer: outerGate, inner: innerGate, keep: keepDoor },
    towers,
    structures,
    wardIndex,
    landmarks: { princess, rally, towers, structures },
  };
}

function drawBorder(map) {
  for (let x = 0; x < map.width; x += 1) {
    map.set(x, 0, CastleTile.Bedrock);
    map.set(x, map.height - 1, CastleTile.Bedrock);
  }

  for (let y = 0; y < map.height; y += 1) {
    map.set(0, y, CastleTile.Bedrock);
    map.set(map.width - 1, y, CastleTile.Bedrock);
  }
}

function pickOtherSide(random, side) {
  const options = SIDES.filter((candidate) => candidate !== side);
  return options[random.nextInt(0, options.length)];
}

/** The keep sits inside the inner ward, offset rather than centred. */
function placeKeep(random, innerRing) {
  const interior = insetRect(innerRing, INNER_CURTAIN_THICKNESS + 3);
  const maxWidth = Math.min(20, rectWidth(interior));
  const maxHeight = Math.min(18, rectHeight(interior));
  const keepWidth = random.nextInt(Math.min(14, maxWidth), maxWidth + 1);
  const keepHeight = random.nextInt(Math.min(12, maxHeight), maxHeight + 1);

  const x = interior.minX + random.nextInt(0, Math.max(1, rectWidth(interior) - keepWidth + 1));
  const y = interior.minY + random.nextInt(0, Math.max(1, rectHeight(interior) - keepHeight + 1));

  return rect(x, y, x + keepWidth - 1, y + keepHeight - 1);
}

function placeGate(map, random, ring, thickness, side, gateWidth) {
  const columns = wallSideColumns(ring, thickness, side);
  const margin = Math.max(4, Math.floor(columns.length * 0.2));
  const offset = random.nextInt(margin, Math.max(margin + 1, columns.length - margin - gateWidth));
  const tiles = carveOpening(map, ring, thickness, side, offset, gateWidth);

  return {
    side,
    tiles,
    outside: outsideOf(tiles, side),
    inside: insideOf(tiles, side),
    center: tiles[Math.floor(tiles.length / 2)],
  };
}

/**
 * Corner towers. On a single layer a tower is a solid block with a guard post
 * at its foot on the approach side: the post stands in for the elevated
 * sightline the tower actually has. When the vertical pass lands, the post
 * becomes a tile on the tower top and nothing else about it changes.
 */
function placeTowers(map, outerRing) {
  const corners = [
    { x: outerRing.minX, y: outerRing.minY, dx: -1, dy: -1 },
    { x: outerRing.maxX, y: outerRing.minY, dx: 1, dy: -1 },
    { x: outerRing.minX, y: outerRing.maxY, dx: -1, dy: 1 },
    { x: outerRing.maxX, y: outerRing.maxY, dx: 1, dy: 1 },
  ];

  return corners.map((corner) => {
    const box = rect(
      Math.min(corner.x, corner.x + corner.dx * 2),
      Math.min(corner.y, corner.y + corner.dy * 2),
      Math.max(corner.x, corner.x + corner.dx * 2),
      Math.max(corner.y, corner.y + corner.dy * 2),
    );

    fillRect(map, box, CastleTile.Tower);

    // The post sits diagonally outside the tower, in the open ground it watches.
    const post = { x: corner.x + corner.dx * 3, y: corner.y + corner.dy * 3 };
    map.set(post.x, post.y, CastleTile.Floor);

    return { box, post };
  });
}

/** Flanking towers either side of the main gate: a gate is never bare wall. */
function buildGatehouse(map, outerRing, side, gateTiles) {
  const along = side === "north" || side === "south" ? "x" : "y";
  const values = gateTiles.map((tile) => tile[along]);
  const low = Math.min(...values) - 1;
  const high = Math.max(...values) + 1;

  for (const position of [low - 1, low, high, high + 1]) {
    for (const column of wallSideColumns(outerRing, OUTER_CURTAIN_THICKNESS + 1, side)) {
      if (column[0][along] === position) {
        for (const cell of column) {
          map.set(cell.x, cell.y, CastleTile.Tower);
        }
      }
    }
  }
}

/**
 * Tile-to-ward lookup. Rings are tested innermost first, so a wall belongs to
 * the ward it encloses and a gate carved through it lands in the ward an
 * intruder arrives in.
 */
function indexWards(map, { outerRing, innerRing, keepRing }) {
  const index = new Uint8Array(map.width * map.height);

  for (let y = 0; y < map.height; y += 1) {
    for (let x = 0; x < map.width; x += 1) {
      let ward = 0;

      if (rectContains(keepRing, x, y)) {
        ward = 3;
      } else if (rectContains(innerRing, x, y)) {
        ward = 2;
      } else if (rectContains(outerRing, x, y)) {
        ward = 1;
      }

      index[x + y * map.width] = ward;
    }
  }

  return index;
}

/**
 * Places the buildings, rejecting any position that would cut its ward in two.
 *
 * Buildings line the walls of the bailey they stand in, so placement samples
 * one of the ring's four segments rather than the ward's bounding box: the
 * middle of that box is the next ward in, and nothing can be built there. The
 * long axis of a building follows the segment it sits in, the way a range of
 * lean-to buildings follows a curtain wall.
 *
 * A bailey that a patrol cannot walk around is not a bailey, so connectivity
 * is checked per placement rather than repaired afterwards.
 */
function placeStructures(map, random, { wardIndex, bounds, outerRing, innerRing, keepRing, reservedTiles }) {
  const placed = [];
  const wardIds = { approach: 0, outer: 1, inner: 2 };
  const regions = {
    // Outbuildings stand off the curtain: the ground under the walls is kept clear.
    approach: ringSegments(insetRect(bounds, 2), insetRect(outerRing, -3)),
    outer: ringSegments(insetRect(outerRing, OUTER_CURTAIN_THICKNESS), innerRing),
    inner: ringSegments(insetRect(innerRing, INNER_CURTAIN_THICKNESS), keepRing),
  };

  for (const spec of STRUCTURE_PLAN) {
    const segments = shuffled(random, regions[spec.ward]);
    const wardId = wardIds[spec.ward];

    let done = false;

    for (const segment of segments) {
      if (done) {
        break;
      }

      for (let attempt = 0; attempt < 24; attempt += 1) {
        const long = random.nextInt(spec.width[0], spec.width[1] + 1);
        const short = random.nextInt(spec.height[0], spec.height[1] + 1);
        const runsHorizontally = segment.side === "north" || segment.side === "south";
        const w = runsHorizontally ? long : short;
        const h = runsHorizontally ? short : long;

        const box = segment.box;
        if (rectWidth(box) < w + 2 || rectHeight(box) < h + 2) {
          break;
        }

        // Against-the-wall buildings back onto the curtain; the rest stand off it.
        const offset = spec.againstWall ? 1 : random.nextInt(1, Math.max(2, 4));
        const placement = placeInSegment(random, segment, w, h, offset);
        if (!placement) {
          continue;
        }

        if (placed.some((other) => rectsOverlap(placement, other.box, 3))) {
          continue;
        }

        if (reservedTiles.some((tile) => rectContains(insetRect(placement, -3), tile.x, tile.y))) {
          continue;
        }

        fillRect(map, placement, CastleTile.Structure);

        if (!wardIsConnected(map, wardIndex, wardId)) {
          fillRect(map, placement, CastleTile.Floor);
          continue;
        }

        placed.push({
          name: spec.name,
          ward: spec.ward,
          box: placement,
          wardId,
          wallSide: spec.againstWall ? segment.side : null,
        });
        done = true;
        break;
      }
    }
  }

  return placed;
}

/** The four rectangles of a ring: the area of `outerBox` outside `holeBox`. */
function ringSegments(outerBox, holeBox) {
  return [
    { side: "north", box: rect(outerBox.minX, outerBox.minY, outerBox.maxX, holeBox.minY - 1) },
    { side: "south", box: rect(outerBox.minX, holeBox.maxY + 1, outerBox.maxX, outerBox.maxY) },
    { side: "west", box: rect(outerBox.minX, holeBox.minY, holeBox.minX - 1, outerBox.maxY) },
    { side: "east", box: rect(holeBox.maxX + 1, holeBox.minY, outerBox.maxX, outerBox.maxY) },
  ].filter((segment) => rectWidth(segment.box) > 0 && rectHeight(segment.box) > 0);
}

/**
 * Positions a building inside a ring segment: `offset` tiles clear of the
 * curtain on that side, and a random position along the run of the wall.
 */
function placeInSegment(random, segment, w, h, offset) {
  const box = segment.box;
  const alongMin = segment.side === "north" || segment.side === "south" ? box.minX : box.minY;
  const alongMax = segment.side === "north" || segment.side === "south" ? box.maxX : box.maxY;
  const span = segment.side === "north" || segment.side === "south" ? w : h;
  const room = alongMax - alongMin - span - 1;

  if (room < 1) {
    return null;
  }

  const along = alongMin + 1 + random.nextInt(0, room);

  switch (segment.side) {
    case "north":
      return rect(along, box.minY + offset, along + w - 1, box.minY + offset + h - 1);
    case "south":
      return rect(along, box.maxY - offset - h + 1, along + w - 1, box.maxY - offset);
    case "west":
      return rect(box.minX + offset, along, box.minX + offset + w - 1, along + h - 1);
    default:
      return rect(box.maxX - offset - w + 1, along, box.maxX - offset, along + h - 1);
  }
}

/** Deterministic Fisher-Yates, so segment order still comes from the seed. */
function shuffled(random, items) {
  const copy = [...items];

  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = random.nextInt(0, i + 1);
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }

  return copy;
}

/** Flood fill over one ward's walkable tiles; every tile must be reachable. */
function wardIsConnected(map, wardIndex, wardId) {
  const tiles = [];

  for (let y = 0; y < map.height; y += 1) {
    for (let x = 0; x < map.width; x += 1) {
      if (wardIndex[x + y * map.width] === wardId && map.isWalkable(x, y)) {
        tiles.push({ x, y });
      }
    }
  }

  if (tiles.length === 0) {
    return false;
  }

  const seen = new Set([`${tiles[0].x},${tiles[0].y}`]);
  const queue = [tiles[0]];
  let reached = 0;

  while (queue.length > 0) {
    const cell = queue.pop();
    reached += 1;

    for (const neighbor of map.neighbors(cell.x, cell.y)) {
      const key = `${neighbor.x},${neighbor.y}`;

      if (
        !seen.has(key) &&
        map.isWalkable(neighbor.x, neighbor.y) &&
        wardIndex[neighbor.x + neighbor.y * map.width] === wardId
      ) {
        seen.add(key);
        queue.push(neighbor);
      }
    }
  }

  return reached === tiles.length;
}

/** The princess is held in the keep, away from its door. */
function placePrincess(map, random, keepRing, keepDoor) {
  const interior = insetRect(keepRing, KEEP_WALL_THICKNESS + 1);
  const candidates = [];

  for (let y = interior.minY; y <= interior.maxY; y += 1) {
    for (let x = interior.minX; x <= interior.maxX; x += 1) {
      if (map.isWalkable(x, y)) {
        candidates.push({ x, y });
      }
    }
  }

  if (candidates.length === 0) {
    return rectCenter(keepRing);
  }

  // Furthest quarter from the door, then a deterministic pick within it.
  candidates.sort(
    (a, b) =>
      Math.hypot(b.x - keepDoor.inside.x, b.y - keepDoor.inside.y) -
      Math.hypot(a.x - keepDoor.inside.x, a.y - keepDoor.inside.y),
  );

  const pool = candidates.slice(0, Math.max(1, Math.floor(candidates.length / 4)));
  return pool[random.nextInt(0, pool.length)];
}

/** Where a beaten party falls back to: open ground, out beyond the towers. */
function pickRallyPoint(map, outerGate, side, bounds) {
  const inward = INWARD[side];
  const point = {
    x: outerGate.outside.x - inward.x * 4,
    y: outerGate.outside.y - inward.y * 4,
  };

  const clamped = {
    x: Math.min(Math.max(point.x, bounds.minX + 2), bounds.maxX - 2),
    y: Math.min(Math.max(point.y, bounds.minY + 2), bounds.maxY - 2),
  };

  return nearestOpenTile(map, clamped) ?? clamped;
}

/** Spirals out from a cell until it finds one that can be stood on. */
export function nearestOpenTile(map, cell, maxRadius = 12) {
  for (let radius = 0; radius <= maxRadius; radius += 1) {
    for (let dy = -radius; dy <= radius; dy += 1) {
      for (let dx = -radius; dx <= radius; dx += 1) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) {
          continue;
        }

        if (map.isWalkable(cell.x + dx, cell.y + dy)) {
          return { x: cell.x + dx, y: cell.y + dy };
        }
      }
    }
  }

  return null;
}
