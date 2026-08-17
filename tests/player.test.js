import assert from "node:assert/strict";
import test from "node:test";

import { GridMap, TILE_BLOCKED, TILE_WALKABLE } from "../src/sim/gridMap.js";
import { DEFAULT_PLAYER_SPEED, KeyboardPlayerController, Player } from "../src/sim/player.js";

function makeController(x, y) {
  return { direction: () => ({ x, y }) };
}

test("a player moves in the controller's direction", () => {
  const player = new Player({ position: { x: 2.5, y: 2.5 } });
  const map = new GridMap(8, 8, TILE_WALKABLE);

  player.tick(0.5, map, makeController(1, 0));

  assert.equal(player.position.x, 2.5 + DEFAULT_PLAYER_SPEED * 0.5);
  assert.equal(player.position.y, 2.5);
  assert.equal(player.velocity.x, DEFAULT_PLAYER_SPEED);
  assert.equal(player.velocity.y, 0);
});

test("diagonal input is normalized before speed is applied", () => {
  const player = new Player({ position: { x: 2.5, y: 2.5 } });
  const map = new GridMap(8, 8, TILE_WALKABLE);

  player.tick(1, map, makeController(1, 1));

  assert.ok(Math.abs(Math.hypot(player.velocity.x, player.velocity.y) - DEFAULT_PLAYER_SPEED) < 1e-12);
});

test("a player cannot move into blocked tiles", () => {
  const map = new GridMap(8, 8, TILE_WALKABLE);
  map.set(4, 3, TILE_BLOCKED);

  const player = new Player({ position: { x: 3.5, y: 3.5 }, speed: 2, radius: 0.25 });
  player.tick(1, map, makeController(1, 0));

  assert.ok(player.position.x <= 3.75);
  assert.equal(Math.floor(player.position.x), 3);
  assert.equal(Math.floor(player.position.y), 3);
});

test("keyboard controller can be used without a browser window", () => {
  const controller = new KeyboardPlayerController({ target: null });
  assert.deepEqual(controller.direction(), { x: 0, y: 0 });
});
