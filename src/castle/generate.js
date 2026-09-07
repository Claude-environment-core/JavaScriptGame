/**
 * Castle generation, end to end.
 *
 * Order matters, and it is the order the brief argues for: build a castle that
 * defends itself, *then* cut a few justified weak points into it, then work
 * out how it is patrolled, then man it.
 *
 *   1. tile geometry — rings, gates, towers, buildings   (`layout.js`)
 *   2. the ward graph over that geometry                 (`wards.js`)
 *   3. entry vectors, a random subset of them live       (`vectors.js`)
 *   4. patrol routes, planned per ward                   (`patrol.js`)
 *   5. the garrison, posted to chokepoints and circuits  (`garrison.js`)
 *
 * Every random draw comes from one seeded stream in that order, so a castle is
 * fully reproducible from its seed — the same guarantee world generation makes
 * in the squad simulation.
 */

import { hasLineOfSight } from "../sim/gridMap.js";
import { findPath } from "../sim/pathfinding.js";
import { DeterministicRandom } from "../sim/rng.js";
import { makeGarrisonParams, populateGarrison } from "./garrison.js";
import { generateLayout, rectContains } from "./layout.js";
import { planPatrols } from "./patrol.js";
import { WardId, planVectors } from "./vectors.js";
import { Castle, DEFAULT_WARD_PROFILE, Ward, WardType } from "./wards.js";

export const DEFAULT_CASTLE_SIZE = 144;

/** Below this a castle has no room to be a castle: four rings will not fit. */
export const MIN_CASTLE_SIZE = 56;

/**
 * The smallest map with room for a full-depth buffer.
 *
 * Below this the bands shrink to fit and the garrison can see across the
 * buffer, so a party has no unwatched ground to form up on. Castles are still
 * generated and still playable — the spawn is simply the least exposed spot
 * available rather than a genuinely hidden one.
 */
export const MIN_BUFFERED_SIZE = 112;

/**
 * Distance from the nearest patrol beat past which a muster point stops
 * getting safer. Beyond this the party is simply further from the castle, and
 * every attempt costs a longer walk in.
 */
export const COMFORTABLE_CLEARANCE = 14;

/**
 * How far into the buffer the party wants to be, in tiles from the apron edge.
 *
 * The outer part of a full-depth buffer is ground no guard can see into at
 * all; standing this far in keeps the party in that part rather than on the
 * boundary, where being unwatched depends on where the patrols happen to be.
 */
export const BUFFER_STANDOFF = 6;

const WARD_SPEC = [
  { id: WardId.Approach, type: WardType.Approach },
  { id: WardId.OuterBailey, type: WardType.OuterBailey },
  { id: WardId.InnerBailey, type: WardType.InnerBailey },
  { id: WardId.Keep, type: WardType.Keep },
];

/**
 * Generates a castle, its patrols and its garrison.
 *
 * @returns {{castle: Castle, garrison: Garrison, routes: Array, layout: object, report: object}}
 */
export function generateCastle({
  width = DEFAULT_CASTLE_SIZE,
  height = DEFAULT_CASTLE_SIZE,
  seed = 0,
  garrison: garrisonParams = {},
  wardProfile = DEFAULT_WARD_PROFILE,
} = {}) {
  if (width < MIN_CASTLE_SIZE || height < MIN_CASTLE_SIZE) {
    throw new RangeError(`a castle needs at least ${MIN_CASTLE_SIZE} tiles on each axis`);
  }

  const random = new DeterministicRandom(seed);
  const params = makeGarrisonParams(garrisonParams);

  // The buffer is sized from the longest sight in the castle, so the garrison's
  // own eyesight decides how much open country it needs to sit inside.
  const layout = generateLayout({ width, height, random, sight: params.towerVisionRange });
  const { edges, features } = planVectors({ map: layout.map, layout, random, wardIndex: layout.wardIndex });

  const wards = WARD_SPEC.map(({ id, type }) => {
    const profile = wardProfile[type] ?? DEFAULT_WARD_PROFILE[type];
    const census = surveyWard(layout, id);

    return new Ward({
      id,
      type,
      bounds: wardBounds(layout, id),
      garrisonDensity: profile.garrisonDensity,
      alertSensitivity: profile.alertSensitivity,
      tileCount: census.tiles,
      // The open ground is manned for the apron it patrols, not for the whole
      // field: a bigger map means more room to form up in, not more sentries.
      patrolTileCount: type === WardType.Approach ? census.apronTiles : census.tiles,
      centroid: census.centroid,
    });
  });

  const castle = new Castle({
    seed,
    map: layout.map,
    wards,
    edges,
    wardIndex: layout.wardIndex,
    landmarks: { ...layout.landmarks, features, sides: layout.sides, rings: layout.rings },
    princess: layout.landmarks.princess,
  });

  const routes = planPatrols({ castle, random, features });
  const garrison = populateGarrison({ castle, random, params, routes });

  // Chosen last, and by measurement rather than by formula: it has to be
  // somewhere this particular garrison cannot see, which is only knowable once
  // the garrison is standing where it stands.
  castle.landmarks.rally = pickMusterPoint({ castle, garrison, routes, random });

  return { castle, garrison, routes, layout, features, report: auditCastle(castle, garrison) };
}

/**
 * Where the party forms up: in the buffer, beyond the apron, out of sight.
 *
 * Scored rather than derived, because "can anybody see this spot" is a fact
 * about where this particular garrison ended up standing, and is only knowable
 * once it is standing there.
 *
 * Being out of sight is tested without regard to facing. A sentry who happens
 * to have his back turned at the moment the castle is generated is not cover —
 * he will turn round. What counts is whether he *could* see it: within his
 * range, with nothing in the way.
 *
 * Nothing here can fail. On a map too small to have a buffer worth the
 * name the best available spot wins anyway, and the audit reports honestly
 * whether it is genuinely unwatched.
 */
export function pickMusterPoint({ castle, garrison, routes, random }) {
  const apron = castle.landmarks.apron;
  const beats = routes.flatMap((route) => route.waypoints);
  const cover = (castle.landmarks.structures ?? []).map((structure) => structure.box);
  const approach = castle.wardOfType(WardType.Approach);
  const gate = castle.edges.find((edge) => edge.fromWard === WardId.Approach && !edge.isWeakPoint);
  const gateMouth = gate
    ? castle.map.gridToWorldCenter((gate.mouth ?? gate.location).x, (gate.mouth ?? gate.location).y)
    : castle.map.gridToWorldCenter(1, 1);

  let best = null;
  let bestScore = -Infinity;

  for (const tile of castle.walkableTilesIn(approach.id)) {
    const point = castle.map.gridToWorldCenter(tile.x, tile.y);

    // How far out into the buffer this is, measured from the apron's edge.
    const depth = Math.max(
      apron.minX - tile.x,
      apron.minY - tile.y,
      tile.x - apron.maxX,
      tile.y - apron.maxY,
    );
    const inBuffer = depth > 0;

    let watchers = 0;
    for (const guard of garrison.guards) {
      // Range first: it prunes almost every guard without casting a ray.
      if (
        Math.hypot(guard.position.x - point.x, guard.position.y - point.y) <= guard.visionRange &&
        hasLineOfSight(castle.map, guard.position, point)
      ) {
        watchers += 1;
      }
    }

    let clearance = Infinity;
    for (const beat of beats) {
      clearance = Math.min(clearance, Math.hypot(beat.x - point.x, beat.y - point.y));
    }

    const shelter = cover.some(
      (box) =>
        tile.x >= box.minX - 2 && tile.x <= box.maxX + 2 && tile.y >= box.minY - 2 && tile.y <= box.maxY + 2,
    );

    // Out of the garrison's ground and out of its sight dominate. Clearance
    // stops paying once it is comfortable — past that, further from the beats
    // is not safer, it is only a longer walk — so among the spots that are
    // properly clear the one with the shortest approach to the castle wins.
    const score =
      -watchers * 1000 +
      (inBuffer ? 200 : 0) +
      // Well inside the buffer, not hugging its edge: a spot one tile off the
      // apron is unwatched only until somebody wanders to that end of it.
      Math.min(Math.max(depth, 0), BUFFER_STANDOFF) * 3 +
      Math.min(clearance, COMFORTABLE_CLEARANCE) +
      (shelter ? 5 : 0) -
      0.05 * Math.hypot(gateMouth.x - point.x, gateMouth.y - point.y) +
      // A whisker of noise so a tie is not always won by the top-left tile.
      random.nextFloat() * 0.5;

    if (score > bestScore) {
      bestScore = score;
      best = tile;
    }
  }

  return best ?? fallbackCorner(castle);
}

function fallbackCorner(castle) {
  for (const tile of castle.walkableTilesIn(WardId.Approach)) {
    return tile;
  }

  return { x: 1, y: 1 };
}

/** Walkable tile count, apron share and centre of mass for one ward. */
function surveyWard(layout, wardId) {
  const { map, wardIndex } = layout;
  let tiles = 0;
  let apronTiles = 0;
  let sumX = 0;
  let sumY = 0;

  for (let y = 0; y < map.height; y += 1) {
    for (let x = 0; x < map.width; x += 1) {
      if (wardIndex[x + y * map.width] === wardId && map.isWalkable(x, y)) {
        tiles += 1;
        sumX += x;
        sumY += y;

        if (rectContains(layout.apron, x, y)) {
          apronTiles += 1;
        }
      }
    }
  }

  if (tiles === 0) {
    return { tiles: 0, apronTiles: 0, centroid: { x: 0, y: 0 } };
  }

  return {
    tiles,
    apronTiles,
    centroid: { x: Math.round(sumX / tiles), y: Math.round(sumY / tiles) },
  };
}

function wardBounds(layout, wardId) {
  switch (wardId) {
    case WardId.OuterBailey:
      return layout.rings.outer;
    case WardId.InnerBailey:
      return layout.rings.inner;
    case WardId.Keep:
      return layout.rings.keep;
    default:
      return layout.bounds;
  }
}

/**
 * Checks the castle against the properties it is supposed to have.
 *
 * This is generation's own smoke test: the storm path must exist (a castle
 * with no way in at all is a bug, not a hard level), every live vector must
 * lead somewhere, and no vector may leave the front door redundant by being a
 * shorter walk to the princess than the gate is.
 */
export function auditCastle(castle, garrison = null) {
  const { map } = castle;
  const rally = castle.landmarks.rally;
  const princess = castle.princess;

  const stormPath = findPath(map, rally, princess);
  const gates = castle.edges.filter((edge) => !edge.isWeakPoint);
  const active = castle.activeVectors();

  const vectors = active.map((edge) => {
    const from = edge.tiles.find((tile) => map.isWalkable(tile.x, tile.y)) ?? edge.location;
    const path = map.isWalkable(from.x, from.y) ? findPath(map, from, princess) : null;

    return {
      id: edge.id,
      vectorType: edge.vectorType,
      traversalType: edge.traversalType,
      justificationTag: edge.justificationTag,
      location: edge.location,
      needsOpening: !edge.isOpen,
      stepsToPrincess: path ? path.length : null,
    };
  });

  const musterPoint = castle.map.gridToWorldCenter(rally.x, rally.y);
  // Facing is deliberately ignored: a guard who could see the spot by turning
  // round is watching it, as far as choosing a place to form up is concerned.
  const watchers = garrison
    ? garrison.guards.filter(
        (guard) =>
          Math.hypot(guard.position.x - musterPoint.x, guard.position.y - musterPoint.y) <=
            guard.visionRange && hasLineOfSight(map, guard.position, musterPoint),
      ).length
    : null;
  const nearestGuard = garrison
    ? Math.min(
        ...garrison.guards.map((guard) =>
          Math.hypot(guard.position.x - musterPoint.x, guard.position.y - musterPoint.y),
        ),
      )
    : null;

  return {
    seed: castle.seed,
    stormPathSteps: stormPath ? stormPath.length : null,
    isSolvable: Boolean(stormPath),
    muster: {
      point: rally,
      watchedBy: watchers,
      nearestGuard: nearestGuard === null ? null : Number(nearestGuard.toFixed(1)),
      inTowerSight: garrison
        ? (castle.landmarks.towers ?? []).some((tower) => {
            const post = map.gridToWorldCenter(tower.post.x, tower.post.y);
            return (
              Math.hypot(post.x - musterPoint.x, post.y - musterPoint.y) <=
                garrison.params.towerVisionRange && hasLineOfSight(map, post, musterPoint)
            );
          })
        : null,
    },
    gates: gates.length,
    candidateVectors: castle.candidateVectors().length,
    activeVectors: vectors,
    wards: castle.wardList.map((ward) => ({
      type: ward.type,
      tiles: ward.tileCount,
      garrison: ward.garrisonSize,
      routes: ward.patrolRoutes.length,
    })),
  };
}
