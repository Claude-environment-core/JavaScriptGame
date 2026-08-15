/**
 * Fixture C: obstacle-avoidance sanity cases.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { TILE_BLOCKED, castRay } from "../src/sim/gridMap.js";
import {
  CONE_HALF_ANGLE,
  RAY_COUNT,
  computeObstacleAvoidance,
  rayAngle,
} from "../src/sim/obstacleAvoidance.js";
import { DEFAULT_STEERING_PARAMS } from "../src/sim/steering.js";
import { magnitude } from "../src/sim/vec2.js";
import { buildOpenMap } from "./fixtures.js";

const params = DEFAULT_STEERING_PARAMS;

function wallColumnMap(columnX) {
  const map = buildOpenMap(10, 10);
  for (let y = 0; y < 10; y += 1) {
    map.set(columnX, y, TILE_BLOCKED);
  }

  return map;
}

test("the cone casts 5 evenly spaced rays over +/- 0.52 rad", () => {
  assert.equal(RAY_COUNT, 5);
  assert.equal(CONE_HALF_ANGLE, 0.52);

  const angles = Array.from({ length: RAY_COUNT }, (_, i) => rayAngle(i));
  assert.deepEqual(angles, [-0.52, -0.26, 0, 0.26, 0.52]);
});

test("an absent map produces no avoidance force", () => {
  const force = computeObstacleAvoidance({ x: 5, y: 5 }, { x: 1, y: 0 }, null, params);
  assert.deepEqual(force, { x: 0, y: 0 });
});

test("an open map with nothing ahead produces no avoidance force", () => {
  const map = buildOpenMap(10, 10);
  const force = computeObstacleAvoidance({ x: 5, y: 5 }, { x: 1, y: 0 }, map, params);
  assert.deepEqual(force, { x: 0, y: 0 });
});

test("a wall directly ahead produces a force", () => {
  const map = wallColumnMap(8);
  const force = computeObstacleAvoidance({ x: 6.5, y: 5 }, { x: 1, y: 0 }, map, params);

  assert.ok(magnitude(force) > 0);
  // The wall is to the right, so the push is to the left.
  assert.ok(force.x < 0);
});

test("heading out of bounds produces a force", () => {
  const map = buildOpenMap(10, 10);
  const force = computeObstacleAvoidance({ x: 9.2, y: 5 }, { x: 1, y: 0 }, map, params);

  assert.ok(magnitude(force) > 0);
  assert.ok(force.x < 0);
});

test("a stationary agent produces no avoidance force", () => {
  const map = wallColumnMap(8);
  const force = computeObstacleAvoidance({ x: 7.5, y: 5 }, { x: 0, y: 0 }, map, params);
  assert.deepEqual(force, { x: 0, y: 0 });
});

test("a closer wall pushes at least as hard as a farther one", () => {
  const map = wallColumnMap(8);
  const near = computeObstacleAvoidance({ x: 7.2, y: 5 }, { x: 1, y: 0 }, map, params);
  const far = computeObstacleAvoidance({ x: 6.4, y: 5 }, { x: 1, y: 0 }, map, params);

  assert.ok(magnitude(near) >= magnitude(far));
});

test("the avoidance force never exceeds the maximum steering force", () => {
  const map = wallColumnMap(6);
  const force = computeObstacleAvoidance({ x: 5.99, y: 5 }, { x: 1, y: 0 }, map, params);

  assert.ok(magnitude(force) <= params.MaxSteeringForce + 1e-9);
});

test("DDA stepping reports the first blocked cell and its distance", () => {
  const map = wallColumnMap(8);
  const hit = castRay(map, { x: 5.5, y: 5.5 }, { x: 1, y: 0 }, 5);

  assert.equal(hit.hit, true);
  assert.deepEqual(hit.cell, { x: 8, y: 5 });
  assert.ok(Math.abs(hit.distance - 2.5) < 1e-9);
});

test("DDA stepping treats leaving the map as a hit", () => {
  const map = buildOpenMap(10, 10);
  const hit = castRay(map, { x: 9.5, y: 5.5 }, { x: 1, y: 0 }, 5);

  assert.equal(hit.hit, true);
  assert.deepEqual(hit.cell, { x: 10, y: 5 });
});

test("DDA stepping reports a miss beyond the maximum distance", () => {
  const map = wallColumnMap(8);
  const hit = castRay(map, { x: 5.5, y: 5.5 }, { x: 1, y: 0 }, 1);

  assert.equal(hit.hit, false);
});
