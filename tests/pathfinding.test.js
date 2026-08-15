import assert from "node:assert/strict";
import test from "node:test";

import { GridMap, NEIGHBOR_OFFSETS, TILE_BLOCKED } from "../src/sim/gridMap.js";
import { findPath, heuristic, pathToWaypoints, STEP_COST } from "../src/sim/pathfinding.js";
import { PriorityQueue } from "../src/sim/priorityQueue.js";
import { buildFixtureA, buildOpenMap } from "./fixtures.js";

test("step cost is 1 and the heuristic is euclidean", () => {
  assert.equal(STEP_COST, 1.0);
  assert.equal(heuristic({ x: 0, y: 0 }, { x: 3, y: 4 }), 5);
});

test("neighbour expansion is 4-way in a fixed order", () => {
  assert.deepEqual(
    NEIGHBOR_OFFSETS.map((offset) => [offset.x, offset.y]),
    [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ],
  );

  const map = buildOpenMap(5, 5);
  assert.deepEqual(
    [...map.neighbors(2, 2)],
    [
      { x: 3, y: 2 },
      { x: 1, y: 2 },
      { x: 2, y: 3 },
      { x: 2, y: 1 },
    ],
  );
});

test("map edges drop out-of-bounds neighbours", () => {
  const map = buildOpenMap(5, 5);
  assert.deepEqual(
    [...map.neighbors(0, 0)],
    [
      { x: 1, y: 0 },
      { x: 0, y: 1 },
    ],
  );
});

test("out-of-bounds start or goal is rejected", () => {
  const map = buildOpenMap(5, 5);

  assert.equal(findPath(map, { x: -1, y: 0 }, { x: 4, y: 4 }), null);
  assert.equal(findPath(map, { x: 0, y: 0 }, { x: 5, y: 4 }), null);
});

test("non-walkable start or goal is rejected", () => {
  const map = buildOpenMap(5, 5);
  map.set(0, 0, TILE_BLOCKED);
  map.set(4, 4, TILE_BLOCKED);

  assert.equal(findPath(map, { x: 0, y: 0 }, { x: 3, y: 3 }), null);
  assert.equal(findPath(map, { x: 1, y: 1 }, { x: 4, y: 4 }), null);
});

test("an unreachable goal returns no path", () => {
  const map = buildOpenMap(5, 5);
  for (let y = 0; y < 5; y += 1) {
    map.set(2, y, TILE_BLOCKED);
  }

  assert.equal(findPath(map, { x: 0, y: 0 }, { x: 4, y: 4 }), null);
});

test("a path is contiguous, walkable and shortest on an open map", () => {
  const map = buildOpenMap(8, 8);
  const path = findPath(map, { x: 0, y: 0 }, { x: 5, y: 3 });

  assert.ok(path);
  assert.deepEqual(path[0], { x: 0, y: 0 });
  assert.deepEqual(path.at(-1), { x: 5, y: 3 });

  // Manhattan distance + 1 for the start cell: 4-way movement has no shortcuts.
  assert.equal(path.length, 5 + 3 + 1);

  for (let i = 0; i < path.length; i += 1) {
    assert.ok(map.isWalkable(path[i].x, path[i].y));

    if (i > 0) {
      const stepDistance = Math.abs(path[i].x - path[i - 1].x) + Math.abs(path[i].y - path[i - 1].y);
      assert.equal(stepDistance, 1);
    }
  }
});

test("a start equal to the goal returns the single cell", () => {
  const map = buildOpenMap(4, 4);
  assert.deepEqual(findPath(map, { x: 2, y: 2 }, { x: 2, y: 2 }), [{ x: 2, y: 2 }]);
});

test("pathfinding routes through the only opening", () => {
  const { map, opening } = buildFixtureA();
  const path = findPath(map, { x: 1, y: 1 }, { x: 10, y: 10 });

  assert.ok(path);
  assert.ok(path.some((cell) => cell.x === opening.x && cell.y === opening.y));
});

test("waypoints sit at cell centres", () => {
  const map = new GridMap(3, 3);
  assert.deepEqual(pathToWaypoints(map, [{ x: 0, y: 0 }, { x: 1, y: 0 }]), [
    { x: 0.5, y: 0.5 },
    { x: 1.5, y: 0.5 },
  ]);
});

test("the priority queue pops in priority order and supports updates", () => {
  const queue = new PriorityQueue();
  queue.enqueue("a", "a", 3);
  queue.enqueue("b", "b", 1);
  queue.enqueue("c", "c", 2);

  queue.enqueue("a", "a", 0.5);
  assert.equal(queue.size, 3);

  assert.equal(queue.dequeue(), "a");
  assert.equal(queue.dequeue(), "b");
  assert.equal(queue.dequeue(), "c");
  assert.equal(queue.dequeue(), null);
});

test("the priority queue ignores priority increases and breaks ties by insertion", () => {
  const queue = new PriorityQueue();
  queue.enqueue("a", "a", 1);
  queue.enqueue("b", "b", 1);
  queue.update("a", 5);

  assert.equal(queue.dequeue(), "a");
  assert.equal(queue.dequeue(), "b");
});
