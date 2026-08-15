import assert from "node:assert/strict";
import test from "node:test";

import { createAgents } from "../src/sim/agent.js";
import { runAndRecord } from "../src/sim/snapshot.js";
import { createSquadController } from "../src/sim/squad.js";
import { buildFixtureA } from "./fixtures.js";

function runFixtureA() {
  const fixture = buildFixtureA();
  const controller = createSquadController({
    agents: createAgents(fixture.startPositions),
    map: fixture.map,
    goal: fixture.goal,
  });

  return runAndRecord(controller, {
    dt: fixture.dt,
    maxTicks: fixture.maxTicks,
    arrivalRadius: fixture.arrivalRadius,
    label: "fixture-a",
  });
}

test("a snapshot carries map tiles, waypoints and per-tick agent state", () => {
  const { snapshot, arrived } = runFixtureA();

  assert.equal(arrived, true);
  assert.equal(snapshot.label, "fixture-a");
  assert.equal(snapshot.map.length, 12);
  assert.equal(snapshot.map[0].length, 12);
  assert.ok(snapshot.waypoints.length > 0);
  assert.ok(snapshot.path.length > 0);
  assert.ok(snapshot.ticks.length > 0);

  const first = snapshot.ticks[0];
  assert.equal(first.tick, 0);
  assert.equal(first.agents.length, 5);
  assert.ok(Number.isFinite(first.agents[0].position.x));
  assert.ok(Number.isFinite(first.agents[0].velocity.y));
});

test("snapshots of two identical runs match exactly", () => {
  assert.deepEqual(runFixtureA().snapshot, runFixtureA().snapshot);
});

test("snapshots survive a JSON round trip", () => {
  const { snapshot } = runFixtureA();
  assert.deepEqual(JSON.parse(JSON.stringify(snapshot)), snapshot);
});
