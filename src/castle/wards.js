/**
 * The castle as a graph of wards.
 *
 * A castle is not a floor plan with a hole in it: it is a set of nested
 * defended zones joined by a small number of chokepoints. Everything the
 * garrison and the mission need to reason about — where reinforcements come
 * from, how deep an intruder has got, which way is out — is a query on this
 * graph, not on the tile grid.
 *
 * The tile geometry in `layout.js` is a *rendering* of this graph. Keeping the
 * two separable is what makes verticality a later addition rather than a
 * redesign: wall-top walks and keep floors are new nodes at `level > 0` joined
 * by stair edges, and every query below already ignores level.
 */

/** Ward kinds, outermost first. Order is load-bearing: depth is an index. */
export const WardType = Object.freeze({
  Approach: "approach",
  OuterBailey: "outer",
  InnerBailey: "inner",
  Keep: "keep",
});

/** Outermost to innermost. A ward's index here is its depth from open ground. */
export const WARD_SEQUENCE = Object.freeze([
  WardType.Approach,
  WardType.OuterBailey,
  WardType.InnerBailey,
  WardType.Keep,
]);

/**
 * How a chokepoint is crossed. Cost profiles hang off this: stealth vectors
 * are cheap but conditional, combat vectors are always available but loud,
 * puzzle vectors need something done to them first.
 */
export const TraversalType = Object.freeze({
  Stealth: "stealth",
  Combat: "combat",
  Puzzle: "puzzle",
});

/**
 * Chokepoint kinds. `Gate` is the castle's own front door — it always exists,
 * it is always crossable, and it is where the garrison expects you. The rest
 * are the weak points: each one exists because the castle needs it to
 * function, not because the level needs the player to get in.
 */
export const VectorType = Object.freeze({
  Gate: "gate",
  Postern: "postern",
  Kitchen: "kitchen",
  Sewer: "sewer",
  Breach: "breach",
  Bribe: "bribe",
});

/**
 * Why the weak point exists at all. Written into every edge so a generated
 * castle can be read back and checked for coherence.
 */
export const JustificationTag = Object.freeze({
  MainApproach: "main-approach",
  WaterAccess: "water-access",
  Supply: "supply",
  Drainage: "drainage",
  Subsidence: "subsidence",
  Discipline: "discipline",
});

/**
 * Baseline garrison pressure per ward. Density is guards per 100 walkable
 * tiles; sensitivity scales how fast a guard there commits to an alarm.
 *
 * These are patrol strength only. Chokepoints are manned on top, from each
 * crossing's own density — so the numbers here have to stay far enough apart
 * that a bailey with several live weak points in it, and the extra sentries
 * that come with them, is still not as densely held as the ward behind it.
 */
export const DEFAULT_WARD_PROFILE = Object.freeze({
  [WardType.Approach]: Object.freeze({ garrisonDensity: 0.12, alertSensitivity: 0.55 }),
  [WardType.OuterBailey]: Object.freeze({ garrisonDensity: 0.35, alertSensitivity: 0.75 }),
  [WardType.InnerBailey]: Object.freeze({ garrisonDensity: 0.9, alertSensitivity: 0.9 }),
  [WardType.Keep]: Object.freeze({ garrisonDensity: 3.2, alertSensitivity: 1.0 }),
});

/** Marks a tile as belonging to no ward (outside the map's playable area). */
export const NO_WARD = 255;

export class Ward {
  constructor({
    id,
    type,
    bounds,
    level = 0,
    garrisonDensity = 1,
    alertSensitivity = 1,
    tileCount = 0,
    centroid = { x: 0, y: 0 },
  }) {
    this.id = id;
    this.type = type;
    /** Reserved for the vertical pass; every ward in the 2D castle is level 0. */
    this.level = level;
    this.bounds = bounds;
    this.garrisonDensity = garrisonDensity;
    this.alertSensitivity = alertSensitivity;
    this.tileCount = tileCount;
    this.centroid = centroid;
    this.patrolRoutes = [];
  }

  /** Depth from open ground: 0 for the approach, 3 for the keep. */
  get depth() {
    return WARD_SEQUENCE.indexOf(this.type);
  }

  /** Guards this ward is meant to hold, from its density and its size. */
  get garrisonSize() {
    return Math.max(1, Math.round((this.garrisonDensity * this.tileCount) / 100));
  }
}

/**
 * A chokepoint between two wards.
 *
 * `isActive` is decided per seed — a castle does not have every weak point
 * every time. `isOpen` is runtime state: a barred postern is still an active
 * vector, it is just shut right now because the garrison heard something.
 */
export class WardEdge {
  constructor({
    id,
    fromWard,
    toWard,
    vectorType,
    traversalType,
    justificationTag,
    location,
    tiles = [],
    isActive = true,
    isOpen = true,
    garrisonDensity = null,
    alertSensitivity = 0.5,
    cost = {},
    note = "",
  }) {
    this.id = id;
    this.fromWard = fromWard;
    this.toWard = toWard;
    this.vectorType = vectorType;
    this.traversalType = traversalType;
    this.justificationTag = justificationTag;
    /** The defended end of the crossing: where a guard on it would stand. */
    this.location = location;
    /** The far end, on the shallower side — the mouth an intruder approaches. */
    this.mouth = location;
    /** Every tile the crossing occupies, so it can be barred or breached. */
    this.tiles = tiles;
    this.isActive = isActive;
    this.isOpen = isOpen;
    /** Overrides the ward's density for guards posted on the crossing itself. */
    this.garrisonDensity = garrisonDensity;
    this.alertSensitivity = alertSensitivity;
    this.cost = {
      time: cost.time ?? 1,
      noise: cost.noise ?? 0,
      risk: cost.risk ?? 0.5,
    };
    this.note = note;
    /** Set when alert closed this vector, so it can be reopened on the way down. */
    this.barredByAlert = false;
  }

  /** True when this crossing can be walked right now. */
  get isPassable() {
    return this.isActive && this.isOpen;
  }

  /** The main gate is never a "weak point" — it is the front door. */
  get isWeakPoint() {
    return this.vectorType !== VectorType.Gate;
  }

  connects(wardId) {
    return this.fromWard === wardId || this.toWard === wardId;
  }

  other(wardId) {
    if (this.fromWard === wardId) {
      return this.toWard;
    }

    return this.fromWard === this.toWard ? null : this.fromWard;
  }

  toJSON() {
    return {
      id: this.id,
      fromWard: this.fromWard,
      toWard: this.toWard,
      vectorType: this.vectorType,
      traversalType: this.traversalType,
      justificationTag: this.justificationTag,
      location: this.location,
      mouth: this.mouth,
      isActive: this.isActive,
      isOpen: this.isOpen,
      garrisonDensity: this.garrisonDensity,
      alertSensitivity: this.alertSensitivity,
      cost: { ...this.cost },
    };
  }
}

/**
 * A generated castle: the tile map, the ward graph over it, and the landmarks
 * the mission layer needs (the princess, the rally point, the wells and doors
 * that justify the weak points).
 */
export class Castle {
  constructor({ seed, map, wards, edges, wardIndex, landmarks = {}, princess = null }) {
    this.seed = seed;
    this.map = map;
    this.wards = new Map(wards.map((ward) => [ward.id, ward]));
    this.edges = edges;
    /** Tile-to-ward lookup, `wardIndex[x + y * width]`, {@link NO_WARD} for none. */
    this.wardIndex = wardIndex;
    this.landmarks = landmarks;
    this.princess = princess;
  }

  ward(id) {
    return this.wards.get(id) ?? null;
  }

  /** The single ward of a given type; the 2D castle has one of each. */
  wardOfType(type) {
    for (const ward of this.wards.values()) {
      if (ward.type === type) {
        return ward;
      }
    }

    return null;
  }

  get wardList() {
    return [...this.wards.values()];
  }

  wardAt(x, y) {
    if (!this.map.isInside(x, y)) {
      return null;
    }

    const id = this.wardIndex[x + y * this.map.width];
    return id === NO_WARD ? null : (this.wards.get(id) ?? null);
  }

  wardAtWorld(point) {
    const cell = this.map.worldToGrid(point);
    return this.wardAt(cell.x, cell.y);
  }

  edgesFrom(wardId) {
    return this.edges.filter((edge) => edge.connects(wardId));
  }

  /** Wards reachable from here right now, ignoring vectors that are shut. */
  neighbors(wardId, { openOnly = true } = {}) {
    const ids = [];

    for (const edge of this.edgesFrom(wardId)) {
      if (openOnly && !edge.isPassable) {
        continue;
      }

      const other = edge.other(wardId);
      if (other !== null && !ids.includes(other)) {
        ids.push(other);
      }
    }

    return ids;
  }

  /** Every weak point the seed switched on. */
  activeVectors() {
    return this.edges.filter((edge) => edge.isWeakPoint && edge.isActive);
  }

  /** Every weak point the generator considered, live or not. */
  candidateVectors() {
    return this.edges.filter((edge) => edge.isWeakPoint);
  }

  /**
   * Shortest chain of crossings between two wards, as edges.
   *
   * Breadth-first over the ward graph — with four wards the graph is tiny, and
   * the cost model belongs to the planner, not to this lookup.
   */
  wardPath(fromWardId, toWardId, { openOnly = true } = {}) {
    if (fromWardId === toWardId) {
      return [];
    }

    const cameFrom = new Map([[fromWardId, null]]);
    const queue = [fromWardId];

    while (queue.length > 0) {
      const current = queue.shift();

      for (const edge of this.edgesFrom(current)) {
        if (openOnly && !edge.isPassable) {
          continue;
        }

        const next = edge.other(current);
        if (next === null || cameFrom.has(next)) {
          continue;
        }

        cameFrom.set(next, { edge, from: current });

        if (next === toWardId) {
          return reconstructEdges(cameFrom, next);
        }

        queue.push(next);
      }
    }

    return null;
  }

  /** Tiles of a ward that can actually be stood on. */
  *walkableTilesIn(wardId) {
    const ward = this.ward(wardId);
    if (!ward) {
      return;
    }

    const { minX, minY, maxX, maxY } = ward.bounds;

    for (let y = minY; y <= maxY; y += 1) {
      for (let x = minX; x <= maxX; x += 1) {
        if (this.wardIndex[x + y * this.map.width] === wardId && this.map.isWalkable(x, y)) {
          yield { x, y };
        }
      }
    }
  }

  /** A serialisable digest — the shape a level browser or a test asserts on. */
  toJSON() {
    return {
      seed: this.seed,
      size: { width: this.map.width, height: this.map.height },
      princess: this.princess,
      wards: this.wardList.map((ward) => ({
        id: ward.id,
        type: ward.type,
        level: ward.level,
        bounds: ward.bounds,
        tileCount: ward.tileCount,
        garrisonDensity: ward.garrisonDensity,
        alertSensitivity: ward.alertSensitivity,
        patrolRoutes: ward.patrolRoutes.length,
      })),
      edges: this.edges.map((edge) => edge.toJSON()),
    };
  }
}

function reconstructEdges(cameFrom, wardId) {
  const chain = [];
  let current = wardId;

  while (cameFrom.get(current)) {
    const step = cameFrom.get(current);
    chain.push(step.edge);
    current = step.from;
  }

  return chain.reverse();
}
