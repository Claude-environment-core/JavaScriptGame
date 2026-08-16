import assert from "node:assert/strict";
import test from "node:test";

import { AnchorTrail } from "../src/sim/formation/spine.js";
import { TILE_BLOCKED } from "../src/sim/gridMap.js";
import { distance } from "../src/sim/vec2.js";
import { buildOpenMap } from "./fixtures.js";

const forward = { x: 1, y: 0 };

test("an unmoved trail extrapolates backwards along the heading", () => {
  const trail = new AnchorTrail({ x: 5, y: 5 });
  const { point, tangent } = trail.sample(2, forward);

  assert.ok(Math.abs(point.x - 3) < 1e-9);
  assert.ok(Math.abs(point.y - 5) < 1e-9);
  assert.deepEqual(tangent, forward);
});

test("looking ahead of the head extends along the heading", () => {
  const trail = new AnchorTrail({ x: 5, y: 5 });
  const { point } = trail.sample(-1.5, forward);

  assert.ok(Math.abs(point.x - 6.5) < 1e-9);
});

test("samples follow the path the anchor actually took", () => {
  const trail = new AnchorTrail({ x: 0, y: 0 });

  // An L: east to (4, 0), then north to (4, 4).
  for (let x = 0; x <= 4; x += 0.25) {
    trail.push({ x, y: 0 });
  }
  for (let y = 0; y <= 4; y += 0.25) {
    trail.push({ x: 4, y });
  }

  // Two units back from the head is on the northward leg.
  const near = trail.sample(2, { x: 0, y: 1 }).point;
  assert.ok(Math.abs(near.x - 4) < 1e-6);
  assert.ok(Math.abs(near.y - 2) < 1e-6);

  // Six units back has turned the corner onto the eastward leg.
  const far = trail.sample(6, { x: 0, y: 1 });
  assert.ok(Math.abs(far.point.y) < 1e-6, `expected the eastward leg, got y = ${far.point.y}`);
  assert.ok(Math.abs(far.point.x - 2) < 1e-6);
  assert.ok(Math.abs(far.tangent.x - 1) < 1e-6, "and the heading it had there");
});

test("the trail is trimmed to its maximum length", () => {
  const trail = new AnchorTrail({ x: 0, y: 0 }, 3);

  for (let x = 0; x <= 10; x += 0.25) {
    trail.push({ x, y: 0 });
  }

  assert.ok(trail.length <= 3 + 0.25);
  assert.ok(Math.abs(trail.head.x - 10) < 1e-9);
});

test("the head tracks the anchor exactly, even between recorded points", () => {
  const trail = new AnchorTrail({ x: 0, y: 0 });
  trail.push({ x: 0.01, y: 0 });

  assert.deepEqual(trail.head, { x: 0.01, y: 0 });
});

test("extrapolation stops at the edge of free space", () => {
  const map = buildOpenMap(10, 10);
  for (let y = 0; y < 10; y += 1) {
    map.set(3, y, TILE_BLOCKED);
  }

  // Head just east of the wall, heading east: sampling backwards runs into it.
  const trail = new AnchorTrail({ x: 4.5, y: 5 }, 12, map);
  const { point } = trail.sample(3, forward);

  assert.ok(map.isWalkableWorld(point), "the spine never leaves free space");
  assert.ok(point.x >= 4, `stopped at the wall face, got x = ${point.x}`);
  assert.ok(distance(point, { x: 4.5, y: 5 }) <= 3);
});
