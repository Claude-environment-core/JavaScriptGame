/**
 * Patrol routes, and the path following guards do between waypoints.
 *
 * Routes are planned per ward on a *masked* copy of the map — every tile
 * outside the ward is blocked — so a circuit cannot wander out through a gate
 * and a patrol stays the ward's own business. The drain is masked out too: it
 * is a covered channel, and nobody walks a beat down it.
 *
 * Routing uses the same A* as everything else in the project, so a patrol
 * takes the same route a squad would through the same doorway.
 */

import { GridMap, TILE_BLOCKED, hasLineOfSight } from "../sim/gridMap.js";
import { findPath } from "../sim/pathfinding.js";
import { distance, normalize, scale, subtract, vec2 } from "../sim/vec2.js";
import { nearestOpenTile } from "./layout.js";
import { WardType } from "./wards.js";

/** How close is close enough to a waypoint before moving to the next one. */
export const WAYPOINT_RADIUS = 0.6;

/**
 * A closed circuit of world-space waypoints, or a short pacing beat at a post.
 */
export class PatrolRoute {
  constructor({ id, wardId, waypoints, kind = "circuit", edgeId = null }) {
    this.id = id;
    this.wardId = wardId;
    this.waypoints = waypoints;
    /** `circuit` walks the ward; `post` paces a few tiles by a chokepoint. */
    this.kind = kind;
    this.edgeId = edgeId;
  }

  get length() {
    return this.waypoints.length;
  }
}

/**
 * A copy of the map with everything outside one ward blocked.
 *
 * Patrol planning, and only patrol planning, uses this: alerted guards and
 * reinforcements route on the real map, because an alarm is precisely when a
 * guard stops minding ward boundaries.
 */
export function wardSubmap(map, wardIndex, wardId, blockedKeys = new Set(), within = null) {
  const submap = new GridMap(map.width, map.height);

  for (let y = 0; y < map.height; y += 1) {
    for (let x = 0; x < map.width; x += 1) {
      const inWard = wardIndex[x + y * map.width] === wardId;
      const excluded = blockedKeys.has(`${x},${y}`);
      const inRange =
        !within || (x >= within.minX && x <= within.maxX && y >= within.minY && y <= within.maxY);

      submap.set(x, y, inWard && inRange && !excluded ? map.get(x, y) : TILE_BLOCKED);
    }
  }

  return submap;
}

/**
 * Pulls a grid path straight.
 *
 * A* expands to 4-neighbours, so a leg that is really a diagonal comes back as
 * a staircase of single-tile steps — which a guard would walk as a zig-zag
 * across an open bailey. Advancing to the furthest cell still in line of sight
 * replaces each staircase with the straight line it was approximating.
 *
 * The lookahead is bounded because this also runs live, for guards routing to
 * something they want to look at, and an unbounded scan is quadratic in the
 * length of the path.
 */
export function smoothPath(map, cells, { lookahead = 24 } = {}) {
  if (!map || cells.length <= 2) {
    return [...cells];
  }

  const centre = (cell) => map.gridToWorldCenter(cell.x, cell.y);
  const kept = [cells[0]];
  let anchor = 0;

  while (anchor < cells.length - 1) {
    const limit = Math.min(cells.length - 1, anchor + lookahead);
    let furthest = anchor + 1;

    for (let i = limit; i > anchor + 1; i -= 1) {
      if (hasLineOfSight(map, centre(cells[anchor]), centre(cells[i]))) {
        furthest = i;
        break;
      }
    }

    kept.push(cells[furthest]);
    anchor = furthest;
  }

  return kept;
}

/**
 * Drops the interior of straight runs.
 *
 * A* on a 4-neighbour grid returns axis-aligned segments, so keeping only the
 * turns leaves a route whose legs are still walkable end to end — a guard can
 * head straight for the next corner instead of stepping cell by cell.
 */
export function simplifyPath(cells) {
  if (cells.length <= 2) {
    return [...cells];
  }

  const kept = [cells[0]];

  for (let i = 1; i < cells.length - 1; i += 1) {
    const before = cells[i - 1];
    const cell = cells[i];
    const after = cells[i + 1];

    const turning = (cell.x - before.x) * (after.y - cell.y) !== (cell.y - before.y) * (after.x - cell.x);
    if (turning) {
      kept.push(cell);
    }
  }

  kept.push(cells[cells.length - 1]);
  return kept;
}

/**
 * Plans the patrols for every ward and hangs them off the wards themselves.
 *
 * Two kinds come out of this: a circuit per pair of interest points in the
 * ward, and a short beat at every chokepoint the ward owns. Chokepoints get
 * their own posts because that is where a garrison actually stands.
 */
export function planPatrols({ castle, random, features = new Map(), circuitsPerWard = null }) {
  const routes = [];
  const sewerTiles = new Set(
    [...features.entries()].filter(([, feature]) => feature.type === "sewer").map(([tile]) => tile),
  );

  for (const ward of castle.wardList) {
    // A patrol sweeps the ground under its own walls, not the countryside. For
    // the open ground that means the apron only: past it a beat would be a man
    // walking a field for no reason, and the buffer would stop being the one
    // place outside the castle that nobody occupies and nobody is watching.
    const limit = ward.type === WardType.Approach ? castle.landmarks.apron : null;
    const submap = wardSubmap(castle.map, castle.wardIndex, ward.id, sewerTiles, limit);
    const posts = interestPoints(castle, ward, submap, limit ?? ward.bounds);
    const wanted = circuitsPerWard ?? Math.min(3, Math.max(1, Math.round(ward.garrisonSize / 3)));

    for (let index = 0; index < wanted; index += 1) {
      const circuit = buildCircuit(castle.map, submap, random, posts, ward, `${ward.id}-circuit-${index}`);
      if (circuit) {
        routes.push(circuit);
      }
    }

    // A beat at each of the ward's own chokepoints. A door is manned from the
    // defended side only — the deeper of the two wards it joins — so a gate
    // gets a guard behind it, not one on either side of it.
    for (const edge of castle.edgesFrom(ward.id)) {
      if (!edge.isActive || defendedSideOf(castle, edge) !== ward.id) {
        continue;
      }

      // A crossing nobody would think to man gets no beat of its own; the
      // ward's circuits are all that pass it.
      if (Math.round(edge.garrisonDensity ?? 1) < 1) {
        continue;
      }

      const post = sentryBeat(castle, submap, ward, edge);
      if (post) {
        routes.push(post);
      }
    }

    ward.patrolRoutes = routes.filter((route) => route.wardId === ward.id);
  }

  return routes;
}

/**
 * Where a patrol has reason to go: the ward's chokepoints, the corners of the
 * buildings in it, and the corners of the ward itself.
 */
function interestPoints(castle, ward, submap, bounds) {
  const points = [];

  const push = (cell) => {
    if (cell && !points.some((p) => p.x === cell.x && p.y === cell.y)) {
      points.push({ x: cell.x, y: cell.y });
    }
  };

  for (const edge of castle.edgesFrom(ward.id)) {
    if (edge.isActive) {
      push(nearestWalkable(castle, ward, edge.location, submap));
    }
  }

  for (const structure of castle.landmarks.structures ?? []) {
    if (structure.wardId === ward.id) {
      push(nearestWalkable(castle, ward, { x: structure.box.minX - 1, y: structure.box.minY - 1 }, submap));
      push(nearestWalkable(castle, ward, { x: structure.box.maxX + 1, y: structure.box.maxY + 1 }, submap));
    }
  }

  const { minX, minY, maxX, maxY } = bounds;
  const inset = 3;
  for (const corner of [
    { x: minX + inset, y: minY + inset },
    { x: maxX - inset, y: minY + inset },
    { x: maxX - inset, y: maxY - inset },
    { x: minX + inset, y: maxY - inset },
  ]) {
    push(nearestWalkable(castle, ward, corner, submap));
  }

  return points;
}

/**
 * The nearest tile to `cell` a patrol may stand on.
 *
 * Resolved against the ward's patrol submap when one is given, since that map
 * already carries both the ward and the apron limit — which is what keeps an
 * approach beat from drifting out into the buffer.
 */
function nearestWalkable(castle, ward, cell, submap = null) {
  const width = castle.map.width;
  const allowed = submap
    ? (x, y) => submap.isWalkable(x, y)
    : (x, y) => castle.map.isWalkable(x, y) && castle.wardIndex[x + y * width] === ward.id;

  for (let radius = 0; radius <= 6; radius += 1) {
    for (let dy = -radius; dy <= radius; dy += 1) {
      for (let dx = -radius; dx <= radius; dx += 1) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) {
          continue;
        }

        if (allowed(cell.x + dx, cell.y + dy)) {
          return { x: cell.x + dx, y: cell.y + dy };
        }
      }
    }
  }

  return null;
}

/**
 * A circuit through a few of the ward's interest points, ordered around the
 * ward's centre so the loop does not cross itself, and joined with A*.
 */
function buildCircuit(map, submap, random, posts, ward, id) {
  if (posts.length < 2) {
    return null;
  }

  const wanted = Math.min(posts.length, random.nextInt(3, 6));
  const chosen = pickDistinct(random, posts, wanted);

  const centre = {
    x: (ward.bounds.minX + ward.bounds.maxX) / 2,
    y: (ward.bounds.minY + ward.bounds.maxY) / 2,
  };
  chosen.sort(
    (a, b) => Math.atan2(a.y - centre.y, a.x - centre.x) - Math.atan2(b.y - centre.y, b.x - centre.x),
  );

  const cells = [];

  for (let i = 0; i < chosen.length; i += 1) {
    const from = chosen[i];
    const to = chosen[(i + 1) % chosen.length];
    const leg = findPath(submap, from, to);

    if (!leg) {
      continue;
    }

    cells.push(...smoothPath(submap, simplifyPath(leg)).slice(0, -1));
  }

  if (cells.length < 2) {
    return null;
  }

  return new PatrolRoute({
    id,
    wardId: ward.id,
    waypoints: cells.map((cell) => map.gridToWorldCenter(cell.x, cell.y)),
  });
}

/** Of the two wards a crossing joins, the one that posts the guard on it. */
export function defendedSideOf(castle, edge) {
  const from = castle.ward(edge.fromWard);
  const to = castle.ward(edge.toWard);

  if (!from || !to) {
    return edge.toWard;
  }

  return to.depth >= from.depth ? edge.toWard : edge.fromWard;
}

/**
 * The beat a guard walks at a chokepoint, on the defended side of it.
 *
 * A gate is stood in: two paces, and the doorway is never unwatched. A weak
 * point is not — nobody posts a man in the drain — so its guard walks the wall
 * either side of it, which leaves a window that recurs. That window is the
 * stealth game: it is a property of where the guard is, learnable by watching,
 * and it does not disappear because the player is good at using it.
 */
function sentryBeat(castle, submap, ward, edge) {
  const anchor = nearestWalkable(castle, ward, edge.location, submap);
  if (!anchor) {
    return null;
  }

  const reach = edge.isWeakPoint ? 6 : 2;
  const ends = beatAlongWall(castle, ward, anchor, reach, submap);
  const cells = walkBetween(submap, ends[0] ?? anchor, ends[ends.length - 1] ?? anchor, anchor);

  return new PatrolRoute({
    id: `${ward.id}-post-${edge.id}`,
    wardId: ward.id,
    kind: "post",
    edgeId: edge.id,
    waypoints: cells.map((cell) => castle.map.gridToWorldCenter(cell.x, cell.y)),
  });
}

/**
 * A there-and-back beat between two ends, routed rather than assumed.
 *
 * The ends are picked geometrically — so many tiles along the wall — and there
 * may well be a building between them. Pathing the leg and then walking it
 * back is what keeps a sentry pacing a line he can actually pace.
 */
function walkBetween(submap, from, to, fallback) {
  const path = findPath(submap, from, to);

  if (!path) {
    return [fallback];
  }

  const out = smoothPath(submap, simplifyPath(path));
  const back = out.slice(1, -1).reverse();
  return out.concat(back);
}

/**
 * Paces `reach` tiles either side of a post, along whichever axis the wall
 * actually runs — found by trying both, since a crossing's own tiles run
 * across the wall and do not say which way it lies.
 */
function beatAlongWall(castle, ward, anchor, reach, submap = null) {
  const axes = [
    { x: 1, y: 0 },
    { x: 0, y: 1 },
  ];

  let best = [];

  for (const axis of axes) {
    const ends = [reach, -reach]
      .map((step) =>
        nearestWalkable(castle, ward, { x: anchor.x + axis.x * step, y: anchor.y + axis.y * step }, submap),
      )
      .filter(Boolean);

    if (ends.length < 2) {
      continue;
    }

    const spread = Math.hypot(ends[0].x - ends[1].x, ends[0].y - ends[1].y);
    const bestSpread = best.length === 2 ? Math.hypot(best[0].x - best[1].x, best[0].y - best[1].y) : 0;

    if (spread > bestSpread) {
      // Out one way, back past the post, out the other: a beat, not a jump.
      best = [ends[0], ends[1]];
    }
  }

  if (best.length < 2) {
    const fallback = nearestWalkable(castle, ward, { x: anchor.x + 2, y: anchor.y }, submap);
    return fallback ? [anchor, fallback] : [anchor];
  }

  return best;
}

function pickDistinct(random, items, count) {
  const pool = [...items];
  const chosen = [];

  while (chosen.length < count && pool.length > 0) {
    chosen.push(pool.splice(random.nextInt(0, pool.length), 1)[0]);
  }

  return chosen;
}

/**
 * Follows a route of world-space points, one leg at a time.
 *
 * Used both for patrols (a closed loop) and for a guard walking to something
 * it wants to look at (an open path, replanned when the target moves).
 */
export class PathFollower {
  constructor({ waypoints = [], loop = false, index = 0 } = {}) {
    this.waypoints = waypoints;
    this.loop = loop;
    this.index = index;
  }

  get isFinished() {
    return !this.loop && this.index >= this.waypoints.length;
  }

  get target() {
    if (this.waypoints.length === 0) {
      return null;
    }

    if (this.loop) {
      return this.waypoints[this.index % this.waypoints.length];
    }

    return this.index < this.waypoints.length ? this.waypoints[this.index] : null;
  }

  /** Advances the cursor when `position` has reached the current waypoint. */
  update(position, radius = WAYPOINT_RADIUS) {
    const target = this.target;

    if (target && distance(position, target) <= radius) {
      this.index += 1;

      if (this.loop && this.waypoints.length > 0) {
        this.index %= this.waypoints.length;
      }
    }

    return this.target;
  }

  /** Replans onto a fresh set of points, keeping the follower reusable. */
  reset(waypoints, { loop = false } = {}) {
    this.waypoints = waypoints;
    this.loop = loop;
    this.index = 0;
  }
}

/**
 * Plans a walk to a goal on the real map, as world-space waypoints.
 *
 * Returns an empty list when no route exists — a guard with nowhere to go
 * stands still rather than walking into a wall.
 */
export function routeTo(map, from, goal) {
  const path = findPath(map, map.worldToGrid(from), map.worldToGrid(goal));
  if (!path) {
    return [];
  }

  return smoothPath(map, simplifyPath(path))
    .slice(1)
    .map((cell) => map.gridToWorldCenter(cell.x, cell.y));
}

/**
 * One step toward a point, sliding along walls rather than stopping dead.
 *
 * Guards are not the formation: they do not need the deformation layer, only
 * enough movement to keep a patrol on the flagstones.
 */
export function stepToward(entity, target, speed, dt, map) {
  // A door barred while someone is pacing over it leaves them inside the
  // masonry, and the clearance test below can only keep you out of a wall —
  // it can never get you out of one, because every small step from inside is
  // also inside. So a body that finds itself in the stonework heads for the
  // nearest open tile instead, which is the garrison stepping aside to let the
  // bar drop.
  if (map && !map.isWalkableWorld(entity.position)) {
    const escape = nearestOpenTile(map, map.worldToGrid(entity.position));

    if (escape) {
      const way = normalize(subtract(map.gridToWorldCenter(escape.x, escape.y), entity.position));
      entity.velocity = scale(way, speed);
      entity.position = {
        x: entity.position.x + way.x * speed * dt,
        y: entity.position.y + way.y * speed * dt,
      };
      return;
    }
  }

  const delta = subtract(target, entity.position);
  const length = Math.hypot(delta.x, delta.y);

  if (length < 1e-6) {
    entity.velocity = vec2();
    return;
  }

  const direction = normalize(delta);
  entity.velocity = scale(direction, speed);

  const step = Math.min(speed * dt, length);
  const candidate = {
    x: entity.position.x + direction.x * step,
    y: entity.position.y + direction.y * step,
  };

  if (isClear(map, candidate, entity.bodyRadius)) {
    entity.position = candidate;
    return;
  }

  // Axis-separated retry: a guard clipping a corner slides past it.
  const slideX = { x: candidate.x, y: entity.position.y };
  if (Math.abs(direction.x) > 1e-6 && isClear(map, slideX, entity.bodyRadius)) {
    entity.position = slideX;
    entity.velocity = vec2(entity.velocity.x, 0);
    return;
  }

  const slideY = { x: entity.position.x, y: candidate.y };
  if (Math.abs(direction.y) > 1e-6 && isClear(map, slideY, entity.bodyRadius)) {
    entity.position = slideY;
    entity.velocity = vec2(0, entity.velocity.y);
    return;
  }

  entity.velocity = vec2();
}

function isClear(map, point, radius = 0.25) {
  if (!map) {
    return true;
  }

  for (const offset of [
    { x: 0, y: 0 },
    { x: radius, y: 0 },
    { x: -radius, y: 0 },
    { x: 0, y: radius },
    { x: 0, y: -radius },
  ]) {
    if (!map.isWalkableWorld({ x: point.x + offset.x, y: point.y + offset.y })) {
      return false;
    }
  }

  return true;
}
