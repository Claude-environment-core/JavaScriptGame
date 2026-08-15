import assert from "node:assert/strict";
import test from "node:test";

import { TILE_BLOCKED, TILE_WALKABLE } from "../src/sim/gridMap.js";
import { findPath } from "../src/sim/pathfinding.js";
import { DeterministicRandom } from "../src/sim/rng.js";
import { DEFAULT_SEED, collectRooms, generateWorld } from "../src/sim/worldGen.js";

test("the default seed is 0 and the stream is reproducible", () => {
  assert.equal(DEFAULT_SEED, 0);

  const first = new DeterministicRandom(0);
  const second = new DeterministicRandom(0);
  const draws = Array.from({ length: 8 }, () => first.nextFloat());

  assert.deepEqual(draws, Array.from({ length: 8 }, () => second.nextFloat()));
  assert.ok(draws.every((value) => value >= 0 && value < 1));
});

test("a reset generator repeats its stream", () => {
  const random = new DeterministicRandom(7);
  const first = [random.nextFloat(), random.nextFloat()];
  random.reset();

  assert.deepEqual([random.nextFloat(), random.nextFloat()], first);
});

test("nextInt stays inside its range", () => {
  const random = new DeterministicRandom(0);

  for (let i = 0; i < 200; i += 1) {
    const value = random.nextInt(5, 12);
    assert.ok(value >= 5 && value < 12);
    assert.equal(value, Math.floor(value));
  }

  assert.equal(random.nextInt(3, 3), 3);
});

test("generation is deterministic for a given seed", () => {
  const first = generateWorld({ width: 48, height: 48 });
  const second = generateWorld({ width: 48, height: 48 });

  assert.deepEqual(first.map.toRows(), second.map.toRows());

  const other = generateWorld({ width: 48, height: 48, seed: 1 });
  assert.notDeepEqual(first.map.toRows(), other.map.toRows());
});

test("the outer border is walled", () => {
  const { map } = generateWorld({ width: 40, height: 32 });

  for (let x = 0; x < map.width; x += 1) {
    assert.equal(map.get(x, 0), TILE_BLOCKED);
    assert.equal(map.get(x, map.height - 1), TILE_BLOCKED);
  }

  for (let y = 0; y < map.height; y += 1) {
    assert.equal(map.get(0, y), TILE_BLOCKED);
    assert.equal(map.get(map.width - 1, y), TILE_BLOCKED);
  }
});

test("splits are written as blocked lines and corridors reopen them", () => {
  const { map, tree } = generateWorld({ width: 48, height: 48 });

  assert.ok(tree.left && tree.right, "the root partition was split");
  assert.ok(tree.splitAxis === "x" || tree.splitAxis === "y");

  const rows = map.toRows();
  const blocked = rows.flat().filter((tile) => tile !== TILE_WALKABLE).length;
  assert.ok(blocked > 0, "walls exist");
  assert.ok(blocked < rows.flat().length, "the map is not solid");
});

test("partitions stop splitting below the minimum size", () => {
  const { tree } = generateWorld({ width: 48, height: 48, roomBudget: 64 });

  for (const room of collectRooms(tree)) {
    assert.ok(room.width < 10 || room.height < 10 || room.width * room.height > 0);
  }
});

test("a small partition budget limits the number of splits", () => {
  const { tree } = generateWorld({ width: 64, height: 64, roomBudget: 1 });

  assert.ok(tree.left && tree.right);
  assert.ok(tree.left.isLeaf && tree.right.isLeaf, "only one split was made");
});

test("carved corridors keep every room reachable", () => {
  const { map, tree } = generateWorld({ width: 48, height: 48 });
  const centers = collectRooms(tree)
    .map((room) => room.center)
    .filter((center) => map.isWalkable(center.x, center.y));

  assert.ok(centers.length >= 2, "the map has several rooms");

  for (let i = 1; i < centers.length; i += 1) {
    assert.ok(findPath(map, centers[0], centers[i]), `room ${i} is unreachable`);
  }
});
