/**
 * End-to-end behaviour: squads crossing chokepoints, corridors and corners.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { DEFAULT_BODY_RADIUS, createAgents } from "../src/sim/agent.js";
import { FormationMode } from "../src/sim/formation/deformation.js";
import { personalSpace } from "../src/sim/formation/params.js";
import { FormationType } from "../src/sim/formation/shape.js";
import { findPath } from "../src/sim/pathfinding.js";
import { runAndRecord } from "../src/sim/snapshot.js";
import { SquadPlan, SquadState, createSquadController } from "../src/sim/squad.js";
import { distance } from "../src/sim/vec2.js";
import {
  buildArena,
  buildFixtureA,
  buildFixtureB,
  buildFixtureC,
  buildFixtureD,
  buildFixtureE,
  buildOpenMap,
} from "./fixtures.js";

function march(fixture, options = {}) {
  const agents = createAgents(fixture.startPositions);
  const controller = createSquadController({
    agents,
    map: fixture.map,
    goal: fixture.goal,
    ...options,
  });

  assert.ok(controller, "expected a route to exist");

  const result = runAndRecord(controller, {
    dt: fixture.dt,
    maxTicks: fixture.maxTicks,
    everyNthTick: fixture.maxTicks,
  });

  return { agents, controller, ...result };
}

/** Checks that hold for every run, whatever the map. */
function assertSquadInvariants(fixture, { agents, controller, metrics }) {
  assert.equal(metrics.blockedTileEntries, 0, "no agent ever entered a wall");
  assert.ok(
    metrics.minimumAgentGap >= 2 * DEFAULT_BODY_RADIUS,
    `agent bodies overlapped: closest approach ${metrics.minimumAgentGap}`,
  );

  for (const agent of agents) {
    assert.ok(
      fixture.map.isWalkableWorld(agent.position),
      `agent ${agent.id} finished inside a wall`,
    );
  }

  // Arriving in formation means arriving spread over the formation's extent,
  // not stacked on the objective.
  const reach = controller.formationExtent() + fixture.arrivalRadius;
  assert.ok(
    controller.farthestAgentDistance(fixture.goal) <= reach,
    `squad is strung out: farthest agent ${controller.farthestAgentDistance(fixture.goal).toFixed(2)} > ${reach.toFixed(2)}`,
  );
}

test("fixture A: a squad files through a single chokepoint", () => {
  const fixture = buildFixtureA();
  const path = findPath(fixture.map, { x: 1, y: 1 }, { x: 10, y: 10 });

  assert.ok(path, "a path exists");
  assert.ok(
    path.some((cell) => cell.x === fixture.opening.x && cell.y === fixture.opening.y),
    "the path traverses the opening",
  );

  const run = march(fixture);
  assert.ok(run.arrived, `did not arrive in ${fixture.maxTicks} ticks`);
  assertSquadInvariants(fixture, run);
});

test("fixture B: a squad crosses two sequential chokepoints", () => {
  const fixture = buildFixtureB();
  const path = findPath(fixture.map, { x: 1, y: 3 }, { x: 11, y: 12 });

  assert.ok(path);
  for (const doorway of fixture.doorways) {
    assert.ok(
      path.some((cell) => cell.x === doorway.x && cell.y === doorway.y),
      `the path traverses the doorway at (${doorway.x}, ${doorway.y})`,
    );
  }

  const run = march(fixture);
  assert.ok(run.arrived, `did not arrive in ${fixture.maxTicks} ticks`);
  assertSquadInvariants(fixture, run);
});

test("fixture C: a one-tile corridor forces the wedge into a file", () => {
  const fixture = buildFixtureC({ corridorWidth: 1 });
  const run = march(fixture);

  assert.ok(run.arrived);
  assertSquadInvariants(fixture, run);
  assert.ok(run.metrics.fileTicks > 0, "the formation degraded to a file to fit");
  assert.equal(run.controller.deformation.baseType, FormationType.Wedge, "and kept its orders");
});

test("fixture C: a three-tile corridor is squeezed into, not degraded", () => {
  const fixture = buildFixtureC({ corridorWidth: 3 });
  const agents = createAgents(fixture.startPositions);
  const controller = createSquadController({ agents, map: fixture.map, goal: fixture.goal });

  let squeezedInCorridor = false;

  for (let i = 0; i < fixture.maxTicks; i += 1) {
    controller.tick(fixture.dt);

    const inCorridor =
      controller.anchor.x > fixture.corridor.fromX + 2 &&
      controller.anchor.x < fixture.corridor.toX - 2;

    if (inCorridor && controller.mode === FormationMode.Squeeze) {
      squeezedInCorridor = true;
      assert.ok(controller.deformation.scaleX < 1, "narrower than nominal");
      assert.ok(controller.deformation.scaleY > 1, "and correspondingly longer");
    }

    if (controller.hasArrived()) {
      break;
    }
  }

  assert.ok(squeezedInCorridor, "the wedge squeezed rather than degrading");
});

test("fixture D: the formation recovers width as the corridor opens", () => {
  const fixture = buildFixtureD();
  const agents = createAgents(fixture.startPositions);
  const controller = createSquadController({ agents, map: fixture.map, goal: fixture.goal });

  const widthBySegment = new Map();

  for (let i = 0; i < fixture.maxTicks; i += 1) {
    controller.tick(fixture.dt);

    const segment = fixture.segments.findIndex(
      (candidate) =>
        controller.anchor.x >= candidate.fromX + 3 && controller.anchor.x <= candidate.toX - 3,
    );

    if (segment >= 0) {
      const width = controller.deformation.halfWidth * 2;
      widthBySegment.set(segment, Math.max(widthBySegment.get(segment) ?? 0, width));
    }

    if (controller.hasArrived()) {
      break;
    }
  }

  assert.equal(widthBySegment.size, 3, "the squad passed through every segment");
  assert.ok(widthBySegment.get(0) < widthBySegment.get(1), "one tile is tighter than three");
  assert.ok(widthBySegment.get(1) < widthBySegment.get(2), "three tiles is tighter than five");
});

test("fixture E: a formation holds together around a corner", () => {
  const fixture = buildFixtureE();
  const run = march(fixture);

  assert.ok(run.arrived);
  assertSquadInvariants(fixture, run);
  assert.ok(run.metrics.meanSlotError < 1.0, `slot error ${run.metrics.meanSlotError}`);
  assert.ok(run.metrics.finalCoherence > 0.75, `coherence ${run.metrics.finalCoherence}`);
});

test("every formation crosses an open arena and holds its shape", () => {
  for (const formation of Object.values(FormationType)) {
    const map = buildArena(30, 30);
    const agents = createAgents([
      { x: 4, y: 4 },
      { x: 4.7, y: 4 },
      { x: 5.4, y: 4 },
      { x: 6.1, y: 4 },
      { x: 6.8, y: 4 },
    ]);

    const controller = createSquadController({
      agents,
      map,
      goal: { x: 25, y: 25 },
      formation,
    });

    let arrived = false;
    for (let i = 0; i < 1200 && !arrived; i += 1) {
      controller.tick(0.1);
      arrived = controller.hasArrived();
    }

    assert.ok(arrived, `${formation} squad failed to reach the objective`);
    assert.ok(
      controller.coherence > 0.75,
      `${formation} squad arrived out of shape: coherence ${controller.coherence.toFixed(2)}`,
    );
  }
});

test("a deep formation no longer stalls the squad", () => {
  // The old weighted-sum controller deadlocked here: a column deeper than the
  // arrival radius could never satisfy the waypoint gate. Progression now
  // follows the anchor, so depth is irrelevant to it.
  const map = buildArena(40, 40);
  const agents = createAgents(
    Array.from({ length: 6 }, (_, i) => ({ x: 4 + i * 0.7, y: 4 })),
  );

  const controller = createSquadController({
    agents,
    map,
    goal: { x: 34, y: 34 },
    formation: FormationType.Column,
    params: { spacing: 1.6 },
  });

  let arrived = false;
  for (let i = 0; i < 1500 && !arrived; i += 1) {
    controller.tick(0.1);
    arrived = controller.hasArrived();
  }

  assert.ok(arrived, "a column six deep reached its objective");
});

test("the squad slows for stragglers instead of dragging them", () => {
  const map = buildArena(40, 40);
  const agents = createAgents([
    { x: 4, y: 4 },
    { x: 4.7, y: 4 },
    { x: 5.4, y: 4 },
  ]);

  const controller = createSquadController({ agents, map, goal: { x: 34, y: 34 } });

  for (let i = 0; i < 40; i += 1) {
    controller.tick(0.1);
  }

  // Teleport one agent far away: coherence collapses and the anchor should crawl.
  agents[2].position = { x: 20, y: 4 };
  controller.tick(0.1);

  const before = { ...controller.anchor };
  controller.tick(0.1);
  const movedWhileBroken = distance(before, controller.anchor);

  assert.ok(controller.coherence < controller.params.coherenceGo);
  assert.ok(movedWhileBroken > 0, "but never stops entirely");
  assert.ok(
    movedWhileBroken < controller.params.anchorSpeed * 0.1,
    `anchor moved ${movedWhileBroken.toFixed(3)} while the squad was scattered`,
  );
});

test("agents take the nearest slot rather than the one matching their index", () => {
  const map = buildArena(30, 30);
  const agents = createAgents([
    { x: 10, y: 5 },
    { x: 5, y: 5 },
  ]);

  const controller = createSquadController({
    agents,
    map,
    goal: { x: 5, y: 25 },
    formation: FormationType.Line,
  });

  for (let i = 0; i < 60; i += 1) {
    controller.tick(0.1);
  }

  for (let i = 0; i < agents.length; i += 1) {
    const own = distance(agents[i].position, controller.slotFor(i));
    const other = distance(agents[i].position, controller.slotFor(1 - i));
    assert.ok(own <= other + 1e-9, `agent ${i} is holding the wrong slot`);
  }
});

test("an unreachable goal yields no controller", () => {
  const fixture = buildFixtureA();
  fixture.map.set(fixture.opening.x, fixture.opening.y, 1);

  assert.equal(
    createSquadController({
      agents: createAgents(fixture.startPositions),
      map: fixture.map,
      goal: fixture.goal,
    }),
    null,
  );
});

test("the plan yields waypoints first, then the objective", () => {
  const plan = new SquadPlan({
    objective: { x: 9, y: 9 },
    waypoints: [
      { x: 1, y: 1 },
      { x: 2, y: 2 },
    ],
  });

  assert.equal(plan.state, SquadState.Advance);
  assert.deepEqual(plan.currentTarget, { x: 1, y: 1 });
  assert.deepEqual(plan.consumeNextWaypoint(), { x: 1, y: 1 });
  assert.deepEqual(plan.currentTarget, { x: 2, y: 2 });

  plan.consumeNextWaypoint();
  assert.equal(plan.hasWaypoints, false);
  assert.deepEqual(plan.currentTarget, { x: 9, y: 9 });
  assert.equal(plan.consumeNextWaypoint(), null);
});

test("speed stays inside the limit", () => {
  const map = buildOpenMap(40, 40);
  const agents = createAgents([{ x: 4, y: 4 }]);
  const controller = createSquadController({ agents, map, goal: { x: 35, y: 35 } });

  for (let i = 0; i < 200; i += 1) {
    controller.tick(0.1);
    assert.ok(
      Math.hypot(agents[0].velocity.x, agents[0].velocity.y) <= controller.params.maxSpeed + 1e-9,
    );
  }
});

test("the exposed state is read-only and covers every agent", () => {
  const map = buildArena(20, 20);
  const agents = createAgents([
    { x: 4, y: 4 },
    { x: 4.7, y: 4 },
  ]);
  const controller = createSquadController({ agents, map, goal: { x: 15, y: 15 } });
  const state = controller.tick(0.1);

  assert.equal(state.slots.length, 2);
  assert.equal(state.assignment.length, 2);
  assert.equal(state.personalSpace, personalSpace(controller.params));
  assert.ok(Object.isFrozen(state));
  assert.throws(() => {
    "use strict";
    state.slots[0].x = 99;
  });
});

test("an agent cut off from its slot routes back instead of pressing the wall", () => {
  const fixture = buildFixtureA();
  const agents = createAgents(fixture.startPositions);
  const controller = createSquadController({
    agents,
    map: fixture.map,
    goal: fixture.goal,
  });

  // Walk the squad through the chokepoint, then strand one agent back on the
  // far side of the wall, where its slot is out of sight.
  for (let i = 0; i < 60; i += 1) {
    controller.tick(fixture.dt);
  }

  const stranded = agents[0];
  stranded.position = { x: 1.5, y: 1.5 };
  stranded.velocity = { x: 0, y: 0 };

  let rejoined = false;
  for (let i = 0; i < 600 && !rejoined; i += 1) {
    controller.tick(fixture.dt);
    rejoined = distance(stranded.position, controller.slotFor(agents.indexOf(stranded))) < 1.0;
  }

  assert.ok(rejoined, "the stranded agent found its way back to the formation");
  assert.ok(fixture.map.isWalkableWorld(stranded.position));
});
