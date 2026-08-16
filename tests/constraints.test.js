import assert from "node:assert/strict";
import test from "node:test";

import {
  neighborConstraints,
  projectVelocity,
  wallConstraints,
} from "../src/sim/formation/constraints.js";
import { makeFormationParams, personalSpace } from "../src/sim/formation/params.js";
import { TILE_BLOCKED } from "../src/sim/gridMap.js";
import { magnitude } from "../src/sim/vec2.js";
import { buildOpenMap } from "./fixtures.js";

const params = makeFormationParams();
const dt = 0.1;

function wallColumnMap(columnX) {
  const map = buildOpenMap(12, 12);
  for (let y = 0; y < 12; y += 1) {
    map.set(columnX, y, TILE_BLOCKED);
  }

  return map;
}

function step(position, velocity, map, agents = []) {
  const constraints = [
    ...wallConstraints(position, map, dt, params),
    ...neighborConstraints(0, [{ position }, ...agents], dt, params),
  ];

  const projected = projectVelocity(velocity, constraints, params);
  return {
    velocity: projected,
    next: { x: position.x + projected.x * dt, y: position.y + projected.y * dt },
  };
}

test("open ground leaves the desired velocity untouched", () => {
  const map = buildOpenMap(12, 12);
  const { velocity } = step({ x: 6, y: 6 }, { x: 2, y: 0 }, map);

  assert.deepEqual(velocity, { x: 2, y: 0 });
});

test("a wall cannot be entered, however hard the agent drives at it", () => {
  const map = wallColumnMap(8);
  let position = { x: 7.2, y: 6 };

  for (let i = 0; i < 60; i += 1) {
    const result = step(position, { x: 3, y: 0 }, map);
    position = result.next;

    assert.ok(map.isWalkableWorld(position), `entered a wall on step ${i}`);
    assert.ok(
      position.x <= 8 - params.bodyRadius + 1e-6,
      `body overlapped the wall on step ${i}: x = ${position.x}`,
    );
  }
});

test("a wall removes only the component that would enter it", () => {
  const map = wallColumnMap(8);
  // Driving diagonally into the wall: the sideways half of the motion survives.
  const { velocity } = step({ x: 7.75, y: 6 }, { x: 2, y: 2 }, map);

  assert.ok(velocity.x < 2, "the approach is cut");
  assert.ok(Math.abs(velocity.y - 2) < 1e-9, "sliding along the wall is untouched");
});

test("the map edge constrains exactly like a wall", () => {
  const map = buildOpenMap(12, 12);
  let position = { x: 11.4, y: 6 };

  for (let i = 0; i < 40; i += 1) {
    position = step(position, { x: 3, y: 0 }, map).next;
  }

  assert.ok(position.x <= 12 - params.bodyRadius + 1e-6);
});

test("an agent pushed inside a wall is required to leave it", () => {
  const map = wallColumnMap(8);
  // Inside the wall tile, nearer its eastern face.
  const { velocity, next } = step({ x: 8.7, y: 6.5 }, { x: 0, y: 0 }, map);

  assert.ok(magnitude(velocity) > 0, "a stationary agent inside a wall is pushed out");
  assert.ok(velocity.x > 0, "and pushed the short way out");
  assert.ok(next.x > 8.7);
});

test("agents keep personal space from each other", () => {
  const map = buildOpenMap(12, 12);
  const minimum = personalSpace(params);
  let a = { x: 5, y: 6 };
  let b = { x: 7, y: 6 };

  for (let i = 0; i < 80; i += 1) {
    // Both drive at each other; both give way by half.
    const first = projectVelocity(
      { x: 3, y: 0 },
      neighborConstraints(0, [{ position: a }, { position: b }], dt, params),
      params,
    );
    const second = projectVelocity(
      { x: -3, y: 0 },
      neighborConstraints(1, [{ position: a }, { position: b }], dt, params),
      params,
    );

    a = { x: a.x + first.x * dt, y: a.y + first.y * dt };
    b = { x: b.x + second.x * dt, y: b.y + second.y * dt };

    assert.ok(
      b.x - a.x >= minimum - 1e-6,
      `personal space broken on step ${i}: gap ${(b.x - a.x).toFixed(3)}`,
    );
  }
});

test("responsibility for avoidance is shared, not assigned", () => {
  const agents = [{ position: { x: 5, y: 6 } }, { position: { x: 5.4, y: 6 } }];
  const first = neighborConstraints(0, agents, dt, params);
  const second = neighborConstraints(1, agents, dt, params);

  assert.equal(first.length, 1);
  assert.equal(second.length, 1);
  assert.ok(Math.abs(first[0].maxApproach - second[0].maxApproach) < 1e-9);
  // Opposed normals: each is pushed away from the other.
  assert.ok(Math.abs(first[0].normal.x + second[0].normal.x) < 1e-9);
});

test("projection never exceeds the speed limit", () => {
  const map = wallColumnMap(8);
  const { velocity } = step({ x: 7.6, y: 6 }, { x: 3, y: 3 }, map);

  assert.ok(magnitude(velocity) <= params.maxSpeed + 1e-9);
});

test("no map means no wall constraints", () => {
  assert.deepEqual(wallConstraints({ x: 5, y: 5 }, null, dt, params), []);
});
