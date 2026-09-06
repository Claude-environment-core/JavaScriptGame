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

import { findPath } from "../sim/pathfinding.js";
import { DeterministicRandom } from "../sim/rng.js";
import { populateGarrison } from "./garrison.js";
import { generateLayout } from "./layout.js";
import { planPatrols } from "./patrol.js";
import { WardId, planVectors } from "./vectors.js";
import { Castle, DEFAULT_WARD_PROFILE, Ward, WardType } from "./wards.js";

export const DEFAULT_CASTLE_SIZE = 96;

/** Below this a castle has no room to be a castle: four rings will not fit. */
export const MIN_CASTLE_SIZE = 56;

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
  const layout = generateLayout({ width, height, random });
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
  const garrison = populateGarrison({ castle, random, params: garrisonParams, routes });

  return { castle, garrison, routes, layout, features, report: auditCastle(castle) };
}

/** Walkable tile count and centre of mass for one ward. */
function surveyWard(layout, wardId) {
  const { map, wardIndex } = layout;
  let tiles = 0;
  let sumX = 0;
  let sumY = 0;

  for (let y = 0; y < map.height; y += 1) {
    for (let x = 0; x < map.width; x += 1) {
      if (wardIndex[x + y * map.width] === wardId && map.isWalkable(x, y)) {
        tiles += 1;
        sumX += x;
        sumY += y;
      }
    }
  }

  if (tiles === 0) {
    return { tiles: 0, centroid: { x: 0, y: 0 } };
  }

  return { tiles, centroid: { x: Math.round(sumX / tiles), y: Math.round(sumY / tiles) } };
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
export function auditCastle(castle) {
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

  return {
    seed: castle.seed,
    stormPathSteps: stormPath ? stormPath.length : null,
    isSolvable: Boolean(stormPath),
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
