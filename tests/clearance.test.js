import assert from "node:assert/strict";
import test from "node:test";

import {
  centreWaypoints,
  lateralClearance,
  probeAgents,
  probeRoute,
} from "../src/sim/formation/clearance.js";
import { TILE_BLOCKED } from "../src/sim/gridMap.js";
import { buildFixtureC, buildOpenMap } from "./fixtures.js";

const east = { x: 1, y: 0 };

/** A horizontal corridor of `width` tiles, with its top edge at `top`. */
function corridorMap(top, width, length = 20) {
  const map = buildOpenMap(length, top + width + 6);

  for (let x = 0; x < map.width; x += 1) {
    for (let y = 0; y < map.height; y += 1) {
      if (y < top || y >= top + width) {
        map.set(x, y, TILE_BLOCKED);
      }
    }
  }

  return map;
}

test("clearance measures the free span across the heading", () => {
  const map = corridorMap(4, 3);
  const reading = lateralClearance(map, { x: 10, y: 5.5 }, east, 6);

  assert.ok(Math.abs(reading.left - 1.5) < 1e-9);
  assert.ok(Math.abs(reading.right - 1.5) < 1e-9);
  assert.ok(Math.abs(reading.width - 3) < 1e-9);
});

test("clearance is capped at the probe range in open ground", () => {
  const reading = lateralClearance(buildOpenMap(40, 40), { x: 20, y: 20 }, east, 6);

  assert.equal(reading.left, 6);
  assert.equal(reading.right, 6);
});

test("a missing map reports open ground", () => {
  assert.deepEqual(lateralClearance(null, { x: 0, y: 0 }, east, 4), {
    left: 4,
    right: 4,
    width: 8,
  });
});

test("the route probe reports the tightest crossing ahead", () => {
  const fixture = buildFixtureC({ corridorWidth: 1 });
  const waypoints = Array.from({ length: 8 }, (_, i) => ({
    x: 10.5 + i,
    y: fixture.corridor.top + 0.5,
  }));

  const probe = probeRoute(fixture.map, {
    anchor: { x: 9.5, y: fixture.corridor.top + 0.5 },
    forward: east,
    waypoints,
    horizon: 8,
    range: 6,
  });

  assert.ok(probe.width <= 1.001, `expected the corridor width, got ${probe.width}`);
  assert.equal(probe.samples.length, 9);
});

test("route centring moves a wall-hugging path to the middle of its corridor", () => {
  const map = corridorMap(4, 3);
  // A path along the top row of a 3-wide corridor.
  const hugging = Array.from({ length: 6 }, (_, i) => ({ x: 5.5 + i, y: 4.5 }));
  const centred = centreWaypoints(map, hugging, { range: 6 });

  for (const point of centred.slice(1, -1)) {
    assert.ok(Math.abs(point.y - 5.5) < 0.2, `expected the centre line, got y = ${point.y}`);
    assert.ok(map.isWalkableWorld(point));
  }
});

test("route centring leaves open ground alone", () => {
  const map = buildOpenMap(40, 40);
  const straight = Array.from({ length: 6 }, (_, i) => ({ x: 5.5 + i, y: 20.5 }));

  assert.deepEqual(centreWaypoints(map, straight, { range: 6 }), straight);
});

test("the agent probe cancels an agent's own lateral offset", () => {
  const map = corridorMap(4, 3);
  const spine = { point: { x: 10, y: 5.5 }, tangent: east };

  // Same corridor, three agents at different offsets: the room the *formation*
  // has is the same in every case, which is what stops the shape pumping.
  const centre = probeAgents(map, [{ position: { x: 10, y: 5.5 }, spine }], 6);
  const right = probeAgents(map, [{ position: { x: 10, y: 6.2 }, spine }], 6);
  const left = probeAgents(map, [{ position: { x: 10, y: 4.8 }, spine }], 6);

  assert.ok(Math.abs(centre - 1.5) < 1e-9);
  assert.ok(Math.abs(right - 1.5) < 1e-9, `offset agent read ${right}`);
  assert.ok(Math.abs(left - 1.5) < 1e-9, `offset agent read ${left}`);
});

test("the agent probe reports the tightest reading in the squad", () => {
  const map = corridorMap(4, 3);
  const wide = { point: { x: 10, y: 5.5 }, tangent: east };
  const narrowMap = corridorMap(4, 1);

  const samples = [{ position: { x: 10, y: 5.5 }, spine: wide }];
  assert.ok(probeAgents(map, samples, 6) > probeAgents(narrowMap, samples, 6));
});

test("an empty squad reports no constraint", () => {
  assert.equal(probeAgents(buildOpenMap(10, 10), [], 6), Infinity);
});
