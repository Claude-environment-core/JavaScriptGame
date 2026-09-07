/**
 * Entry vectors: the ways into a castle that is otherwise shut.
 *
 * Every vector here exists for a reason the castle itself has. A garrison
 * needs water, so there is a sally gate by the cistern. A kitchen needs
 * deliveries, so there is a door the carts use. A castle drains, so there is a
 * channel through the wall. Masonry weathers, so one stretch of curtain is
 * worse than the rest. Guards are people, so one of them can be bought.
 *
 * None of them exist because the player needs a way in — which is why the main
 * gate is always open to a party willing to fight through it, and why a seed
 * that switches every weak point off is still a solvable level.
 *
 * Per castle the generator produces the full candidate set and switches a
 * subset on. An inactive vector leaves no trace in the tiles: the wall it
 * would have pierced is solid.
 */

import { CastleTile, SIDES, inwardOf, rectContains, wallSideColumns } from "./layout.js";
import { JustificationTag, TraversalType, VectorType, WardEdge } from "./wards.js";

/** Numeric ward ids, matching the values written into the ward index. */
export const WardId = Object.freeze({
  Approach: 0,
  OuterBailey: 1,
  InnerBailey: 2,
  Keep: 3,
});

/** How many weak points are live at once. Never all of them. */
export const MIN_ACTIVE_VECTORS = 2;
export const MAX_ACTIVE_VECTORS = 4;

/**
 * Baselines per vector kind: how heavily the crossing itself is watched, how
 * readily a guard there commits to an alarm, and what it costs to use.
 *
 * `time` is in multiples of walking the same distance in the open; `noise` is
 * how much alert the crossing generates by itself; `risk` is the chance per
 * use of being seen at all, before patrol timing is taken into account.
 */
const VECTOR_PROFILE = Object.freeze({
  [VectorType.Postern]: {
    traversalType: TraversalType.Stealth,
    justificationTag: JustificationTag.WaterAccess,
    garrisonDensity: 0.6,
    alertSensitivity: 0.55,
    cost: { time: 1.4, noise: 0.05, risk: 0.3 },
    note: "Sally gate for the cistern. Two men, and a long way from the keep.",
  },
  [VectorType.Kitchen]: {
    traversalType: TraversalType.Stealth,
    justificationTag: JustificationTag.Supply,
    garrisonDensity: 1.1,
    alertSensitivity: 0.7,
    cost: { time: 1.1, noise: 0.1, risk: 0.45 },
    note: "Delivery door. Unbarred while the carts are running, shut otherwise.",
  },
  [VectorType.Sewer]: {
    traversalType: TraversalType.Stealth,
    justificationTag: JustificationTag.Drainage,
    garrisonDensity: 0.2,
    alertSensitivity: 0.35,
    cost: { time: 2.6, noise: 0.05, risk: 0.2 },
    note: "Covered drain under the outer bailey. Slow, cramped, and it comes up inside.",
  },
  [VectorType.Breach]: {
    traversalType: TraversalType.Combat,
    justificationTag: JustificationTag.Subsidence,
    garrisonDensity: 0.9,
    alertSensitivity: 0.9,
    cost: { time: 1.2, noise: 0.85, risk: 0.8 },
    note: "Settled foundations. It will come down, and everyone will hear it.",
  },
  [VectorType.Bribe]: {
    traversalType: TraversalType.Puzzle,
    justificationTag: JustificationTag.Discipline,
    garrisonDensity: 1.0,
    alertSensitivity: 0.6,
    cost: { time: 1.0, noise: 0.2, risk: 0.5 },
    note: "A sergeant on the inner door with debts. He opens it once.",
  },
});

/** The kitchen door is only unbarred while deliveries are running. */
const DELIVERY_WINDOW = Object.freeze({ openFor: 45, period: 120, phase: 0 });

/**
 * Builds the castle's chokepoints: the three gates that always exist, then the
 * weak-point candidates, of which a subset is switched on.
 *
 * Geometry is only written for vectors that end up active, so an unused
 * candidate is a note on the level, not a hole in the wall.
 */
export function planVectors({ map, layout, random, wardIndex }) {
  const features = new Map();
  const edges = coreEdges(layout, features);
  const candidates = [];

  for (const build of [buildPostern, buildKitchenDoor, buildSewer, buildBreach, buildBribeDoor]) {
    const candidate = build({ map, layout, random });
    if (candidate) {
      candidates.push(candidate);
    }
  }

  // Never every candidate: a castle always has at least one weak point that
  // this seed did not give you, so knowing the catalogue is not knowing the
  // level.
  const wanted = random.nextInt(MIN_ACTIVE_VECTORS, MAX_ACTIVE_VECTORS + 1);
  const target = Math.max(1, Math.min(wanted, candidates.length - 1));
  const order = weightedOrder(random, candidates);
  let activated = 0;

  for (const candidate of order) {
    const edge = candidate.edge;

    if (activated < target && candidate.write(map, wardIndex, features)) {
      edge.isActive = true;
      activated += 1;
    } else {
      edge.isActive = false;
      edge.isOpen = false;
    }

    edges.push(edge);
  }

  return { edges, features };
}

/**
 * The gates. These are not weak points: they are where the castle expects you,
 * and they are why a storm is always possible even when nothing else is live.
 */
function coreEdges(layout, features) {
  const pairs = [
    { gate: layout.gates.outer, from: WardId.Approach, to: WardId.OuterBailey, density: 2.2 },
    { gate: layout.gates.inner, from: WardId.OuterBailey, to: WardId.InnerBailey, density: 3.0 },
    { gate: layout.gates.keep, from: WardId.InnerBailey, to: WardId.Keep, density: 4.0 },
  ];

  return pairs.map(({ gate, from, to, density }, index) => {
    for (const tile of gate.tiles) {
      features.set(key(tile), { type: "gate", edgeId: `gate-${index}` });
    }

    return new WardEdge({
      id: `gate-${index}`,
      fromWard: from,
      toWard: to,
      vectorType: VectorType.Gate,
      traversalType: TraversalType.Combat,
      justificationTag: JustificationTag.MainApproach,
      location: gate.center,
      tiles: gate.tiles,
      isActive: true,
      isOpen: true,
      garrisonDensity: density,
      alertSensitivity: 1.0,
      cost: { time: 1, noise: 1, risk: 1 },
      note: index === 0 ? "The main gate, under the gatehouse towers." : "An interior gate.",
    });
  });
}

/**
 * Sally gate beside the cistern. Lightly held, because it is nowhere near
 * anything worth taking — which is the whole reason it is survivable.
 */
function buildPostern({ map, layout, random }) {
  const cistern = layout.structures.find((structure) => structure.name === "cistern");
  const side = cistern?.wallSide ?? pickQuietSide(random, layout);
  const offset = wallOffsetNear(layout.rings.outer, side, cistern?.box ?? null, random);
  const tiles = openingTiles(layout.rings.outer, side, offset, 1, 2);

  if (!tilesAreMasonry(map, tiles)) {
    return null;
  }

  return {
    weight: 3,
    edge: makeEdge({
      id: "vector-postern",
      vectorType: VectorType.Postern,
      from: WardId.Approach,
      to: WardId.OuterBailey,
      tiles,
      layout,
    }),
    write: (target, _wardIndex, features) => {
      carve(target, tiles, CastleTile.Floor, features, "postern", "vector-postern");
      return true;
    },
  };
}

/** The door the carts use, in the wall the kitchen backs onto. */
function buildKitchenDoor({ map, layout, random }) {
  const kitchen = layout.structures.find((structure) => structure.name === "kitchen");
  if (!kitchen?.wallSide) {
    return null;
  }

  const offset = wallOffsetNear(layout.rings.outer, kitchen.wallSide, kitchen.box, random);
  const tiles = openingTiles(layout.rings.outer, kitchen.wallSide, offset, 2, 2);

  if (!tilesAreMasonry(map, tiles)) {
    return null;
  }

  const edge = makeEdge({
    id: "vector-kitchen",
    vectorType: VectorType.Kitchen,
    from: WardId.Approach,
    to: WardId.OuterBailey,
    tiles,
    layout,
  });

  // The only vector with a duty cycle: it is shut between deliveries.
  edge.schedule = { ...DELIVERY_WINDOW, phase: random.nextInt(0, DELIVERY_WINDOW.period) };

  return {
    weight: 2,
    edge,
    write: (target, _wardIndex, features) => {
      carve(target, tiles, CastleTile.Floor, features, "kitchen", "vector-kitchen");
      return true;
    },
  };
}

/**
 * The drain: a covered channel from open ground, under the outer bailey, into
 * the inner ward. It is walled on both sides for its whole run, so it neither
 * opens into the bailey nor can be seen across — which is exactly why it is
 * worth the crawl.
 */
function buildSewer({ map, layout, random }) {
  const side = pickQuietSide(random, layout);
  const inward = inwardOf(side);
  const outerColumns = wallSideColumns(layout.rings.outer, 1, side);
  const horizontal = side === "north" || side === "south";

  for (let attempt = 0; attempt < 40; attempt += 1) {
    const index = random.nextInt(4, Math.max(5, outerColumns.length - 4));
    const anchor = outerColumns[index][0];
    const run = channelRun(layout, anchor, inward, horizontal);

    if (run && channelIsClear(map, run, inward, horizontal)) {
      return {
        weight: 2,
        edge: makeEdge({
          id: "vector-sewer",
          vectorType: VectorType.Sewer,
          from: WardId.Approach,
          to: WardId.InnerBailey,
          tiles: run,
          layout,
        }),
        write: (target, wardIndex, features) => writeChannel(target, wardIndex, run, inward, horizontal, features),
      };
    }
  }

  return null;
}

/** Weathered curtain: still a wall, but it can be brought down. */
function buildBreach({ map, layout, random }) {
  const side = pickQuietSide(random, layout);
  const columns = wallSideColumns(layout.rings.outer, 1, side);

  for (let attempt = 0; attempt < 30; attempt += 1) {
    const offset = random.nextInt(5, Math.max(6, columns.length - 8));
    const tiles = openingTiles(layout.rings.outer, side, offset, 3, 2);

    if (tilesAreMasonry(map, tiles)) {
      return {
        weight: 3,
        edge: makeEdge({
          id: "vector-breach",
          vectorType: VectorType.Breach,
          from: WardId.Approach,
          to: WardId.OuterBailey,
          tiles,
          layout,
        }),
        write: (target, _wardIndex, features) => {
          // Written as masonry, not as a hole: someone has to bring it down.
          carve(target, tiles, CastleTile.WeakMasonry, features, "breach", "vector-breach");
          return true;
        },
      };
    }
  }

  return null;
}

/** A shut door on the inner curtain, and a sergeant who can be talked round. */
function buildBribeDoor({ map, layout, random }) {
  const side = pickQuietSide(random, layout, layout.sides.innerGate);
  const columns = wallSideColumns(layout.rings.inner, 1, side);

  for (let attempt = 0; attempt < 30; attempt += 1) {
    const offset = random.nextInt(4, Math.max(5, columns.length - 5));
    const tiles = openingTiles(layout.rings.inner, side, offset, 1, 1);

    if (tilesAreMasonry(map, tiles)) {
      const edge = makeEdge({
        id: "vector-bribe",
        vectorType: VectorType.Bribe,
        from: WardId.OuterBailey,
        to: WardId.InnerBailey,
        tiles,
        layout,
      });

      edge.isOpen = false;
      edge.guardId = "sergeant-of-the-postern";

      return {
        weight: 2,
        edge,
        write: (target, _wardIndex, features) => {
          carve(target, tiles, CastleTile.Door, features, "door", "vector-bribe");
          return true;
        },
      };
    }
  }

  return null;
}

function makeEdge({ id, vectorType, from, to, tiles, layout }) {
  const profile = VECTOR_PROFILE[vectorType];

  // Crossing tiles are always built from the outer face inwards, so the last
  // one is the defended end: where a sentry stands, and what the castle thinks
  // of as the hole. The first is the mouth, which is what the player sees.
  const location = tiles[tiles.length - 1];
  const mouth = tiles[0];
  const princess = layout.landmarks.princess;

  // Cost in time scales with how far this way in leaves you from the objective,
  // so a quiet door on the far side is quiet *and* long.
  const reach = Math.hypot(princess.x - location.x, princess.y - location.y) / layout.map.width;

  const edge = new WardEdge({
    id,
    fromWard: from,
    toWard: to,
    vectorType,
    traversalType: profile.traversalType,
    justificationTag: profile.justificationTag,
    location,
    tiles,
    isActive: false,
    isOpen: vectorType !== VectorType.Breach,
    garrisonDensity: profile.garrisonDensity,
    alertSensitivity: profile.alertSensitivity,
    cost: {
      time: Number((profile.cost.time * (0.6 + reach)).toFixed(2)),
      noise: profile.cost.noise,
      risk: profile.cost.risk,
    },
    note: profile.note,
  });

  edge.mouth = mouth;
  return edge;
}

/**
 * Activation order. Weights bias which weak points a castle tends to have
 * without making any of them certain — a run of seeds should turn up postern
 * castles, drain castles and crumbling castles in different mixes.
 */
function weightedOrder(random, candidates) {
  const pool = candidates.map((candidate) => ({
    candidate,
    // Exponential-race ordering: one draw per candidate, sorted by score.
    score: -Math.log(1 - random.nextFloat() * 0.999999) / Math.max(0.001, candidate.weight),
  }));

  pool.sort((a, b) => a.score - b.score);
  return pool.map((entry) => entry.candidate);
}

/** A side of the castle with no gate on it, so vectors are not stacked. */
function pickQuietSide(random, layout, ...alsoAvoid) {
  const busy = new Set([layout.sides.outerGate, ...alsoAvoid]);
  const options = SIDES.filter((side) => !busy.has(side));
  return options[random.nextInt(0, options.length)];
}

/** An offset along a wall that sits opposite a given building. */
function wallOffsetNear(ring, side, box, random) {
  const columns = wallSideColumns(ring, 1, side);

  if (!box) {
    return random.nextInt(4, Math.max(5, columns.length - 4));
  }

  const horizontal = side === "north" || side === "south";
  const target = horizontal
    ? Math.floor((box.minX + box.maxX) / 2)
    : Math.floor((box.minY + box.maxY) / 2);

  let best = 4;
  let bestDistance = Infinity;

  for (let i = 2; i < columns.length - 2; i += 1) {
    const value = horizontal ? columns[i][0].x : columns[i][0].y;
    const distance = Math.abs(value - target);

    if (distance < bestDistance) {
      bestDistance = distance;
      best = i;
    }
  }

  return best;
}

/** The tiles an opening would occupy, without writing anything. */
function openingTiles(ring, side, offset, width, thickness) {
  const columns = wallSideColumns(ring, thickness, side);
  const start = Math.min(Math.max(offset, 1), Math.max(1, columns.length - width - 1));
  const tiles = [];

  for (let i = start; i < start + width && i < columns.length; i += 1) {
    tiles.push(...columns[i]);
  }

  return tiles;
}

/** Vectors cut masonry, never a tower, a building or a gate that already exists. */
function tilesAreMasonry(map, tiles) {
  if (tiles.length === 0) {
    return false;
  }

  return tiles.every((tile) => {
    const value = map.get(tile.x, tile.y);
    return value === CastleTile.Curtain || value === CastleTile.InnerCurtain;
  });
}

function carve(map, tiles, value, features, featureType, edgeId) {
  for (const tile of tiles) {
    map.set(tile.x, tile.y, value);
    features.set(key(tile), { type: featureType, edgeId });
  }
}

/** The straight run a drain would take, from open ground to the inner ward. */
function channelRun(layout, anchor, inward, horizontal) {
  const { outer, inner } = layout.rings;
  const tiles = [];
  let cursor = {
    x: anchor.x - inward.x * 2,
    y: anchor.y - inward.y * 2,
  };

  for (let step = 0; step < layout.map.width; step += 1) {
    tiles.push({ ...cursor });

    // Stop one tile past the inner curtain: the drain surfaces in the inner ward.
    const insideInner =
      rectContains(inner, cursor.x, cursor.y) &&
      !onRingEdge(inner, cursor, horizontal) &&
      tiles.length > 4;

    if (insideInner) {
      return tiles;
    }

    cursor = { x: cursor.x + inward.x, y: cursor.y + inward.y };

    if (!rectContains(layout.bounds, cursor.x, cursor.y)) {
      return null;
    }

    if (tiles.length > 4 && !rectContains(outer, cursor.x, cursor.y)) {
      return null;
    }
  }

  return null;
}

function onRingEdge(ring, cell, horizontal) {
  return horizontal
    ? cell.y === ring.minY || cell.y === ring.maxY
    : cell.x === ring.minX || cell.x === ring.maxX;
}

/** A drain may pass through masonry and open ground, but not through a building. */
function channelIsClear(map, run, inward, horizontal) {
  const lateral = horizontal ? { x: 1, y: 0 } : { x: 0, y: 1 };

  return run.every((tile) => {
    const value = map.get(tile.x, tile.y);

    if (value === CastleTile.Tower || value === CastleTile.Structure || value === CastleTile.Bedrock) {
      return false;
    }

    // The sides of the channel must be somewhere a wall can be built.
    for (const sign of [-1, 1]) {
      const side = { x: tile.x + lateral.x * sign, y: tile.y + lateral.y * sign };
      if (map.get(side.x, side.y) === CastleTile.Tower) {
        return false;
      }
    }

    return true;
  });
}

/**
 * Writes the drain: floor along the run, masonry down both sides for the part
 * that crosses the outer bailey.
 *
 * A radial channel cuts the bailey ring at one point, which a ring survives —
 * but only one cut. The placement is rolled back if the ward stops being
 * walkable end to end, and the vector is dropped.
 */
function writeChannel(map, wardIndex, run, inward, horizontal, features) {
  const lateral = horizontal ? { x: 1, y: 0 } : { x: 0, y: 1 };
  const restore = [];

  for (const tile of run) {
    restore.push({ ...tile, value: map.get(tile.x, tile.y) });
    map.set(tile.x, tile.y, CastleTile.Floor);

    for (const sign of [-1, 1]) {
      const side = { x: tile.x + lateral.x * sign, y: tile.y + lateral.y * sign };
      if (map.get(side.x, side.y) === CastleTile.Floor) {
        restore.push({ ...side, value: CastleTile.Floor });
        map.set(side.x, side.y, CastleTile.Curtain);
      }
    }
  }

  // The channel's own tiles are walled off from the bailey on purpose, so they
  // are excluded from the survey: what must survive is the ring around them.
  const channelKeys = new Set(run.map(key));

  if (!wardStillWalkable(map, wardIndex, WardId.OuterBailey, channelKeys)) {
    for (const entry of restore) {
      map.set(entry.x, entry.y, entry.value);
    }

    return false;
  }

  for (const tile of run) {
    features.set(key(tile), { type: "sewer", edgeId: "vector-sewer" });
  }

  return true;
}

function wardStillWalkable(map, wardIndex, wardId, excluded = new Set()) {
  const tiles = [];

  for (let y = 0; y < map.height; y += 1) {
    for (let x = 0; x < map.width; x += 1) {
      if (wardIndex[x + y * map.width] === wardId && map.isWalkable(x, y) && !excluded.has(`${x},${y}`)) {
        tiles.push({ x, y });
      }
    }
  }

  if (tiles.length === 0) {
    return false;
  }

  const seen = new Set([key(tiles[0])]);
  const queue = [tiles[0]];
  let reached = 0;

  while (queue.length > 0) {
    const cell = queue.pop();
    reached += 1;

    for (const neighbor of map.neighbors(cell.x, cell.y)) {
      const id = wardIndex[neighbor.x + neighbor.y * map.width];

      if (
        !seen.has(key(neighbor)) &&
        !excluded.has(key(neighbor)) &&
        map.isWalkable(neighbor.x, neighbor.y) &&
        id === wardId
      ) {
        seen.add(key(neighbor));
        queue.push(neighbor);
      }
    }
  }

  return reached === tiles.length;
}

function key(tile) {
  return `${tile.x},${tile.y}`;
}
